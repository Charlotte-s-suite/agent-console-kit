import { useState } from 'react';
import { C } from './render/tokens';

// TuiKeyboard — a collapsible, full on-screen keyboard for the TUI head-view. The phone's native keyboard
// covers half the screen and lacks Esc/Tab/Ctrl/arrows; this one lives INSIDE the app (Schyler's ask),
// emits keys via onBytes (== HeadTerminal.onKbKey, which routes TEXT → the shared draft and SPECIAL keys →
// the live /input path), and collapses out of the way. Brutalist styling, phone-width grid.

type Props = {
  onBytes: (s: string) => void;        // raw key bytes for /input (sendBytes applies sticky Ctrl)
  ctrlArmed: boolean;                  // shared sticky-Ctrl state (lives in HeadTerminal)
  onToggleCtrl: () => void;
  onHide: () => void;
};

const LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const NUM_SHIFT: Record<string, string> = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')' };
// punctuation row + their shifted variants
const SYM: [string, string][] = [['`', '~'], ['-', '_'], ['=', '+'], ['[', '{'], [']', '}'], ['\\', '|'], [';', ':'], ["'", '"'], [',', '<'], ['.', '>'], ['/', '?']];

export default function TuiKeyboard({ onBytes, ctrlArmed, onToggleCtrl, onHide }: Props) {
  const [shift, setShift] = useState(false);   // one-shot shift
  const [lock, setLock] = useState(false);     // caps/shift lock
  const up = shift || lock;

  const afterKey = () => { if (shift && !lock) setShift(false); };   // one-shot shift resets after a key
  const send = (s: string) => { onBytes(s); afterKey(); };
  const sendChar = (base: string, shifted?: string) => send(up ? (shifted ?? base.toUpperCase()) : base);

  const keyStyle = (active?: boolean, accent?: string, flex = 1): React.CSSProperties => ({
    flex: `${flex} 1 0`, minWidth: 0, minHeight: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: C.mono, fontSize: 13, textTransform: 'none', letterSpacing: 0, cursor: 'pointer', userSelect: 'none',
    border: `1px solid ${active ? (accent || C.green) : C.line2}`, borderRadius: C.radius, padding: '0 2px',
    background: active ? 'rgba(34,255,106,.12)' : C.raised, color: active ? (accent || C.green) : C.ink,
  });
  const Key = ({ label, on, active, accent, flex }: { label: string; on: () => void; active?: boolean; accent?: string; flex?: number }) => (
    <button type="button" onClick={on} style={keyStyle(active, accent, flex)}>{label}</button>
  );
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 3, marginBottom: 3 };

  return (
    <div style={{ flex: '0 0 auto', background: C.bg, borderTop: `1px solid ${C.line}`, padding: '5px 3px 3px' }}>
      {/* function + nav row */}
      <div style={rowStyle}>
        <Key label="esc" on={() => send('\x1b')} flex={1.4} />
        <Key label="tab" on={() => send('\t')} flex={1.4} />
        <Key label="⌃" on={onToggleCtrl} active={ctrlArmed} accent={C.amber} />
        <Key label="←" on={() => send('\x1b[D')} />
        <Key label="↑" on={() => send('\x1b[A')} />
        <Key label="↓" on={() => send('\x1b[B')} />
        <Key label="→" on={() => send('\x1b[C')} />
        <Key label="▾" on={onHide} accent={C.muted} flex={1.2} />
      </div>
      {/* number row */}
      <div style={rowStyle}>
        {NUM.map((n) => <Key key={n} label={up ? NUM_SHIFT[n] : n} on={() => sendChar(n, NUM_SHIFT[n])} />)}
      </div>
      {/* letters — bottom row is ⇧ + zxcvbnm + ⌫ (Enter lives once, on the space row below) */}
      {LETTERS.map((row, i) => (
        <div key={i} style={rowStyle}>
          {i === 2 && <Key label="⇧" on={() => (lock ? (setLock(false), setShift(false)) : setShift((s) => !s))}
            active={up} accent={lock ? C.violet : C.green} flex={1.5} />}
          {row.map((c) => <Key key={c} label={up ? c.toUpperCase() : c} on={() => sendChar(c)} />)}
          {i === 2 && <Key label="⌫" on={() => send('\x7f')} flex={1.5} />}
        </div>
      ))}
      {/* punctuation */}
      <div style={rowStyle}>
        {SYM.map(([base, sh]) => <Key key={base} label={up ? sh : base} on={() => sendChar(base, sh)} />)}
      </div>
      {/* space row */}
      <div style={{ ...rowStyle, marginBottom: 0 }}>
        <Key label="⇪" on={() => { setLock((l) => !l); setShift(false); }} active={lock} accent={C.violet} flex={1.3} />
        <Key label="space" on={() => send(' ')} flex={6} />
        <Key label="⏎ enter" on={() => send('\r')} accent={C.green} active flex={2} />
      </div>
    </div>
  );
}
