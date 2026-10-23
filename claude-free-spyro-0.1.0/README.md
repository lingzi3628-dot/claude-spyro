# Spyro Studio (Linux)

A free, provider-agnostic AI coding agent that runs entirely on your machine.

## Install (no root needed)
```
tar -xzf claude-free-spyro-<version>-linux-x64.tar.gz
cd claude-free-spyro-<version>-linux-x64
./install.sh
claude-free
```

## Install as a Debian package
```
sudo apt install ./claude-free_<version>_amd64.deb
claude-free
```

## Requirements
- Linux x64, Node.js 18+ (or use the bundled runtime after `install.sh`)
- A model: point it at Ollama (fully offline) or any free provider key.

## Notes
- Your workspace defaults to ~/claude-projects; you can point it anywhere in Settings.
- Config, sessions and plugins live in ~/.claude-free (never inside the app).
- The agent cannot modify its own installation directory.
