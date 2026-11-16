/**
 * @file structural-checks.test.mjs
 * @brief Testet Struktur, Teilnoten und vertrauliche Rueckmeldungen am gebauten VPL-Runner.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const bundlePath = fileURLToPath(new URL('../dist/pseudo2-vpl.mjs', import.meta.url));
const reference = await readFile(new URL('fixtures/stack-queue-deq.pseudo2', import.meta.url), 'utf8');
const example = JSON.parse(await readFile(new URL('../dist/assignment.example.json', import.meta.url), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'pseudo2-vpl-structure-test-'));
let caseNumber = 0;
after(() => rm(directory, { recursive: true, force: true }));

/** Bewertet eine isolierte Abgabe mit einer temporaeren Konfiguration. */
async function evaluate(source, manifest) {
  const id = caseNumber++;
  const sourcePath = join(directory, `${id}.pseudo2`);
  const manifestPath = join(directory, `${id}.json`);
  await Promise.all([writeFile(sourcePath, source), writeFile(manifestPath, JSON.stringify(manifest))]);
  const args = [bundlePath, 'evaluate', sourcePath, manifestPath];
  return run(process.execPath, args, { timeout: 15_000, windowsHide: true, cwd: directory });
}

/** Erstellt eine Aufgabe mit einem Funktionstest und beliebigen Strukturgewichten. */
function assignment(tests, structuralChecks, maxGrade = 100) {
  return { version: 1, title: 'Strukturtest', mode: 'function', maxGrade, tests, structuralChecks };
}

const alwaysPasses = { name: 'Ausgabe', harness: 'print 1', expectedOutput: '1', points: 70 };

test('Musterloesung besteht Aufbau, Nutzung und alle DEQ-Verhaltenstests', async () => {
  const { stdout } = await evaluate(reference, example);
  assert.match(stdout, /5\/5 Tests bestanden/);
  assert.match(stdout, /\[OK\] DEQ: Umlauf bei belegtem Ring/);
  assert.match(stdout, /\[OK\] DEQ: Ringpuffer wiederverwenden/);
  assert.match(stdout, /Verhalten: 70\/70 Gewichtspunkte/);
  assert.match(stdout, /Struktur: 30\/30 Gewichtspunkte/);
  assert.match(stdout, /^Grade :=>>100$/m);
});

test('Umlauf und Wiederverwendung finden einen fehlenden Wrap-around am Ringanfang', async () => {
  const index = reference.indexOf('struct DEQ');
  assert.ok(index >= 0);
  const source = reference.slice(0, index) + reference.slice(index)
    .replace('this.head = this.head mod this.capacity + 1', 'this.head += 1');
  assert.notEqual(source, reference);
  const { stdout } = await evaluate(source, example);
  assert.match(stdout, /\[OK\] DEQ: Beide Enden/);
  assert.match(stdout, /\[FEHLER\] DEQ: Umlauf bei belegtem Ring/);
  assert.match(stdout, /\[FEHLER\] DEQ: Ringpuffer wiederverwenden/);
  assert.match(stdout, /Struktur: 30\/30 Gewichtspunkte/);
  assert.match(stdout, /^Grade :=>>70$/m);
});

test('Feldtyp, Arrayform, fehlende Methode und falsche Stelligkeit werden erklaert', async () => {
  const source = `struct Stack
    num data
    bool top
    push(x, y)
        this.data = x
`;
  const shape = { name: 'Stack-Aufbau', points: 30, struct: example.structuralChecks[0].struct };
  const { stdout } = await evaluate(source, assignment([alwaysPasses], [shape]));
  assert.match(stdout, /\.pseudo2:2:\d+: Hinweis: Deklariere "Stack.data" vom Typ "num\[\]"/);
  assert.match(stdout, /Deklariere "Stack.top" vom Typ "num"/);
  assert.match(stdout, /Implementiere die Methode "Stack.pop"/);
  assert.match(stdout, /Die Methode "Stack.push" braucht 1 Parameter/);
  assert.match(stdout, /^Grade :=>>70$/m);
});

