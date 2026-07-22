import { useEffect, useRef, useState } from 'react';
import { C } from '../render/tokens';
import type { HeadStatus, CompactAction } from './types';

// CompactButton (⊟) — sits right beside the per-agent context counter and triggers a `/compact` on
// that session. Transport-agnostic (ported from hydra-hq): the consumer supplies `onCompact` (it does
// the send — hydra-hq/merritt POST `/compact` down their audited input path); the kit owns the
// button. Unlike the ♻️ consolidate+refresh next door this is NON-destructive (compaction keeps a
// summary), so it carries a lighter hold (~0.7s vs 1.2s) — still deliberate enough that a stray tap
// on the phone does nothing. IDLE-ONLY like ♻️: a /compact typed at a working/waiting agent would
// queue into (or derail) the live turn, so the button is inert until the session settles.
//
// The button doubles as the context-pressure gauge (Schyler's spec, 2026-07-03):
//   < 200k  → quiet (muted, like its neighbors)
//   ≥ 200k  → amber   — worth compacting soon
//   ≥ 400k  → red     — compact at the next idle
//   ≥ 600k  → BLINKING red — you're burning window; compact now
const HOLD_MS = 700;
export const AMBER_AT = 200_000;
export const RED_AT = 400_000;
export const BLINK_AT = 600_000;

type Phase = 'ready' | 'holding' | 'sending' | 'done' | 'error';

export function urgency(ctx: number | null | undefined): { color: string; blink: boolean; tier: string } {
  const n = ctx ?? 0;
  if (n >= BLINK_AT) return { color: C.red, blink: true, tier: '≥600k — compact NOW' };
  if (n >= RED_AT) return { color: C.red, blink: false, tier: '≥400k — compact at next idle' };
  if (n >= AMBER_AT) return { color: C.amber, blink: false, tier: '≥200k — worth compacting soon' };
  return { color: C.muted, blink: false, tier: 'context healthy' };
}

export type CompactButtonProps = {
  status: HeadStatus;
  contextTokens: number | null | undefined;
  onCompact: CompactAction;
};

export default function CompactButton({ status, contextTokens, onCompact }: CompactButtonProps) {
  const idle = status === 'idle';
  const [phase, setPhase] = useState<Phase>('ready');
  const [fill, setFill] = useState(0);            // 0..100, drives the hold ring
  // transient touch feedback — hover titles don't exist on the phone, so a quick TAP (or a tap on
  // a busy agent) pops this bubble instead of silently eating the gesture (Schyler hit exactly that:
  // "clicking the compact button, nothing happens" — it was hold-to-confirm + idle-only, unexplained)
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const hintTimer = useRef<number | null>(null);
  const start = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const showHint = (msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 1800);
  };

  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    setFill(0);
    setPhase((p) => (p === 'holding' ? 'ready' : p));
  };

  const fire = async () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    setFill(0);
    setPhase('sending');
    try {
      const ok = await onCompact();
      setPhase(ok ? 'done' : 'error');
    } catch {
      setPhase('error');
    }
    window.setTimeout(() => setPhase('ready'), 4000);
  };

  const beginHold = () => {
    if (phase === 'sending') return;
    if (!idle) { showHint(`agent is ${status ?? 'busy'} — /compact needs idle`); return; }
    setPhase('holding');
    start.current = Date.now();
    const tick = () => {
      const pct = Math.min(100, ((Date.now() - start.current) / HOLD_MS) * 100);
      setFill(pct);
      if (pct < 100) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    timer.current = window.setTimeout(fire, HOLD_MS);
  };

  const u = urgency(contextTokens);
  const elevated = u.color !== C.muted;   // ≥200k — the gauge stays lit even while the button is inert
  const label = phase === 'sending' ? '…' : phase === 'done' ? '✓' : phase === 'error' ? '✗' : '⊟';
  const color = phase === 'error' ? C.red : phase === 'done' ? C.green : phase === 'holding' ? C.amber
    : elevated ? u.color : idle ? C.muted : C.faint;
  const title = phase === 'holding' ? 'keep holding to confirm…'
    : phase === 'sending' ? 'dispatching /compact…'
    : phase === 'done' ? '/compact sent'
    : phase === 'error' ? 'failed — see console'
    : !idle ? `compact context (${u.tier}) — agent is '${status ?? 'unknown'}', available when idle`
    : `HOLD to /compact this session (${u.tier})`;

  // released too early = a tap → teach the hold instead of doing nothing
  const endHold = () => {
    if (phase === 'holding' && Date.now() - start.current < HOLD_MS) showHint('HOLD ~1s to /compact');
    cancel();
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      {hint && (
        <span style={{ position: 'absolute', bottom: 'calc(100% + 5px)', right: 0, zIndex: 40, whiteSpace: 'nowrap',
          background: 'rgba(18,26,18,.97)', border: `1px solid ${C.amber}`, color: C.amber, borderRadius: 4,
          fontSize: 10, fontFamily: C.mono, padding: '3px 7px', boxShadow: '0 4px 14px rgba(0,0,0,.5)', textTransform: 'none' }}>
          {hint}
        </span>
      )}
    <button
      type="button"
      aria-label="compact this session's context"
      title={title}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      style={{
        position: 'relative', flexShrink: 0, cursor: idle ? 'pointer' : 'not-allowed',
        fontFamily: C.mono, fontSize: 10, lineHeight: 1, color, background: 'transparent',
        border: `1px solid ${phase === 'holding' ? C.amber : u.blink ? C.red : C.line}`, borderRadius: C.radius,
        padding: '1px 4px', overflow: 'hidden', opacity: idle || elevated || phase !== 'ready' ? 1 : 0.45,
        WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none',
        // ≥600k: the whole button blinks — the "you're burning window" alarm (reuses the waiting-dot keyframes)
        animation: u.blink && phase === 'ready' ? 'hq-dot-blink 1.2s steps(1) infinite' : undefined,
      }}
    >
      {phase === 'holding' && (
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`,
          background: 'rgba(255,207,92,.25)', pointerEvents: 'none', transition: 'width 60ms linear' }} />
      )}
      <span style={{ position: 'relative' }}>{label}</span>
    </button>
    </span>
  );
}
