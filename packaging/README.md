# Packaging — Spyro Studio

Build every installable artifact:

    npm run package

Output lands in `dist-package/`:

| Artifact | Target | Notes |
|---|---|---|
| `claude-free-spyro-<v>-linux-x64.tar.gz` | Linux (any x64) | Portable; `./install.sh`, no root |
| `claude-free_<v>_amd64.deb` | Debian / Ubuntu | Needs `dpkg-deb` (run the build on Debian) |
| `claude-free-spyro-<v>-win-x64.zip` | Windows 10/11 | `install.ps1`, then `Spyro Studio.cmd` |
| `claude-free-spyro-<v>-macos.zip` | macOS | `Spyro Studio.app` bundle |

## Targets in one sentence each

- **Web** — already covered: it's a web app. `/manifest.webmanifest` + `/sw.js`
  make it installable as a PWA (Chrome/Edge "Install app") and it opens offline
  from the cached shell once the server is running.
- **Linux** — portable tarball works everywhere; the `.deb` adds a
  `/usr/bin/claude-free` symlink and a `.desktop` entry.
- **Windows** — `install.ps1` copies to `%LOCALAPPDATA%\Programs\Spyro Studio`
  and appends it to the user PATH.
- **macOS** — `.app` bundle that launches the same shell launcher.

## Bundling a Node runtime (optional)

The launcher prefers `packaging/runtime/bin/node` (or `node.exe`) over a system
Node, so the app can run on a machine with no Node installed. Drop a Node
build from https://nodejs.org/dist/ into `packaging/runtime/` and rebuild.

## Notes

- The runtime dependency closure is computed from the installed tree, so it
  can't drift out of sync with `package.json`.
- All user data lives in `~/.claude-free` (or `%USERPROFILE%\.claude-free`),
  never inside the installed app, so upgrades never lose history.
