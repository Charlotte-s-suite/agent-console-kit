import { useEffect, useRef, useState } from 'react';
import { C } from '../render/tokens';
import InterruptButton from './InterruptButton';
import ConsolidateRefreshButton from './ConsolidateRefreshButton';
import CompactButton from './CompactButton';
import type {
  HeadStatus, SessionUsage, Limits,
  CompactAction, RefreshAction, InterruptAction,
} from './types';

// StatusLine (C2) — a compact data-line rendered as the Composer's FOOTER: an animated busy/idle
// indicator (the "green light"), the agent name + running model, the session's live context + output
// tokens (with the ⊟ compact + ♻️ refresh controls), and the account's Claude-limit use as little
// health bars (daily = 5-hour window, weekly = 7-day, plus model-scoped weekly caps).
//
// Ported from hydra-hq as a TRANSPORT-AGNOSTIC kit component (v0.11.0): unlike hq's original it does
// NO fetching. The consumer polls the data (status/usage/model from its transcript+fleet feed, limits
// from its usage endpoint) and passes it as props, and supplies the action callbacks (onCompact /
// onRefresh / onInterrupt). The 🧠 context-anatomy drawer is deep-hq; here the context counter's tap
// is an OPTIONAL `onContextClick` consumer callback — omit it and the counter renders as plain text
// (no drawer), which is what merritt v1 does.

// the spinner + waiting-blink keyframes the busy indicator + the ≥600k compact alarm reference. hq
// ships these in global CSS; the kit injects them once so any consumer (merritt) animates too.
const KEYFRAMES =
  '@keyframes hq-spin{to{transform:rotate(360deg)}}' +
  '@keyframes hq-dot-blink{0%,49%{opacity:1}50%,100%{opacity:.2}}';
let keyframesInjected = false;
function useStatusKeyframes() {
  useEffect(() => {
    if (keyframesInjected || typeof document === 'undefined') return;
    const el = document.createElement('style');
    el.setAttribute('data-agent-console-kit', 'statusline-keyframes');
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
    keyframesInjected = true;
  }, []);
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(n);
}
// $ with thousands separators + 2dp, e.g. 1755.19 -> "$1,755.19"
export function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const Sep = () => <span style={{ color: C.faint, flexShrink: 0 }}>·</span>;   // tight; flex gap provides spacing
function barColor(pct: number): string {
  return pct >= 80 ? C.red : pct >= 50 ? C.amber : C.green;
}

function LimitBar({ label, pct, title, active }: { label: string; pct: number; title: string; active?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }} title={title}>
      {/* the active (binding) scoped limit is amber-labelled so the constraint that bites first stands out */}
      <span style={{ color: active ? C.amber : C.faint, fontWeight: active ? 700 : 400 }}>{label}{active ? '◂' : ''}</span>
      <span style={{ width: 15, height: 5, background: C.raised, borderRadius: C.radius, overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', width: `${p}%`, height: '100%', background: barColor(p), transition: 'width .4s ease' }} />
      </span>
      <span style={{ color: C.muted }}>{Math.round(p)}%</span>
    </span>
  );
}

export type StatusLineProps = {
  status: HeadStatus;
  name: string;
  usage?: SessionUsage | null;
  model?: string | null;
  limits?: Limits | null;
  interruptible?: boolean;
  weeklyUsd?: number | null;
  onCompact?: CompactAction;
  onRefresh?: RefreshAction;
  onInterrupt?: InterruptAction;
  onContextClick?: () => void;   // optional — tap the context counter (hq: opens the 🧠 anatomy drawer)
};

