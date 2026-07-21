import { useEffect, useRef, useState } from 'react';
import { C } from '../render/tokens';
import RichMarkdown from '../render/RichMarkdown';
import {
  explainRequest, followupThread,
  resolveSelection, type ExplainAdapter, type ExplainPair, type ExplainRequest,
} from './explain';

// ❓ explain + ✍️ sharpen — the Sonnet sidecar UI, extracted from hydra-hq's HeadConsole (PR #349)
// as transport-agnostic kit components. Both are OPERATOR-SIDE: they never touch the agent's
// session or transcript. The consumer owns transport via a single `postWorkshop(payload)` callback
// — it does the fetch/poll (or inline call) and resolves the parsed result; the kit owns the state
// machine + UI. Styling follows the kit's existing terminal register (C tokens), naked-glyph and
// minimal-chrome per Schyler's ratified density floor.

// The one transport primitive the consumer supplies. `payload` is the workshop job
// (`{mode:'explain', turn, …}` or `{mode:'sharpen', idea}`); it resolves the parsed result object
// (`{explanation}` for explain, `{draft, questions}` for sharpen) or REJECTS on failure — the hooks
// map a rejection to an inline error, never a throw that escapes the component.
export type WorkshopPost = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

// the active explanation card — anchored under one source turn (index), carrying its running Q&A
// thread. Ephemeral UI state: lost on unmount / reset by design — it never enters the transcript.
export type ExplainCardState = {
  index: number;
  excerpt?: string;
  qa: ExplainPair[];   // [{q:'', a:first}, {q, a}, …] — empty q = the initial explain
  busy: boolean;
  error: string | null;
};

// a floating ❓ chip for a live text selection inside the chat pane (viewport coords)
export type SelChip = { x: number; y: number; index: number; excerpt: string };

// ---- the explain controller hook ----------------------------------------------------------------

