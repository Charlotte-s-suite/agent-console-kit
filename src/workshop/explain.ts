// ❓ explain / ✍️ sharpen — the transport-agnostic PURE LOGIC for the console's Sonnet sidecars.
// Ported and generalized from hydra-hq's frontend/src/pages/hq/explain.ts (PR #349) so hydra-hq and
// merritt share ONE source of truth instead of drifting copies. Nothing here touches an agent's
// session — the sidecars are operator-side comprehension/drafting tools, read-only by construction.
//
// Generalization vs. the hq original: hq's turn is a `ConsoleTurn` with a Claude-Code block union
// (text/thinking/tool_use/diff/…). Merritt's transcript is flat `{ role, text }`. So the two
// turn-shape-dependent bits — the explainable prose of a turn, and its role-tagged flattening for
// context — are lifted into an `ExplainAdapter<T>` the consumer supplies. Two ready adapters ship:
// `flatTurnAdapter` (merritt) and `blockTurnAdapter` (hq's shape, for hq's future kit adoption).
//
// The DOM selection→turn resolvers are DUCK-TYPED (not `instanceof Element` like hq) so they run
// identically in the browser AND are unit-testable with lightweight fakes — the kit stays free of a
// jsdom/happy-dom dev dependency, matching its dependency-free ethos.

// mirrors hq's WORKSHOP_CONTEXT_TURNS / relay CONTEXT_TURNS — how many prior turns ride along
export const EXPLAIN_CONTEXT_TURNS = 3;

export type ExplainPair = { q: string; a: string };

export type ExplainRequest = {
  mode: 'explain';
  turn: string;
  excerpt?: string;
  context: string[];
  prior_qa?: ExplainPair[];
};

// The consumer's turn shape is opaque to the kit. An adapter names the only two projections the
// explain logic needs: `text` — the explainable prose of a turn; `context` — a compact role-tagged
// flattening for use as prior context ('' when the turn carries nothing). Everything else
// (selection resolution, request assembly, the follow-up thread convention) is shape-independent.
export type ExplainAdapter<T> = {
  text: (turn: T) => string;
  context: (turn: T) => string;
};

// ---- ready-made adapters ------------------------------------------------------------------------

// Flat `{ role, text }` transcript turns (merritt studio's /transcript shape). The role tag mirrors
// hq: user → operator, assistant → head; anything else passes through verbatim.
export type FlatTurn = { role: string; text?: string | null };
export const flatTurnAdapter: ExplainAdapter<FlatTurn> = {
  text: (t) => (t.text ?? '').trim(),
  context: (t) => {
    const body = (t.text ?? '').trim();
    if (!body) return '';
    const role = t.role === 'user' ? 'operator' : t.role === 'assistant' ? 'head' : t.role;
    return `${role}: ${body}`;
  },
};

// Claude-Code block turns (`{ type, blocks:[{kind,…}] }`) — hq's ConsoleTurn shape. Kept faithful to
// hq's turnText / turnContextText so hq can adopt the kit without behavior change. Non-text blocks
// collapse to short tags so a tool-heavy turn still contributes its shape without dumping raw JSON.
export type BlockTurn = {
  type?: string;
  blocks: Array<{ kind: string; [k: string]: unknown }>;
};
export const blockTurnAdapter: ExplainAdapter<BlockTurn> = {
  text: (t) =>
    t.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .trim(),
  context: (t) => {
    const parts = t.blocks
      .map((b) => {
        switch (b.kind) {
          case 'text': return String((b as { text: string }).text).trim();
          case 'thinking': return '[thinking]';
          case 'tool_use': return `[tool: ${(b as { name: string }).name}]`;
          case 'diff': return `[edited ${(b as { file?: string }).file ?? 'a file'}]`;
          case 'tool_result': return (b as { is_error?: boolean }).is_error ? '[tool error]' : '[tool result]';
          case 'ask': return '[asked a question]';
          default: return '';
        }
      })
      .filter(Boolean);
    if (!parts.length) return '';
    const role = t.type === 'user' ? 'operator' : t.type === 'assistant' ? 'head' : String(t.type);
    return `${role}: ${parts.join(' ')}`;
  },
};

