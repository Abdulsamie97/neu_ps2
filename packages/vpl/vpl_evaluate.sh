#!/bin/bash
# Erstellt den automatischen Pseudo2-Bewerter fuer Moodle VPL.
set -u

cat > vpl_execution <<'PSEUDO2_VPL_EXECUTION'
#!/bin/bash
set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_FILE="${PSEUDO2_SOURCE:-main.pseudo2}"
ASSIGNMENT_FILE="${PSEUDO2_ASSIGNMENT:-assignment.json}"

case "$SOURCE_FILE" in
    /*) ;;
    *) SOURCE_FILE="$SCRIPT_DIR/$SOURCE_FILE" ;;
esac
case "$ASSIGNMENT_FILE" in
    /*) ;;
    *) ASSIGNMENT_FILE="$SCRIPT_DIR/$ASSIGNMENT_FILE" ;;
esac

if [ -n "${PSEUDO2_RUNNER:-}" ]; then
    RUNNER_FILE="$PSEUDO2_RUNNER"
elif [ -f "$SCRIPT_DIR/pseudo2-vpl.mjs" ]; then
    RUNNER_FILE="$SCRIPT_DIR/pseudo2-vpl.mjs"
else
    RUNNER_FILE=/opt/pseudo2-vpl/pseudo2-vpl.mjs
fi

if [ -n "${PSEUDO2_NODE:-}" ]; then
    NODE_BIN="$PSEUDO2_NODE"
elif [ -x /opt/node20/bin/node ]; then
    NODE_BIN=/opt/node20/bin/node
else
    NODE_BIN="$(command -v node 2>/dev/null || true)"
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "Comment :=>>Pseudo2-Konfigurationsfehler"
    echo '<|--'
    echo "Node.js wurde nicht gefunden."
    echo '--|>'
    echo "Grade :=>>0"
    exit 1
fi
if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=10)?0:1)' 2>/dev/null; then
    echo "Comment :=>>Pseudo2-Konfigurationsfehler"
    echo '<|--'
    echo "Node.js >= 20.10.0 ist erforderlich. Gefunden: $("$NODE_BIN" --version 2>/dev/null || echo unbekannt)"
    echo '--|>'
    echo "Grade :=>>0"
    exit 1
fi
if [ ! -f "$RUNNER_FILE" ] || [ ! -f "$ASSIGNMENT_FILE" ] || [ ! -f "$SOURCE_FILE" ]; then
    echo "Comment :=>>Pseudo2-Konfigurationsfehler"
    echo '<|--'
    echo "Runner, assignment.json oder main.pseudo2 fehlt."
    echo '--|>'
    echo "Grade :=>>0"
    exit 1
fi

exec "$NODE_BIN" "$RUNNER_FILE" evaluate "$SOURCE_FILE" "$ASSIGNMENT_FILE"
PSEUDO2_VPL_EXECUTION

chmod +x vpl_execution