// Owns the explain card + selection-chip machinery for a chat pane. `turns` is the consumer's
// transcript, `adapter` projects a turn to its explainable text/context (see explain.ts),
// `scrollRef` is the chat scroll root the selection chip is scoped to, and `resetKey` (e.g. the head
// name) invalidates the card/chip on a head switch — the indices anchor to THIS head's turns.
export function useExplain<T>({
  turns, adapter, postWorkshop, scrollRef, active = true, resetKey,
}: {
  turns: T[];
  adapter: ExplainAdapter<T>;
  postWorkshop: WorkshopPost;
  scrollRef: { current: HTMLElement | null };
  active?: boolean;
  resetKey?: string;
}) {
  const [explain, setExplain] = useState<ExplainCardState | null>(null);
  const [selChip, setSelChip] = useState<SelChip | null>(null);
  const turnsRef = useRef<T[]>(turns);
  turnsRef.current = turns;
  const explainRef = useRef<ExplainCardState | null>(explain);
  explainRef.current = explain;
  // Monotonic per-request nonce (internal — no consumer API surface). Each explain/follow-up
  // dispatch claims the next value; a response is applied only while it is still the latest.
  // The card's `index` check alone can't catch a same-turn-index collision — e.g. excerpt-explain
  // turn 3 → close → whole-turn ❓ on turn 3: the in-flight excerpt-scoped answer shares the index
  // and would clobber the fresh card. The nonce drops any response a newer dispatch has superseded.
  // A ref (never state): it must not trigger a render and must read latest inside async callbacks.
  const reqNonce = useRef(0);

  // one explain post → the explanation string (or a mapped error). The relay stays stateless; a
  // follow-up rides as the trailing empty-answer pair in prior_qa (explain.ts::followupThread).
  const runExplain = async (
    body: ExplainRequest,
  ): Promise<{ ok: true; explanation: string } | { ok: false; error: string }> => {
    try {
      const res = await postWorkshop(body as unknown as Record<string, unknown>);
      const explanation = typeof res?.explanation === 'string' ? res.explanation : '';
      return explanation ? { ok: true, explanation } : { ok: false, error: '(no explanation returned)' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'explain failed' };
    }
  };

  // ❓ start an explanation of turn `index` (whole turn, or the highlighted `excerpt`). Opens the
  // card busy, fires the ephemeral call, lands the explanation as the thread's first entry.
  const startExplain = (index: number, excerpt?: string) => {
    const nonce = ++reqNonce.current;
    setExplain({ index, excerpt, qa: [], busy: true, error: null });
    void runExplain(explainRequest(turnsRef.current, index, adapter, excerpt)).then((res) => {
      if (reqNonce.current !== nonce) return;   // a newer dispatch superseded this — drop the result
      setExplain((cur) => {
        if (!cur || cur.index !== index) return cur;   // card closed / superseded — drop the result
        return res.ok
          ? { ...cur, busy: false, error: null, qa: [{ q: '', a: res.explanation }] }
          : { ...cur, busy: false, error: res.error };
      });
    });
  };

  // "ask more" — a follow-up on the open card. Re-posts mode=explain with the card's prior_qa thread
  // (the relay is stateless); the new answer appends to the thread.
  const askFollowup = (question: string) => {
    const card = explainRef.current;
    if (!card) return;
    const q = question.trim();
    if (!q || card.busy) return;
    const nonce = ++reqNonce.current;
    setExplain({ ...card, busy: true, error: null });
    const body: ExplainRequest = {
      ...explainRequest(turnsRef.current, card.index, adapter, card.excerpt),
      prior_qa: followupThread(card.qa, q),
    };
    void runExplain(body).then((res) => {
      if (reqNonce.current !== nonce) return;   // a newer dispatch superseded this — drop the result
      setExplain((cur) => {
        if (!cur || cur.index !== card.index) return cur;
        return res.ok
          ? { ...cur, busy: false, error: null, qa: [...cur.qa, { q, a: res.explanation }] }
          : { ...cur, busy: false, error: res.error };
      });
    });
  };

  const closeExplain = () => setExplain(null);

  // a head switch invalidates any open card / selection chip (they anchor to THIS head's indices) —
  // bump the nonce too so an in-flight response from the previous head can't land on the new one.
  useEffect(() => { setExplain(null); setSelChip(null); reqNonce.current++; }, [resetKey]);

  // float the ❓ chip near a text selection that lives INSIDE the chat pane. selectionchange only
  // fires on document, so we scope by containment against the scroll root and tear down on unmount.
  useEffect(() => {
    if (!active) return;
    const root = scrollRef.current;
    if (!root || typeof document === 'undefined') return;
    const onSel = () => {
      const sel = window.getSelection();
      const hit = resolveSelection(sel as Parameters<typeof resolveSelection>[0], root);
      if (!hit || !sel) { setSelChip(null); return; }
      let rect: DOMRect | null = null;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch { rect = null; }
      if (!rect || (rect.width === 0 && rect.height === 0)) { setSelChip(null); return; }
      setSelChip({ x: rect.left + rect.width / 2, y: rect.top, index: hit.index, excerpt: hit.excerpt });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [active, scrollRef]);

  return { explain, selChip, setSelChip, startExplain, askFollowup, closeExplain };
}

// ---- the sharpen controller hook ----------------------------------------------------------------

// Owns the ✍️ workshop's busy/questions/error state. `sharpen(idea)` posts mode=sharpen and resolves
// the precise directive draft (or null on failure/empty) — the CALLER lands it as editable draft
// text; the result is NEVER auto-sent (the operator's send stays the accountable act). Ambiguities
// the workshop refuses to decide come back as `questions`.
// (No request nonce here, deliberately: unlike useExplain, sharpen keys nothing by turn index, and
// the `!text || busy` guard serializes dispatch — a second sharpen can't start until the first
// resolves and clears busy — so there is no same-index collision for a stale response to win. The
// draft it returns lands via the caller's own await; there is no shared card for a stale answer to
// clobber. The nonce is scoped to the explain card, which is the race the kit-owner review flagged.)
export function useSharpen({ postWorkshop }: { postWorkshop: WorkshopPost }) {
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sharpen = async (idea: string): Promise<string | null> => {
    const text = (idea ?? '').trim();
    if (!text || busy) return null;
    setBusy(true); setError(null); setQuestions(null);
    try {
      const res = await postWorkshop({ mode: 'sharpen', idea: text });
      const draft = typeof res?.draft === 'string' ? res.draft : '';
      const qs = Array.isArray(res?.questions) ? (res.questions as string[]) : [];
      setQuestions(qs.length ? qs : null);
      return draft || null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'workshop failed');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { busy, questions, error, sharpen, dismissQuestions: () => setQuestions(null), setError };
}

// ---- components ---------------------------------------------------------------------------------

// ❓ the per-turn explain affordance — a naked glyph (Schyler's density floor: content over chrome).
// Tap → explain the whole turn (the mobile-primary path; a text selection floats the chip instead).
export function TurnExplainButton({ onExplain, canExplain = true }: { onExplain: () => void; canExplain?: boolean }) {
  if (!canExplain) return null;
  return (
    <button
      type="button" onClick={onExplain} aria-label="explain this turn"
      title="explain — what does this mean? (ephemeral Sonnet; read-only, never touches the head)"
      style={{
        alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
        color: C.faint, fontSize: 12, lineHeight: 1, padding: '0 2px', marginTop: -1,
      }}
    >❓</button>
  );
}

// ❓ the floating explain chip — near a text selection inside the chat pane; click posts the excerpt
// + its containing turn + prior context. mousedown-preventDefault so reading the selection doesn't
// collapse it first. Fixed-positioned in viewport coords (getBoundingClientRect).
export function SelectionExplainChip({ chip, onExplain }: { chip: SelChip | null; onExplain: (index: number, excerpt: string) => void }) {
  if (!chip) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onExplain(chip.index, chip.excerpt); window.getSelection()?.removeAllRanges(); }}
      style={{
        position: 'fixed', left: chip.x, top: Math.max(6, chip.y - 34), transform: 'translateX(-50%)',
        zIndex: 2500, fontFamily: C.mono, fontSize: 11, color: C.violet, cursor: 'pointer',
        background: 'rgba(10,8,16,.94)', border: `1px solid ${C.violet}`, borderRadius: C.radius,
        padding: '4px 9px', boxShadow: '0 3px 12px rgba(0,0,0,.5)', backdropFilter: 'blur(3px)', whiteSpace: 'nowrap',
      }}
    >❓ explain</button>
  );
}

