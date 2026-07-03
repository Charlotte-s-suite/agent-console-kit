// @charlotte/agent-console-kit — shared agent-console primitives.
// SINGLE SOURCE OF TRUTH: both hydra-hq and merritt import from here. Fix a bug once, both get it.
// The crown jewels (v0.2): the PTY-over-SSE terminal engine + the slash-command composer,
// parameterized (sessionTarget/apiBase — hydra-hq PR #122 pinned the contract). Consumers
// provide react + xterm (peer deps).
export { default as HeadTerminal, type HeadTerminalProps } from './HeadTerminal';
export { default as Composer } from './Composer';
export { type SlashCommand, type CommandsResponse } from './types';
export { default as TuiKeyboard } from './TuiKeyboard';
export { default as RichMarkdown, CodeBlock, DiffBlock, looksLikeDiff } from './render/RichMarkdown';
export { tokenize, type TokClass } from './render/highlight';
export { safeUrl } from './render/sanitizeUrl';
export { C } from './render/tokens';
export { visiblePoll } from './usePoll';
export { useMediaQuery, useIsMobile, MOBILE_QUERY } from './useMediaQuery';
