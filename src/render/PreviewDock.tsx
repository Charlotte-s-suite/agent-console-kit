import { useState } from 'react';
import { C } from './tokens';
import { safeUrl } from './sanitizeUrl';

// PreviewDock (E2): the in-chat browser. A link's ◫ button docks the page here — a live iframe
// above the composer — so the operator can watch a deploy/artifact/PR *while chatting*, with a
// one-tap ⛶ fullscreen. Fullscreen is a pure CSS swap on the SAME element tree: React keeps the
// iframe mounted, so toggling never reloads the page inside (a running preview stays running).
//
// Embedding reality: plenty of sites (GitHub, most SaaS) send X-Frame-Options/frame-ancestors
// and render blank in ANY iframe — that's their policy, not a bug here. Cross-origin JS can't
// even detect the refusal reliably, so instead of pretending, the header keeps a permanent
// ↗ open-in-tab escape hatch and the hint line names the fix when the frame stays blank.
//
// Security: src passes safeUrl (http/https only — the dock renders nothing for anything else);
// sandbox omits allow-top-navigation (framed page can never steal the console tab) and
// allow-popups is granted so target=_blank links inside the preview still work; no-referrer.
export default function PreviewDock({ url, onClose }: { url: string | null; onClose: () => void }) {
  const [full, setFull] = useState(false);
  if (!url) return null;
  const src = safeUrl(url);
  if (!src || !/^https?:\/\//i.test(src)) return null;
  let host = '';
  try { host = new URL(src).host; } catch { /* keep '' */ }

  const btn: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${C.line}`, borderRadius: C.radius, color: C.muted,
    cursor: 'pointer', fontFamily: C.mono, fontSize: 11, lineHeight: '18px', padding: '0 7px', flex: '0 0 auto',
  };

  return (
    <div
      style={full
        ? { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', background: C.bg }
        : { position: 'relative', display: 'flex', flexDirection: 'column', height: '45vh', minHeight: 220, borderTop: `1px solid ${C.line2}`, background: C.bg }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.green, flex: '0 0 auto' }}>◫</span>
        <span style={{ fontFamily: C.mono, fontSize: 11, color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={src}>
          {host}<span style={{ color: C.muted }}>{src.slice(src.indexOf(host) + host.length)}</span>
        </span>
        <CopyBtn text={src} style={btn} />
        <a href={src} target="_blank" rel="noreferrer" title="open in tab (blank preview = the site refuses embedding)" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>↗</a>
        <button type="button" title={full ? 'exit fullscreen' : 'fullscreen'} onClick={() => setFull(!full)} style={{ ...btn, color: full ? C.green : C.muted }}>⛶</button>
        <button type="button" title="close preview" onClick={() => { setFull(false); onClose(); }} style={{ ...btn, color: C.red }}>✕</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* hint layer UNDER the iframe: a real page paints over it; a refused embed (X-Frame-Options/
            frame-ancestors — GitHub, most SaaS) leaves it showing. Cross-origin JS cannot detect the
            refusal, so layering beats pretending to know. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', fontFamily: C.mono, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
          loading {host}…<br />if this stays blank, the site refuses embedding — use ↗ to open it in a tab
        </div>
        <iframe
          src={src}
          title={`preview: ${host}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%', background: 'transparent' }}
        />
      </div>
    </div>
  );
}

function CopyBtn({ text, style }: { text: string; style: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" title="copy URL"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}
      style={{ ...style, color: copied ? C.green : C.muted }}
    >{copied ? '✓' : '⧉'}</button>
  );
}