// ❓ the explanation card — inline under its source turn. Shows the running Q&A thread (the ephemeral
// Sonnet's explanations + any follow-ups, rendered as markdown), a busy state while polling, errors
// in a strip (never silently dropped), and one small inline "ask more" input. Ephemeral: closing it
// (✕) or unmounting just drops it — nothing is sent to the head, nothing enters the transcript.
export function ExplainCard({ card, onFollowup, onClose }: { card: ExplainCardState; onFollowup: (q: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const answered = card.qa.some((p) => p.a);
  const submit = () => { if (q.trim() && !card.busy) { onFollowup(q); setQ(''); } };
  return (
    <div style={{
      marginTop: 6, marginBottom: 2, border: `1px solid ${C.violet}`, borderRadius: C.radius,
      background: 'rgba(157,124,255,.05)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.violet, fontWeight: 700 }}>
          ❓ explanation{card.excerpt ? ' · highlighted' : ''}
        </span>
        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.faint }}>ephemeral · read-only</span>
        <button type="button" onClick={onClose} aria-label="dismiss explanation"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: C.mono, fontSize: 11 }}>✕</button>
      </div>
      {card.excerpt && (
        <div style={{
          fontFamily: C.mono, fontSize: 10.5, color: C.muted, borderLeft: `2px solid ${C.violet}`,
          paddingLeft: 7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.9,
        }}>“{card.excerpt}”</div>
      )}
      {card.qa.map((p, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {p.q && <div style={{ fontFamily: C.mono, fontSize: 11, color: C.violet }}>› {p.q}</div>}
          {p.a && <RichMarkdown source={p.a} />}
        </div>
      ))}
      {card.busy && (
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.violet }}>❓ {answered ? 'thinking…' : 'explaining…'}</div>
      )}
      {card.error && (
        <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.red }}>❓ explain: {card.error}</div>
      )}
      {answered && !card.busy && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="ask more…"
            style={{
              flex: 1, minWidth: 0, background: C.panel2, border: `1px solid ${C.line2}`, borderRadius: C.radius,
              color: C.ink, fontFamily: C.sans, fontSize: 12, padding: '5px 8px', outline: 'none',
            }}
          />
          <button type="button" onClick={submit} disabled={!q.trim()} aria-label="ask follow-up"
            style={{
              background: 'transparent', border: `1px solid ${q.trim() ? C.violet : C.faint}`, borderRadius: C.radius,
              color: q.trim() ? C.violet : C.muted, fontFamily: C.mono, fontSize: 12, padding: '4px 9px',
              cursor: q.trim() ? 'pointer' : 'default',
            }}>↵</button>
        </div>
      )}
    </div>
  );
}

// ✍️ the sharpen button — sits by the composer. Disabled until there's a draft to sharpen; shows a
// busy label while the ephemeral turn runs. The result lands as editable draft text (never sent).
export function SharpenButton({ draft, busy, onSharpen }: { draft?: string; busy: boolean; onSharpen: () => void }) {
  const has = !!draft?.trim();
  return (
    <button
      type="button"
      disabled={busy || !has}
      onClick={onSharpen}
      title={has
        ? 'workshop — sharpen this rough idea into a precise directive (ephemeral Sonnet; the draft stays yours to edit and send)'
        : 'workshop — type a rough idea first'}
      style={{
        background: busy ? 'rgba(255,176,32,.10)' : 'transparent',
        border: `1px solid ${busy ? C.amber : C.faint}`, borderRadius: C.radius,
        color: busy ? C.amber : C.muted, fontFamily: C.mono, fontSize: 10.5,
        padding: '2px 10px', cursor: busy || !has ? 'default' : 'pointer',
      }}
    >{busy ? '✍️ sharpening…' : '✍️ workshop'}</button>
  );
}

// ✍️ the open-questions strip — ambiguities the workshop REFUSED to decide (its contract: never
// invent decisions). Sits by the composer until the operator resolves them in the draft or dismisses.
export function OpenQuestionsStrip({ questions, onDismiss }: { questions: string[] | null; onDismiss: () => void }) {
  if (!questions || !questions.length) return null;
  return (
    <div style={{
      border: `1px solid ${C.amber}`, borderRadius: 6, padding: '8px 10px',
      marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.amber, fontWeight: 700 }}>
          ✍️ open questions — the workshop won't decide these for you
        </span>
        <button type="button" onClick={onDismiss}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontFamily: C.mono, fontSize: 11 }}>✕</button>
      </div>
      {questions.map((qq, i) => (
        <div key={i} style={{ fontFamily: C.sans, fontSize: 11.5, color: C.ink }}>· {qq}</div>
      ))}
    </div>
  );
}
