# Stockfish

Official Stockfish 19 build (`sf_19`, released 2026-09-05) for macOS,
universal binary for Apple Silicon and Intel. Downloaded from
https://github.com/official-stockfish/Stockfish/releases/tag/sf_19.
Licence: GPL-3.0 (see Copying.txt). The neural networks are embedded in the
binary, so this single file is all the engine needs.

The app's main process looks for `stockfish-macos-universal` in this folder
(electron/engine.cjs, `bundledEnginePath()`), and the renderer's native engine
provider (src/engine/registry.ts) uses it automatically unless a different
binary has been configured with `setNativeEnginePath()`.

To refresh to the latest release, or to install on another platform:

```bash
npm run fetch:stockfish
```

`UCI-Protocol.md` is the upstream reference for the commands the engine
understands.