// ---- request assembly ---------------------------------------------------------------------------

// The up-to-n prior turns before `index` (oldest first), flattened for context. Empty turns skipped.
export function priorContext<T>(
  turns: T[], index: number, adapter: ExplainAdapter<T>, n = EXPLAIN_CONTEXT_TURNS,
): string[] {
  if (index <= 0) return [];
  const start = Math.max(0, index - n);
  const out: string[] = [];
  for (let i = start; i < index; i++) {
    const c = adapter.context(turns[i]);
    if (c) out.push(c);
  }
  return out;
}

// Build the POST body for an explain turn: the subject turn's prose, the highlighted excerpt (if
// any, trimmed and only when non-empty), and the prior context. `prior_qa` is folded in by the
// caller for follow-ups (see followupThread).
export function explainRequest<T>(
  turns: T[], index: number, adapter: ExplainAdapter<T>, excerpt?: string,
): ExplainRequest {
  const ex = excerpt?.trim();
  return {
    mode: 'explain',
    turn: adapter.text(turns[index]),
    ...(ex ? { excerpt: ex } : {}),
    context: priorContext(turns, index, adapter),
  };
}

// The follow-up thread to send: the completed {q,a} pairs so far, plus the new pending question as a
// trailing pair with an empty answer (the relay treats an empty-answer trailing pair as "the current
// question"). Filtering to `a`-bearing pairs drops any stale pending entry before re-appending.
export function followupThread(prior: ExplainPair[], question: string): ExplainPair[] {
  return [...prior.filter((p) => p.a), { q: question.trim(), a: '' }];
}

// ---- selection → turn resolution ----------------------------------------------------------------

// The minimal node/selection shapes the resolvers touch — duck-typed so real DOM Elements/Selections
// satisfy them in the browser and plain test doubles satisfy them under vitest (no DOM env needed).
type NodeLike = {
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
  parentNode?: NodeLike | null;
};
type RootLike = { contains: (node: unknown) => boolean } | null;
type SelectionLike = {
  isCollapsed: boolean;
  anchorNode: NodeLike | null;
  focusNode: NodeLike | null;
  toString(): string;
} | null;

// Walk up from a node to the nearest ancestor tagged data-turn-index; return that index, or null if
// the node isn't inside a turn. Stops at `root`. A text node (no hasAttribute) is skipped, exactly
// as hq's `instanceof Element` guard did — here via a duck-typed `typeof …hasAttribute`.
export function turnIndexOfNode(node: NodeLike | null, root: NodeLike | null): number | null {
  let el: NodeLike | null = node;
  while (el && el !== root) {
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-turn-index')) {
      const n = Number(el.getAttribute?.('data-turn-index'));
      return Number.isInteger(n) ? n : null;
    }
    el = el.parentNode ?? null;
  }
  return null;
}

// Resolve a live text selection into the turn it lives in + the selected text. Returns null unless:
// the selection is non-empty, both ends sit inside `root` (the chat pane), and both ends resolve to
// the SAME turn (never explain a span that straddles two turns). This scopes the ❓ chip to one turn.
export function resolveSelection(
  sel: SelectionLike, root: RootLike,
): { index: number; excerpt: string } | null {
  if (!sel || sel.isCollapsed || !root) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode ?? anchor;
  if (!anchor || !root.contains(anchor) || !focus || !root.contains(focus)) return null;
  const ai = turnIndexOfNode(anchor, root as NodeLike);
  const fi = turnIndexOfNode(focus, root as NodeLike);
  if (ai === null || ai !== fi) return null;
  return { index: ai, excerpt: text };
}