test('Gleichnamige Methoden anderer Structs und unaufgerufene Helfer zaehlen nicht', async () => {
  const unusedStack = reference.slice(0, reference.indexOf('func reverseWithStack'));
  const source = `${unusedStack}
struct Other
    push(x)
        return x
    pop()
        return 7

func unused()
    var s = new Stack
    s.init(1)
    s.push(7)
    return s.pop()

func algorithm()
    var other = new Other
    other.push(7)
    return other.pop()
`;
  const check = {
    name: 'Echter Stack', points: 30, struct: example.structuralChecks[0].struct,
    scopes: [{ in: 'algorithm', includeCallees: true, requiredCalls: ['Stack.push', 'Stack.pop'] }]
  };
  const { stdout } = await evaluate(source, assignment([{
    name: 'Algorithmus', harness: 'print algorithm()', expectedOutput: '7', points: 70
  }], [check]));
  assert.match(stdout, /1\/1 Tests bestanden/);
  assert.match(stdout, /Rufe "Stack.push" beim Ausfuehren von "algorithm" auf/);
  assert.match(stdout, /Rufe "Stack.pop" beim Ausfuehren von "algorithm" auf/);
  assert.match(stdout, /^Grade :=>>70$/m);
});

test('Harness-Code zaehlt weder als Deklaration noch als Verwendung der Abgabe', async () => {
  const source = `struct Stack
    push(x)
        return x

func algorithm()
    if false
        var s = new Stack
        s.push(8)
    return 7
    var never = new Stack
    never.push(7)
`;
  const harness = `struct Queue {
    init() { return }
}
func onlyInHarness()
    var s = new Stack
    return s.push(7)
print onlyInHarness()
print algorithm()`;
  const checks = [
    { name: 'Echter Aufruf', points: 10, scopes: [{
      in: 'algorithm', requiredCalls: ['Stack.push'], requiredConstructions: ['Stack']
    }] },
    { name: 'Eigenes Struct', points: 10, struct: { name: 'Queue' } },
    { name: 'Eigener Algorithmus', points: 10, scopes: [{ in: 'onlyInHarness', requiredCalls: ['Stack.push'] }] }
  ];
  const { stdout } = await evaluate(source, assignment([{
    name: 'Harness-Ausgabe', harness, expectedOutput: '7\n7', points: 70
  }], checks));
  assert.match(stdout, /1\/1 Tests bestanden/);
  assert.match(stdout, /Rufe "Stack.push"/);
  assert.match(stdout, /Erzeuge in "algorithm" ein Objekt mit "new Stack"/);
  assert.match(stdout, /Deklariere den Struct "Queue"/);
  assert.match(stdout, /Deklariere die Funktion "onlyInHarness"/);
  assert.match(stdout, /^Grade :=>>70$/m);
});

test('Nur aufgeloeste Feldreferenzen zaehlen, inklusive implizitem this und Indexzugriff', async () => {
  const source = `struct Storage
    num[] data
    usesField()
        return data[1]
    usesLocal()
        var data = [7]
        return data[1]
    usesAsValue()
        var values = this.data
        return values[1]
`;
  const checks = ['usesField', 'usesLocal', 'usesAsValue'].map(method => ({
    name: method, points: 10,
    scopes: [{ in: `Storage.${method}`, requiredFields: ['Storage.data'], requiredArrayAccesses: ['Storage.data'] }]
  }));
  const { stdout } = await evaluate(source, assignment([alwaysPasses], checks));
  assert.match(stdout, /\[OK\] usesField/);
  assert.match(stdout, /Verwende das Feld "Storage.data" in "Storage.usesLocal"/);
  assert.doesNotMatch(stdout, /Verwende das Feld "Storage.data" in "Storage.usesAsValue"/);
  assert.match(stdout, /Greife per Index auf das Arrayfeld "Storage.data" in "Storage.usesAsValue" zu/);
  assert.match(stdout, /^Grade :=>>80$/m);
});

