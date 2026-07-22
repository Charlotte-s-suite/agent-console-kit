import { useState } from 'react';
import { C } from '../render/tokens';

// InterruptButton — phone-first ⏹ STOP. There's no Esc key on a phone, so tapping this halts the
// agent mid-turn. Transport-agnostic (ported from hydra-hq): the consumer supplies `onInterrupt`
// (it does the fetch/send — e.g. POST an Escape to the head's pane via its own backend); the kit
// owns the button, its debounce, and the two variants — a prominent thumb target in a header, and a
// compact echo in the status line while the agent is working.

export type InterruptButtonProps = {
  onInterrupt: () => void | Promise<void>;
  variant?: 'header' | 'inline';
};

export default function InterruptButton({ onInterrupt, variant = 'header' }: InterruptButtonProps) {
  const [busy, setBusy] = useState(false);

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onInterrupt();
    } catch { /* the consumer reports; the agent's status reflects reality on the next poll */ }
    setTimeout(() => setBusy(false), 800);   // brief debounce against double-taps
  };

  const common: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: C.mono, textTransform: 'none',
    letterSpacing: 0, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1, color: C.red,
    background: 'rgba(255,107,107,.08)', border: `1px solid ${C.red}`, borderRadius: C.radius,
  };

  // STOP glyph: a plain mono square (■, U+25A0) — NOT ⏹ (U+23F9), which iOS Safari renders as a COLOR
  // EMOJI (a bright white/grey rounded square) that ignores `color:C.red` and clashes with the brutalist
  // green line (Schyler's red-boxed screenshot). U+25A0 is text-default → it honours the red colour.
  if (variant === 'inline') {
    // compact echo in the StatusLine: keep it SMALL so it doesn't inflate the 9px line.
    return (
      <button type="button" onClick={stop} disabled={busy} title="interrupt (Esc)" aria-label="interrupt agent"
        style={{ ...common, flexShrink: 0, minHeight: 15, padding: '0 5px', fontSize: 10, lineHeight: 1 }}>
        ■
      </button>
    );
  }
  return (
    <button type="button" onClick={stop} disabled={busy} title="interrupt the agent (Esc)" aria-label="interrupt agent"
      style={{ ...common, minHeight: 32, minWidth: 36, justifyContent: 'center', padding: '5px 9px', fontSize: 15 }}>
      ■
    </button>
  );
}
