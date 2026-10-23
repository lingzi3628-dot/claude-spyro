#!/bin/sh
# Spyro Studio — portable installer.
# Installs to ~/.local/share/claude-free and links a launcher into ~/.local/bin.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local/share/claude-free}"
BIN="$HOME/.local/bin"

echo "Installing Spyro Studio → $PREFIX"
mkdir -p "$PREFIX" "$BIN"
# Remove the previous install so stale hashed bundles (index-*.js/css) don't
# pile up — Vite rewrites the name every build and nothing ever cleaned them.
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
# Copy everything except the installer itself.
(cd "$DIR" && tar --exclude=./install.sh -cf - .) | (cd "$PREFIX" && tar -xf -)
chmod +x "$PREFIX/launch.sh" 2>/dev/null || true

cat > "$BIN/claude-free" <<LAUNCH
#!/bin/sh
exec "$PREFIX/launch.sh" "\$@"
LAUNCH
chmod +x "$BIN/claude-free"

echo "Installed. Run:  claude-free"
echo "Add $BIN to your PATH if 'claude-free: command not found'."
