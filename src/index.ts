// @charlotte/agent-console-kit — shared agent-console primitives.
// SINGLE SOURCE OF TRUTH: both hydra-hq and merritt import from here. Fix a bug once, both get it.
// The crown jewels (v0.2): the PTY-over-SSE terminal engine + the slash-command composer,
// parameterized (sessionTarget/apiBase — hydra-hq PR #122 pinned the contract). Consumers
// provide react + xterm (peer deps).
export { default as HeadTerminal, type HeadTerminalProps } from './HeadTerminal';
export { default as Composer } from './Composer';
export { type SlashCommand, type CommandsResponse } from './types';
export { default as TuiKeyboard } from './TuiKeyboard';
export { default as RichMarkdown, CodeBlock, DiffBlock, looksLikeDiff, InlineText, PathToken, isPathToken } from './render/RichMarkdown';
export { default as PreviewDock } from './render/PreviewDock';
export { tokenize, type TokClass } from './render/highlight';
export { safeUrl } from './render/sanitizeUrl';
export { C } from './render/tokens';
export { visiblePoll } from './usePoll';
export { useMediaQuery, useIsMobile, MOBILE_QUERY } from './useMediaQuery';

// ❓ explain / ✍️ sharpen — the Sonnet sidecar (v0.10.0). Transport-agnostic: the consumer supplies
// a `postWorkshop(payload)` callback and its turn `adapter`; the kit owns the state machine + UI.
// Pure logic (ported from hydra-hq's explain.ts) + two hooks + five drop-in components.
export {
  EXPLAIN_CONTEXT_TURNS, explainRequest, followupThread, priorContext,
  turnIndexOfNode, resolveSelection, flatTurnAdapter, blockTurnAdapter,
  type ExplainAdapter, type ExplainPair, type ExplainRequest, type FlatTurn, type BlockTurn,
} from './workshop/explain';
export {
  useExplain, useSharpen,
  TurnExplainButton, SelectionExplainChip, ExplainCard, SharpenButton, OpenQuestionsStrip,
  type WorkshopPost, type ExplainCardState, type SelChip,
} from './workshop/WorkshopSidecar';
