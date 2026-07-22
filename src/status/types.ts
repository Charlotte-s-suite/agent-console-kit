// Shared types for the StatusLine data-line (C2, ported from hydra-hq as transport-agnostic kit
// components). The line is pure presentation + delegated actions: the consumer polls the data and
// supplies the action callbacks; the kit owns rendering, the responsive shedding, and the small
// controls' state machines (hold-to-confirm, the context-pressure gauge, the busy debounce).

// The agent's live busy-state. hydra-hq's collector emits 'working' | 'waiting-input' | 'idle' |
// 'offline'; a consumer maps its own vocabulary onto this union (merritt's 'stalled' → 'waiting').
export type HeadStatus = 'working' | 'waiting' | 'idle' | 'offline' | null;

// {context, output} tokens of the agent's last assistant turn — derived from the session transcript
// by the consumer's backend (hydra-hq: input + cache_read + cache_creation = context; output_tokens
// = output). The kit only formats it.
export type SessionUsage = { context: number; output: number };

// One model-scoped weekly plan limit (e.g. a separate Fable weekly cap). `active` = the binding
// constraint right now (amber-flagged so the limit that bites first stands out).
export type ModelLimit = { name: string; pct?: number | null; active?: boolean };

// Account Claude-plan utilisation: daily (5-hour) + weekly (7-day) + any model-scoped weekly caps.
export type Limits = { session_pct?: number; weekly_pct?: number; model_limits?: ModelLimit[] };

// The action callbacks the consumer wires to its own transport. Compact/refresh resolve a boolean
// (true = the operation was accepted, e.g. a 2xx) so the button can reflect done/error — a rejection
// maps to an error state too. Interrupt is fire-and-forget (its effect shows up in the next status
// poll). NONE of these are the kit's concern to implement; it only calls them.
export type CompactAction = () => Promise<boolean>;
export type RefreshAction = () => Promise<boolean>;
export type InterruptAction = () => void | Promise<void>;