export default function StatusLine({
  status, usage, name, interruptible, weeklyUsd, model, limits,
  onCompact, onRefresh, onInterrupt, onContextClick,
}: StatusLineProps) {
  useStatusKeyframes();

  // Responsive shedding (Schyler 2026-07-04: the FABLE bar's % clipped on phone). The line is
  // flexShrink:0 + overflow:hidden by design, so on narrow containers we DROP the least-important
  // items instead of silently clipping the rightmost (which was the binding FABLE limit — the one
  // number that matters). Container-measured, not viewport: split-view panes crunch too.
  //   narrow (<440px): shed ~$/wk (lives on the ticker's Σ swipe screen) + the 'tok' unit
  //   tight  (<380px): also shed the model chip (the deck header's model selector shows it)
  const lineRef = useRef<HTMLDivElement>(null);
  const [lineW, setLineW] = useState(9999);
  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setLineW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = lineW < 440;
  const tight = lineW < 380;

  const working = status === 'working';
  const waiting = status === 'waiting';
  const dotColor = working ? C.green : waiting ? C.amber : C.faint;
  const stateLabel = working ? 'working' : waiting ? 'waiting' : status === 'offline' ? 'offline' : 'idle';

  // LINE 1 (ultra-compact, per-agent): ● NAME · ctx·out tok · D <bar> % · W <bar> % · ~$weekly/wk
  return (
    <div ref={lineRef} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 4px 0', flexWrap: 'nowrap', overflowX: 'hidden',
      fontFamily: C.mono, fontSize: 9, letterSpacing: 0, textTransform: 'uppercase', color: C.muted }}>
      {/* status dot (spinner while working, blinking square waiting, faint idle) + the agent name. This is
          the ONLY shrinkable item (flex 0 1 auto + the name ellipsizes) — everything else is flexShrink:0,
          so the stats stay fully visible and the line never wraps/overflows for a long name. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '0 1 auto', minWidth: 0 }} title={stateLabel}>
        {working
          ? <span style={{ width: 9, height: 9, borderRadius: '50%', border: `1.5px solid ${C.line2}`, borderTopColor: C.green, display: 'inline-block', flexShrink: 0, animation: 'hq-spin 0.8s linear infinite' }} />
          : <span style={{ width: 7, height: 7, borderRadius: C.radius, background: dotColor, flexShrink: 0, boxShadow: waiting ? `0 0 6px ${C.amber}` : undefined, animation: waiting ? 'hq-dot-blink 1.2s steps(1) infinite' : undefined }} />}
        <span style={{ color: dotColor, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </span>

      {/* the model this agent is running (collector short id, e.g. fable-5) — identity, so it sits
          right by the name; the always-visible "what am I talking to" reminder (Schyler, 2026-07-04). */}
      {model && !tight && (<>
        <Sep />
        <span title={`model this agent is running: ${model}`} style={{ color: C.faint, flexShrink: 0 }}>{model}</span>
      </>)}

      {/* echo the stop button right here while the agent is working — the halt-now affordance */}
      {working && interruptible && onInterrupt && <InterruptButton onInterrupt={onInterrupt} variant="inline" />}

      {/* session context · output tokens (from the last turn) + the ⊟ compact / ♻️ refresh controls
          right beside it. When `onContextClick` is supplied the counter IS a button (hq: the 🧠
          context-anatomy drawer); otherwise it renders as plain text (merritt v1 — no drawer). */}
      {usage && (onContextClick
        ? (
          <button type="button" onClick={onContextClick} title="session context · output tokens — tap to see the anatomy (MIND)"
            style={{ flexShrink: 0, background: 'none', border: `1px solid ${C.line}`, borderRadius: C.radius, cursor: 'pointer',
              fontFamily: C.mono, fontSize: 9, letterSpacing: 0, textTransform: 'uppercase', color: C.muted, padding: '1px 3px',
              display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span aria-hidden style={{ fontSize: 8 }}>🧠</span>
            {fmtTok(usage.context)}<span style={{ color: C.faint }}>·</span>{fmtTok(usage.output)}{!narrow && <span style={{ color: C.faint }}> tok</span>}
          </button>
        )
        : (
          <span title="session context · output tokens (last turn)"
            style={{ flexShrink: 0, fontFamily: C.mono, fontSize: 9, letterSpacing: 0, textTransform: 'uppercase', color: C.muted,
              display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {fmtTok(usage.context)}<span style={{ color: C.faint }}>·</span>{fmtTok(usage.output)}{!narrow && <span style={{ color: C.faint }}> tok</span>}
          </span>
        ))}
      {/* ⊟ /compact — doubles as the context-pressure gauge (amber 200k / red 400k / blink 600k) */}
      {onCompact && <CompactButton status={status} contextTokens={usage?.context} onCompact={onCompact} />}
      {onRefresh && <ConsolidateRefreshButton status={status} onRefresh={onRefresh} />}

      {/* account Claude-limit use — daily (5h) + weekly-all (7d) + any model-SCOPED weekly limits
          (e.g. Fable's separate weekly cap). The scoped model that's the BINDING constraint right
          now is flagged `active` — shown in amber so you can see at a glance which limit will bite
          first. The consumer polls its usage endpoint and passes this in. */}
      {limits && (<>
        <Sep />
        <LimitBar label="D" pct={limits.session_pct ?? 0} title={`daily (5-hour) limit: ${Math.round(limits.session_pct ?? 0)}%`} />
        <Sep />
        <LimitBar label="W" pct={limits.weekly_pct ?? 0} title={`weekly (7-day) all-model limit: ${Math.round(limits.weekly_pct ?? 0)}%`} />
        {(limits.model_limits ?? []).filter((ml) => typeof ml.pct === 'number').map((ml) => (
          <span key={ml.name} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <Sep />
            <LimitBar label={ml.name.slice(0, 5)} pct={ml.pct ?? 0}
              active={ml.active}
              title={`${ml.name} weekly limit: ${Math.round(ml.pct ?? 0)}%${ml.active ? ' — the ACTIVE binding limit right now' : ''}`} />
          </span>
        ))}
      </>)}
      {weeklyUsd != null && !narrow && (<>
        <Sep />
        <span title="API-equivalent spend this week (what the weekly usage WOULD cost off the Max sub)" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          ~{fmtUsd(weeklyUsd)}<span style={{ color: C.faint }}>/wk</span>
        </span>
      </>)}
    </div>
  );
}