test('Geltungsbereich, transitive Verbote, Aufruflisten und Operatoren haben eigene Rueckmeldungen', async () => {
  const source = `struct Box
    compute(x)
        return helper(x)
    clean(x)
        // for mod ++
        var words = "helper(20) mod ++"
        //@ assert 4 mod 2 == 0
        return x

func helper(x)
    var a = [x]
    var count = 0
    for i = 1 to 1
        count++
        a[i] += count
    return a[1] mod 10

func ignored(x)
    return x % 2
`;
  const scope = {
    in: 'Box.compute', forbiddenOperations: ['loop', 'array-create', 'array-index'],
    forbiddenOperators: ['++', '+=', 'mod', '%']
  };
  const checks = [
    { name: 'Nur im Methodenrumpf', points: 4, scopes: [scope] },
    { name: 'Kein Umweg', points: 6, scopes: [{ ...scope, includeCallees: true, allowedCalls: ['helper'] }] },
    { name: 'Kein Helfer', points: 7, scopes: [{ in: 'Box.compute', forbiddenCalls: ['helper'] }] },
    { name: 'Keine fremden Aufrufe', points: 8, scopes: [{ in: 'Box.compute', allowedCalls: [] }] },
    { name: 'Nur Programmcode', points: 5, scopes: [{ ...scope, in: 'Box.clean', allowedCalls: [] }] }
  ];
  const { stdout } = await evaluate(source, assignment([alwaysPasses], checks));
  assert.match(stdout, /\[OK\] Nur im Methodenrumpf/);
  assert.match(stdout, /\.pseudo2:13:\d+: Hinweis: In "Box.compute" sind Schleifen nicht erlaubt/);
  assert.match(stdout, /Array-Erzeugungen nicht erlaubt/);
  assert.match(stdout, /Array-Indexzugriffe nicht erlaubt/);
  assert.match(stdout, /Der Operator "\+\+" ist in "Box.compute" nicht erlaubt/);
  assert.match(stdout, /Der Operator "\+=" ist in "Box.compute" nicht erlaubt/);
  assert.match(stdout, /Der Operator "mod" ist in "Box.compute" nicht erlaubt/);
  assert.doesNotMatch(stdout, /Der Operator "%"/);
  assert.match(stdout, /\[FEHLER\] Kein Helfer/);
  assert.match(stdout, /\[FEHLER\] Keine fremden Aufrufe/);
  assert.match(stdout, /Der Aufruf "helper" ist in "Box.compute" nicht erlaubt/);
  assert.match(stdout, /\[OK\] Nur Programmcode/);
  assert.match(stdout, /^Grade :=>>79$/m);
});

test('Aufrufgraph terminiert bei Rekursion und akzeptiert einen wirklich aufgerufenen Helfer', async () => {
  const source = `struct Box
    num value
    set(x)
        this.value = x

func algorithm(n)
    if n > 0
        algorithm(n - 1)
    helper()

func helper()
    var box = new Box
    box.set(1)
`;
  const { stdout } = await evaluate(source, assignment([alwaysPasses], [{
    name: 'Transitive Verwendung', points: 30,
    scopes: [{ in: 'algorithm', includeCallees: true, requiredCalls: ['Box.set'], requiredFields: ['Box.value'] }]
  }]));
  assert.match(stdout, /^Grade :=>>100$/m);
});

