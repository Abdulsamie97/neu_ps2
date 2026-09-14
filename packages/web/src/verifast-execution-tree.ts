/**
 * @file verifast-execution-tree.ts
 * @brief Dekodiert VeriFasts kompakten Ausführungswald und erzeugt DOT für die Webdarstellung.
 * @author Abdul
 */

/** @brief Einzelner dekodierter Knoten des symbolischen VeriFast-Ausführungsbaums. */
export type VeriFastExecutionNode = {
    /** @brief Innerhalb einer Antwort eindeutige Knotenkennung für SVG und Interaktion. */
    id: number;
    /** @brief Unterscheidet normalen Schritt, Erfolg, Beweisfehler und offenen Zweig. */
    kind: 'step' | 'success' | 'failure' | 'pending';
    /** @brief Lesbarer VeriFast-Schritt beziehungsweise Endstatus. */
    message: string;
    /** @brief Optionale einsbasierte Pseudo2-Editorzeile eines quellbezogenen Knotens. */
    sourceLine?: number;
    /** @brief Nachfolgende Schritte eines linearen oder verzweigten symbolischen Pfades. */
    children: VeriFastExecutionNode[];
};

/** @brief Auswählbare Wurzel mit lesbarer Bezeichnung und vollständig dekodiertem Baum. */
export type VeriFastExecutionTree = {
    /** @brief Anzeige im Auswahlmenü, üblicherweise der verifizierte Funktionsname. */
    label: string;
    /** @brief Wurzelknoten des zugehörigen symbolischen Ausführungslaufs. */
    root: VeriFastExecutionNode;
};

/** @brief Ergebnis der DOT-Erzeugung einschließlich Interaktionsindex und Pfadstatistik. */
export type VeriFastExecutionTreeDot = {
    /** @brief Vollständiger DOT-Quelltext für Viz.js. */
    dot: string;
    /** @brief Zuordnung der Graphviz-Knotenbezeichner zu den fachlichen VeriFast-Knoten. */
    nodesByGraphId: Map<string, VeriFastExecutionNode>;
    /** @brief Gesamtanzahl der dargestellten Knoten. */
    nodeCount: number;
    /** @brief Anzahl erfolgreicher Endzustände. */
    successCount: number;
    /** @brief Anzahl fehlgeschlagener Endzustände. */
    failureCount: number;
    /** @brief Anzahl nach einem Beweisfehler noch nicht abgeschlossener Zweige. */
    pendingCount: number;
};

/**
 * @brief Dekodiert VeriFasts kompakte Präfixdarstellung in getrennte Ausführungsbäume.
 *
 * `#n` erzeugt einen Schritt mit Nachricht `n`. Ein direkt folgender Knoten bildet
 * einen linearen Pfad; `[...]` enthält mit `B` eingeleitete Alternativzweige und
 * kann selbst als anonymer Verzweigungsknoten auftreten. Ein leerer Branch `B[]`
 * ist bereits erfolgreich abgeschlossen. `S[]` und `E[]` kennzeichnen ebenfalls
 * erfolgreiche beziehungsweise fehlgeschlagene Blätter.
 * Strikte Syntax- und Größenprüfungen verhindern Endlosschleifen bei beschädigten Daten.
 *
 * @param messages Deduplizierte VeriFast-Schritttexte.
 * @param encodedForest Kompakte Baumkodierung des JSON-Protokolls.
 * @return Vollständig dekodierte, für die Auswahlliste beschriftete Wurzelbäume.
 */
export function decodeVeriFastExecutionForest(
    messages: string[],
    encodedForest: string
): VeriFastExecutionTree[] {
    let cursor = 0;
    let nextNodeId = 0;
    const maximumNodes = 50_000;

    /**
     * @brief Liest die mit eckigen Klammern und `B`-Markierungen kodierten Kindzweige.
     * @return In VeriFast-Reihenfolge dekodierte Kindknoten.
     */
    const readBranches = (): VeriFastExecutionNode[] => {
        if (encodedForest[cursor] !== '[') {
            throw new Error(`Expected "[" at offset ${cursor}.`);
        }
        cursor++;

        const children: VeriFastExecutionNode[] = [];
        while (encodedForest[cursor] === 'B') {
            cursor++;
            children.push(readNode());
        }
        if (encodedForest[cursor] !== ']') {
            throw new Error(`Expected "]" at offset ${cursor}.`);
        }
        cursor++;
        return children;
    };

    /**
     * @brief Liest genau einen Schritt-, Erfolgs- oder Fehlerknoten ab der aktuellen Position.
     * @return Dekodierter Knoten samt rekursiv gelesenen Nachfolgern.
     */
    const readNode = (): VeriFastExecutionNode => {
        if (nextNodeId >= maximumNodes) {
            throw new Error(`Execution tree exceeds ${maximumNodes} nodes.`);
        }

        const token = encodedForest[cursor];
        if (token === '[') {
            const children = readBranches();
            return children.length === 0
                ? {
                    id: nextNodeId++,
                    kind: 'success',
                    message: 'Verification path succeeded.',
                    children: []
                }
                : {
                    id: nextNodeId++,
                    kind: 'step',
                    message: 'Symbolic branch.',
                    children
                };
        }

        if (token === '#') {
            cursor++;
            const indexStart = cursor;
            while (cursor < encodedForest.length && /\d/.test(encodedForest[cursor])) {
                cursor++;
            }
            if (indexStart === cursor) {
                throw new Error(`Missing message index at offset ${indexStart}.`);
            }

            const messageIndex = Number(encodedForest.slice(indexStart, cursor));
            const node: VeriFastExecutionNode = {
                id: nextNodeId++,
                kind: 'step',
                message: messages[messageIndex] ?? `Unknown VeriFast step #${messageIndex}`,
                children: []
            };

            if (encodedForest[cursor] === '[') {
                node.children = readBranches();
            } else if (
                encodedForest[cursor] === '#' ||
                encodedForest[cursor] === 'S' ||
                encodedForest[cursor] === 'E'
            ) {
                node.children = [readNode()];
            }
            return node;
        }

        if (token === 'S' || token === 'E') {
            cursor++;
            const node: VeriFastExecutionNode = {
                id: nextNodeId++,
                kind: token === 'S' ? 'success' : 'failure',
                message: token === 'S' ? 'Verification path succeeded.' : 'Verification path failed.',
                children: []
            };
            node.children = readBranches();
            return node;
        }

        throw new Error(`Unexpected token "${token ?? '<end>'}" at offset ${cursor}.`);
    };

    const roots: VeriFastExecutionNode[] = [];
    while (cursor < encodedForest.length) {
        roots.push(readNode());
    }

    return roots.map((root, index) => ({
        label: inferVeriFastExecutionTreeLabel(root, index),
        root
    }));
}

