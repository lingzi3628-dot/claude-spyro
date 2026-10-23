# runtime/

Drop a platform Node.js runtime here and it will be used automatically instead
of a system Node, so the packaged app runs without requiring Node installed.

    runtime/bin/node          (linux-x64 / macos)
    runtime/node.exe          (win-x64)

Download from https://nodejs.org/dist/ — copy the whole extracted
`node-vXX.Y.Z-<platform>` folder's `bin/node` (or `node.exe`) into `runtime/`.
The launcher prefers the bundled runtime and falls back to a system Node.
