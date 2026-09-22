#!/bin/bash
# Erstellt den interaktiven Pseudo2-Startbefehl fuer Moodle VPL.
set -u

cat > vpl_execution <<'PSEUDO2_VPL_EXECUTION'
#!/bin/bash
set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_FILE="${PSEUDO2_SOURCE:-main.pseudo2}"

case "$SOURCE_FILE" in
    /*) ;;
    *) SOURCE_FILE="$SCRIPT_DIR/$SOURCE_FILE" ;;
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
    echo "Pseudo2 kann nicht gestartet werden: Node.js wurde nicht gefunden." >&2
    exit 1
fi
if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=10)?0:1)' 2>/dev/null; then
    echo "Pseudo2 benoetigt Node.js >= 20.10.0. Gefunden: $("$NODE_BIN" --version 2>/dev/null || echo unbekannt)" >&2
    exit 1
fi
if [ ! -f "$RUNNER_FILE" ]; then
    echo "Pseudo2-Runner fehlt: $RUNNER_FILE" >&2
    exit 1
fi
if [ ! -f "$SOURCE_FILE" ]; then
    echo "Keine Abgabe gefunden: $SOURCE_FILE" >&2
    exit 1
fi

exec "$NODE_BIN" "$RUNNER_FILE" run "$SOURCE_FILE"
PSEUDO2_VPL_EXECUTION

chmod +x vpl_execution
