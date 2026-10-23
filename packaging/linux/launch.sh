#!/bin/sh
# Spyro Studio launcher (portable / Debian).
DIR="$(cd "$(dirname "$0")" && pwd)"

# Prefer a Node runtime bundled with the app, else the system Node (>=18).
if [ -x "$DIR/runtime/bin/node" ]; then
  NODE="$DIR/runtime/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "Spyro Studio: Node.js 18+ is required and was not found."
  echo "  Debian/Ubuntu: sudo apt install nodejs"
  echo "  Fedora:        sudo dnf install nodejs"
  echo "  Or use install.sh to download a private Node runtime."
  exit 1
fi

exec "$NODE" "$DIR/launcher/launcher.js" "$@"
