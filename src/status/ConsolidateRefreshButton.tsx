import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { C } from '../render/tokens';
import type { HeadStatus, RefreshAction } from './types';

// ConsolidateRefreshButton (♻️) — sits next to the per-agent context/token tracker. Tapping triggers,
// for that session, a memory-consolidation sweep then a context /clear (the consumer's backend defers
// the /clear until the agent returns to idle, so it never lands mid-task). Transport-agnostic (ported
// from hydra-hq): the consumer supplies `onRefresh` (it does the backend call). This is DESTRUCTIVE
// (/clear wipes live context), so it carries three guards:
//   1. IDLE-ONLY — the button is inert unless status is 'idle' (the consumer's backend + relay also
//      enforce this; the UI just shouldn't offer it on a working/waiting/offline agent).
//   2. HOLD-TO-CONFIRM — a deliberate ~1.2s press-and-hold (a fill ring grows); a quick tap does
//      nothing, so it can't be fired by accident.
//   3. never silent — the button reflects sending / done / failed so the operator sees what happened.
const HOLD_MS = 1200;

type Phase = 'ready' | 'holding' | 'sending' | 'done' | 'error';

export type ConsolidateRefreshButtonProps = {
  status: HeadStatus;
  onRefresh: RefreshAction;
};

export default function ConsolidateRefreshButton({ status, onRefresh }: ConsolidateRefreshButtonProps) {
  const idle = status === 'idle';
  const [phase, setPhase] = useState<Phase>('ready');
  const [fill, setFill] = useState(0);            // 0..100, drives the hold ring
  // transient touch feedback — same as CompactButton: a tap (or a tap on a busy agent) pops a hint
  // bubble instead of silently doing nothing (hover titles don't exist on the phone)
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
      const ok = await onRefresh();
      setPhase(ok ? 'done' : 'error');
      // the /clear is DEFERRED until the agent next idles — with no immediate context drop it can look
      // like nothing happened, so say so explicitly (Schyler 2026-07-08).
      if (ok) showHint('♻ queued — clears when idle');
    } catch {
      setPhase('error');
    }
    window.setTimeout(() => setPhase('ready'), 4000);
  };

  const beginHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase === 'sending') return;
    if (!idle) { showHint(`agent is ${status ?? 'busy'} — ♻ needs idle`); return; }
    // capture the pointer so a finger drift off this tiny target can't cancel the 1.2s hold — the bug
    // that made ♻ feel dead on the phone (pointerleave fired mid-hold). (Schyler 2026-07-08)
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pre-pointer-capture browsers */ }
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

  const label = phase === 'sending' ? '…' : phase === 'done' ? '✓' : phase === 'error' ? '✗' : '♻';
  const color = phase === 'error' ? C.red : phase === 'done' ? C.green : phase === 'holding' ? C.amber : idle ? C.muted : C.faint;
  const title = !idle
    ? `consolidate + refresh — agent is '${status ?? 'unknown'}', only available when idle`
    : phase === 'holding' ? 'keep holding to confirm…'
    : phase === 'sending' ? 'dispatching…'
    : phase === 'done' ? 'consolidation queued — /clear will fire once idle'
    : phase === 'error' ? 'failed — see console'
    : 'HOLD to consolidate memory + refresh context (destructive: clears this session)';

  // released too early = a tap → teach the hold instead of doing nothing
  const endHold = () => {
    if (phase === 'holding' && Date.now() - start.current < HOLD_MS) showHint('HOLD ~1.2s to consolidate + clear');
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
      aria-label="consolidate memory and refresh context"
      title={title}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerCancel={cancel}
      style={{
        position: 'relative', flexShrink: 0, cursor: idle ? 'pointer' : 'not-allowed',
        fontFamily: C.mono, fontSize: 10, lineHeight: 1, color,
        // hazard stripes (facelift slice B): destructive-hold visual language shared with the
        // lifecycle kill/bypass buttons — faint tape at rest, denser stripe in the confirm-fill
        background: 'repeating-linear-gradient(135deg, rgba(245,166,35,.09) 0 6px, transparent 6px 12px)',
        border: `1px solid ${phase === 'holding' ? C.amber : C.line}`, borderRadius: C.radius,
        padding: '1px 4px', overflow: 'hidden', opacity: idle || phase !== 'ready' ? 1 : 0.45,
        WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none',
      }}
    >
      {phase === 'holding' && (
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`,
          background: 'repeating-linear-gradient(135deg, rgba(245,166,35,.38) 0 6px, rgba(245,166,35,.20) 6px 12px)',
          pointerEvents: 'none', transition: 'width 60ms linear' }} />
      )}
      <span style={{ position: 'relative' }}>{label}</span>
    </button>
    </span>
  );
}
