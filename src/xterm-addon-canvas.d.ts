// Ambient shim for the OPTIONAL xterm canvas renderer addon. HeadTerminal loads it via a
// best-effort dynamic `import('xterm-addon-canvas')` on the iOS mirror path only; it is deliberately
// NOT a hard/peer dependency (the DOM renderer is the always-available fallback). Declared here so
// the `tsc --noEmit` gate resolves that dynamic import without pulling the deprecated package into
// the dependency tree. (Surfaced by the strict-typecheck gate, task 89ee0f.)
declare module 'xterm-addon-canvas' {
  import type { ITerminalAddon } from 'xterm';
  export class CanvasAddon implements ITerminalAddon {
    activate(terminal: unknown): void;
    dispose(): void;
  }
}