test('Gewichte sind frei skalierbar; alte Dateien behalten ihre Teilnote', async () => {
  const source = 'func f(x)\n    return x\n';
  const tests = [
    { name: 'richtig', harness: 'print f(1)', expectedOutput: '1', points: 2 },
    { name: 'falsch', harness: 'print f(3)', expectedOutput: '2', points: 3 }
  ];
  const { stdout: legacy } = await evaluate(source, assignment(tests, undefined, 10));
  assert.match(legacy, /^Grade :=>>4$/m);
  assert.doesNotMatch(legacy, /Struktur:/);
  const { stdout: mixed } = await evaluate(source, assignment(tests, [
    { name: 'Strukturpunkt', points: 3, scopes: [{ in: 'f', forbiddenOperations: ['print'] }] },
    { name: 'Fehlt', points: 2, struct: { name: 'Box' } }
  ], 10));
  assert.match(mixed, /Verhalten: 2\/5 Gewichtspunkte/);
  assert.match(mixed, /Struktur: 3\/5 Gewichtspunkte/);
  assert.match(mixed, /^Grade :=>>5$/m);
});

test('Fehlerhafte Strukturregeln liefern den JSON-Pfad statt einer studentischen Note', async () => {
  const valid = { name: 'Kriterium', points: 30 };
  const badInputs = [
    [null, /"structuralChecks" muss ein Array/],
    [[{ ...valid, points: 0, struct: { name: 'Stack' } }], /structuralChecks\[0\]\.points/],
    [[{ ...valid, struc: { name: 'Stack' } }], /Unbekanntes Feld "structuralChecks\[0\]\.struc"/],
    [[{ ...valid, scopes: [{ in: 'Stack.pop', forbiddenOperations: ['malloc'] }] }], /scopes\[0\]\.forbiddenOperations\[0\]/],
    [[{ ...valid, scopes: [{ in: 'Stack.pop', requiredCalls: ['x'], allowedCalls: [] }] }], /"x" ist zugleich durch eine Aufrufregel verboten/],
    [[{ ...valid, scopes: [{ in: 'Stack.pop', requiredFields: ['data'] }] }], /requiredFields\[0\].*Stack.data/],
    [[{ ...valid, scopes: [{ in: 'Stack.pop' }] }], /mindestens eine Aufruf-, Feld- oder Verbotsregel/],
    [[{ ...valid, struct: { name: 'Stack', methods: [{ name: 'push', arity: 1.5 }] } }], /methods\[0\]\.arity.*ganzzahlig/]
  ];
  for (const [input, pattern] of badInputs) {
    await assert.rejects(evaluate('print 1\n', assignment([alwaysPasses], input)), error => {
      assert.equal(error.code, 4);
      assert.match(error.stderr, pattern);
      assert.doesNotMatch(error.stdout, /Grade/);
      return true;
    });
  }
});

test('Versteckte Tests verraten keine Namen, Testeingaben, Diagnosen oder Laufzeitdetails', async () => {
  const source = `func fails(value)
    throw value
`;
  const tests = [
    { name: 'PRIVATE_NAME_1', hidden: true, points: 1,
      harness: 'print "PRIVATE_INPUT_1"', expectedOutput: 'PRIVATE_EXPECTED' },
    { name: 'PRIVATE_NAME_2', hidden: true, points: 1,
      harness: 'print PRIVATE_REFERENCE', expectedOutput: '' },
    { name: 'PRIVATE_NAME_3', hidden: true, points: 1,
      harness: 'fails("PRIVATE_THROW")', expectedOutput: '' },
    { name: 'PRIVATE_NAME_4', hidden: true, points: 1,
      harness: 'print "PRIVATE_INPUT_2"', expectedOutput: 'PRIVATE_INPUT_2' }
  ];
  const { stdout, stderr } = await evaluate(source, assignment(tests));
  assert.equal(stderr, '');
  assert.match(stdout, /\[OK\] Versteckter Test 4/);
  assert.match(stdout, /Die Ausgabe des versteckten Tests stimmt nicht/);
  assert.match(stdout, /Der versteckte Test konnte nicht vorbereitet werden/);
  assert.match(stdout, /Der versteckte Test konnte wegen eines Laufzeitfehlers nicht abgeschlossen werden/);
  assert.doesNotMatch(stdout, /PRIVATE_|generated-javascript|Laufzeitfehler \(Exit-Code/);
  assert.match(stdout, /^Grade :=>>25$/m);
});