/**
 * @brief Übersetzt einen dekodierten Ausführungsbaum in DOT und indiziert seine SVG-Knoten.
 * @param root Wurzel des darzustellenden VeriFast-Baums.
 * @return DOT-Code, Knotenindex und aggregierte Pfadstatistik.
 */
export function buildVeriFastExecutionTreeDot(
    root: VeriFastExecutionNode
): VeriFastExecutionTreeDot {
    const lines = [
        'digraph VeriFastExecutionTree {',
        '  graph [bgcolor="#f7f7f7", margin="0.08", nodesep="0.22", rankdir=TB, ranksep="0.30"];',
        '  node [fixedsize=true, fontname="Arial", height="0.20", label="", penwidth="1.2", shape=circle, style=filled, width="0.20"];',
        '  edge [arrowhead=none, color="#60646c", penwidth="1.1"];'
    ];
    const nodesByGraphId = new Map<string, VeriFastExecutionNode>();
    const stack = [root];
    let successCount = 0;
    let failureCount = 0;
    let pendingCount = 0;

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;

        const graphId = `vf_node_${node.id}`;
        nodesByGraphId.set(graphId, node);
        const fillColor = node.kind === 'success'
            ? '#22c55e'
            : node.kind === 'failure'
                ? '#ef4444'
                : node.kind === 'pending'
                    ? '#d1d5db'
                : '#171717';
        const borderColor = node.kind === 'success'
            ? '#15803d'
            : node.kind === 'failure'
                ? '#b91c1c'
                : node.kind === 'pending'
                    ? '#6b7280'
                : '#353535';

        if (node.kind === 'success') successCount++;
        if (node.kind === 'failure') failureCount++;
        if (node.kind === 'pending') pendingCount++;
        lines.push(
            `  ${graphId} [color="${borderColor}", fillcolor="${fillColor}", tooltip="${escapeDotString(node.message)}"];`
        );

        for (const child of node.children) {
            lines.push(`  ${graphId} -> vf_node_${child.id};`);
        }
        for (let index = node.children.length - 1; index >= 0; index--) {
            stack.push(node.children[index]);
        }
    }

    lines.push('}');
    return {
        dot: lines.join('\n'),
        nodesByGraphId,
        nodeCount: nodesByGraphId.size,
        successCount,
        failureCount,
        pendingCount
    };
}

/**
 * @brief Leitet aus der ersten aussagekräftigen Schrittkette einen Namen für das Auswahlmenü ab.
 * @param root Wurzel des zu beschriftenden VeriFast-Baums.
 * @param index Nullbasierter Wurzelindex als eindeutiger Fallback.
 * @return Funktions-/Vertragsbezeichnung oder generische Verifikationsnummer.
 */
function inferVeriFastExecutionTreeLabel(root: VeriFastExecutionNode, index: number): string {
    let current: VeriFastExecutionNode | undefined = root;
    while (current) {
        const functionVerification = current.message.match(/^Verifying function '([^']+)'/);
        if (functionVerification) {
            return `Function: ${functionVerification[1]}`;
        }

        const implementationCheck = current.message.match(/^Function '([^']+)': Function type implementation check/);
        if (implementationCheck) {
            return `Contract check: ${implementationCheck[1]}`;
        }

        current = current.children.length === 1 ? current.children[0] : undefined;
    }

    return `Verification ${index + 1}`;
}

/**
 * @brief Maskiert einen VeriFast-Schritt für die sichere Verwendung als DOT-Attributwert.
 * @param value Unveränderter VeriFast-Nachrichtentext.
 * @return Gegen Backslashes, Anführungszeichen und Zeilenumbrüche geschützter Text.
 */
function escapeDotString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, '\\n');
}
