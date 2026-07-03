import { useEffect, useMemo, useRef, useState } from 'react';
import { C } from './render/tokens';
import type { CommandsResponse, SlashCommand } from './types';

// Console composer with full slash-command discovery (Schyler's ask). Two affordances:
//  • an autocomplete popup that appears the instant you type '/' at the start — fuzzy-filtered,
//    arrow/tap to pick, Enter/Tab inserts the /command so you can add args before sending;
//  • a '/' button that opens a browsable, searchable list of EVERY command (built-in / skill /
//    custom), grouped by source.
// The catalog is the collector-published hq:commands (164: 15 built-ins + 149 skills + custom).
// Mechanism is unchanged — slash commands already run via send-keys; this is the discovery layer.
//
// KIT CONTRACT (agent-console-kit PORTING.md): the component is host-app-agnostic — `sessionTarget`
// names whatever the host backend drives (an HQ head, a Merritt site agent), `apiBase` prefixes the
// {input,upload} routes, and `commandsFetcher` overrides the command catalog (defaults to
// `${apiBase}/commands`). HQ defaults reproduce today's behavior exactly. The wire shape
// (`POST ${apiBase}/head/{sessionTarget}/input`) keeps the `head` path segment until the kit
// stabilizes a v0.2 contract — renaming the wire is a backend-coordinated change, not a UI one.

let CACHE: SlashCommand[] | null = null;

const SRC: Record<string, { label: string; color: string }> = {
  builtin: { label: 'built-in', color: C.green },
  skill: { label: 'skill', color: C.blue },
  custom: { label: 'custom', color: C.violet },
};

function score(cmd: SlashCommand, q: string): number {
  if (!q) return 1;
  const n = cmd.name.toLowerCase();
  if (n === q) return 1000;
  if (n.startsWith(q)) return 600 - n.length;
  const idx = n.indexOf(q);
  if (idx >= 0) return 300 - idx;
  let i = 0;
  for (const ch of n) { if (ch === q[i]) i++; if (i === q.length) break; }
  if (i === q.length) return 80 - n.length * 0.1;
  if (cmd.desc.toLowerCase().includes(q)) return 15;
  return -1;
}
function filterCmds(cmds: SlashCommand[], q: string): SlashCommand[] {
  return cmds.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
}

type SentMsg = { id: string; text: string; route?: string };
type Attachment = { name: string; host_path: string; image: boolean; preview?: string };

export default function Composer({ sessionTarget, apiBase = '/api/hq', commandsFetcher, onSent, draft: draftProp, onDraft, suggest }:
  { sessionTarget: string; apiBase?: string; commandsFetcher?: () => Promise<SlashCommand[]>;
    onSent?: (msg: SentMsg) => void; draft?: string; onDraft?: (v: string) => void;
    suggest?: string | null }) {
  // draft is CONTROLLED when the deck passes it (shared chat⟷TUI draft); else local.
  const [localDraft, setLocalDraft] = useState('');
  const draft = draftProp ?? localDraft;
  const setDraft = (v: string) => { if (onDraft) onDraft(v); else setLocalDraft(v); };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [commands, setCommands] = useState<SlashCommand[]>(CACHE ?? []);
  const [hi, setHi] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [browseQ, setBrowseQ] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (CACHE) return;
    let alive = true;
    const load = commandsFetcher
      ? commandsFetcher()
      : fetch(`${apiBase}/commands`).then((r) => r.json() as Promise<CommandsResponse>).then((d) => d.commands ?? []);
    load.then((cmds) => { if (alive && cmds.length) { CACHE = cmds; setCommands(cmds); } }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-grow to fit the message (up to ~8 lines, then internal scroll)
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 184)}px`;
  }, [draft]);

  const slashM = /^\/(\S*)$/.exec(draft);
  const query = slashM ? slashM[1] : null;
  const acOpen = query !== null && !dismissed && commands.length > 0;
  const matches = useMemo(() => (acOpen ? filterCmds(commands, (query as string).toLowerCase()).slice(0, 8) : []), [acOpen, query, commands]);
  useEffect(() => { setHi(0); }, [query]);

  // paste the TUI ghost autosuggest into the draft (so Schyler can edit + send) — mirrors what
  // pressing → / Tab does at the box prompt, without a TUI trip. Trimmed so trailing pad never lands.
  const sug = (suggest ?? '').trim();
  const pasteSuggest = () => {
    if (!sug) return;
    setDraft(sug);
    setDismissed(true);
    requestAnimationFrame(() => { const t = taRef.current; if (t) { t.focus(); const e = t.value.length; t.setSelectionRange(e, e); } });
  };

  const insert = (cmd: SlashCommand) => {
    setDraft('/' + cmd.name + ' ');
    setDismissed(true);
    setBrowse(false);
    requestAnimationFrame(() => { const t = taRef.current; if (t) { t.focus(); const e = t.value.length; t.setSelectionRange(e, e); } });
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || sending) return;
    setSending(true); setSendErr(null);
    try {
      const body = { text, attachments: attachments.map((a) => ({ path: a.host_path, image: a.image })) };
      const r = await fetch(`${apiBase}/head/${encodeURIComponent(sessionTarget)}/input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
        setDraft(''); setAttachments([]); setDismissed(false);
        onSent?.({ id: d.id, text: d.text ?? text, route: d.route });
      } else { const d = await r.json().catch(() => ({})); setSendErr(d.detail || `send failed (${r.status})`); }
    } catch { setSendErr("can't reach the console backend"); } finally { setSending(false); }
  };

  // attach-then-send: upload SAVES the file; it sits as a chip until you hit Send
  const attach = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length || uploading) return;
    setUploading(true); setSendErr(null);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`${apiBase}/head/${encodeURIComponent(sessionTarget)}/upload`, { method: 'POST', body: fd });
        if (r.ok) {
          const d = await r.json();
          const preview = d.image ? URL.createObjectURL(file) : undefined;
          setAttachments((prev) => [...prev, { name: d.name, host_path: d.host_path, image: d.image, preview }]);
        } else { const d = await r.json().catch(() => ({})); setSendErr(d.detail || `upload failed (${r.status})`); }
      }
    } catch { setSendErr("upload failed — can't reach the backend"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const removeAttachment = (i: number) => {
    setAttachments((prev) => { const a = prev[i]; if (a?.preview) URL.revokeObjectURL(a.preview); return prev.filter((_, k) => k !== i); });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (acOpen && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); insert(matches[hi]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const browseList = useMemo(() => {
    const q = browseQ.trim().toLowerCase();
    const list = q ? filterCmds(commands, q) : [...commands];
    const groups: Record<string, SlashCommand[]> = {};
    for (const c of list) (groups[c.source] ||= []).push(c);
    return groups;
  }, [browse, browseQ, commands]);

  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      {sendErr && <div style={{ color: C.red, fontSize: 11, marginBottom: 6, fontFamily: C.mono }}>{sendErr}</div>}

      {/* autocomplete popup (opens upward, thumb-reachable) */}
      {acOpen && matches.length > 0 && (
        <Popup>
          {matches.map((c, i) => <Row key={c.source + c.name} cmd={c} active={i === hi} onPick={() => insert(c)} onHover={() => setHi(i)} />)}
        </Popup>
      )}

      {/* full browse dropdown */}
      {browse && (
        <Popup tall>
          <div style={{ position: 'sticky', top: 0, background: C.panel, padding: '8px 8px 6px', borderBottom: `1px solid ${C.line}` }}>
            <input
              autoFocus value={browseQ} onChange={(e) => setBrowseQ(e.target.value)}
              placeholder={`search ${commands.length} commands…`}
              style={{ width: '100%', background: '#060a06', color: C.ink, border: `1px solid ${C.line2}`, borderRadius: C.radius, padding: '7px 9px', fontFamily: C.mono, fontSize: 16, outline: 'none' }}
            />
          </div>
          {(['builtin', 'skill', 'custom'] as const).map((src) => (browseList[src]?.length ? (
            <div key={src}>
              <div style={{ fontFamily: C.mono, fontSize: 10, color: SRC[src].color, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 11px 3px' }}>
                {SRC[src].label} <span style={{ color: C.faint }}>· {browseList[src].length}</span>
              </div>
              {browseList[src].map((c) => <Row key={src + c.name} cmd={c} onPick={() => insert(c)} />)}
            </div>
          ) : null))}
        </Popup>
      )}

      {/* file input lives INSIDE the 📎 label below (native label-trigger works on iOS, unlike a
          programmatic .click() on a display:none input) — see the controls row. */}

      {/* pending attachment chips (attach-then-send) */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {attachments.map((a, i) => (
            <div key={a.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.raised, border: `1px solid ${C.line2}`, borderRadius: C.radius, padding: '3px 6px 3px 4px' }}>
              {a.preview
                ? <img src={a.preview} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: C.radius, display: 'block' }} />
                : <span style={{ fontSize: 15, width: 24, textAlign: 'center' }}>📄</span>}
              <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name.replace(/^[0-9a-f]{8}-/, '')}</span>
              <button type="button" aria-label="remove attachment" onClick={() => removeAttachment(i)}
                style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* brutalist command line: a ❯ prompt + the textarea (full-width), controls tucked below; square */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#060a06', border: `1px solid ${C.line2}`, borderRadius: C.radius, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: C.green, fontFamily: C.mono, fontSize: 16, fontWeight: 700, lineHeight: 1.5, flex: '0 0 auto' }}>❯</span>
          <textarea
            ref={taRef} value={draft}
            onChange={(e) => { setDraft(e.target.value); setDismissed(false); }}
            onKeyDown={onKeyDown}
            placeholder={`message ${sessionTarget}…  ( / for commands )`}
            rows={1}
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', resize: 'none', background: 'transparent', color: C.ink, border: 'none', outline: 'none', fontFamily: C.sans, fontSize: 16, lineHeight: 1.5, maxHeight: 184, minHeight: 24, overflowY: 'auto' }}
          />
        </div>
        {/* ghost autosuggest — the DIM input hint the box TUI shows. Rendered shaded/italic (same
            faint feel as the TUI), aligned under the textarea, and tappable to paste. Only while the
            draft is empty, so it reads like the prompt's ghost rather than fighting typed text. */}
        {sug && !draft.trim() && (
          <button type="button" onClick={pasteSuggest} title="tap to paste this suggestion"
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 0 24px', margin: 0, color: C.faint, fontFamily: C.sans, fontSize: 13, lineHeight: 1.4, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sug}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label title="attach photo or document"
            style={{ width: 30, height: 30, borderRadius: C.radius, border: `1px solid ${C.line}`, background: C.raised, color: uploading ? C.green : C.greenDim, cursor: uploading ? 'wait' : 'pointer', fontSize: 14, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
            {uploading ? '…' : '📎'}
            {/* visually hidden (NOT display:none) so iOS Safari lets the label trigger it natively */}
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.log,.py,.ts,.tsx,.js,.pem,.key,.crt"
              onChange={(e) => attach(e.target.files)} disabled={uploading}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', fontSize: 16 }} />
          </label>
          <button type="button" title="browse slash commands" onClick={() => { setBrowse((v) => !v); setBrowseQ(''); }}
            style={{ width: 30, height: 30, borderRadius: C.radius, border: `1px solid ${browse ? C.green : C.line}`, background: C.raised, color: browse ? C.green : C.greenDim, cursor: 'pointer', fontFamily: C.mono, fontSize: 15, flex: '0 0 auto' }}>/</button>
          {/* right cluster: the paste-suggestion button sits NEXT TO Send. Shown whenever there's a
              suggestion the draft doesn't already match — one tap drops it into the draft to edit+send. */}
          <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
            {sug && draft.trim() !== sug && (
              <button type="button" onClick={pasteSuggest} title="paste the TUI suggestion into the draft"
                style={{ height: 30, padding: '0 9px', borderRadius: C.radius, border: `1px solid ${C.line}`, background: C.raised, color: C.greenDim, cursor: 'pointer', fontFamily: C.mono, fontSize: 12, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                ⤵ <span style={{ fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase' }}>suggest</span>
              </button>
            )}
            {(() => { const can = !!draft.trim() || attachments.length > 0; return (
              <button type="button" onClick={send} disabled={sending || !can}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', borderRadius: C.radius, border: `1px solid ${can ? C.green : C.line}`, background: can ? 'rgba(34,255,106,.14)' : C.raised, color: can ? C.green : C.faint, cursor: sending || !can ? 'not-allowed' : 'pointer', flex: '0 0 auto', opacity: sending ? 0.6 : 1, fontFamily: C.mono, fontSize: 13, letterSpacing: '.06em', textTransform: 'uppercase' }}>Send ➤</button>
            ); })()}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 9, color: C.faint, marginTop: 2, fontFamily: C.mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        ⏎ send · ⇧⏎ newline · / cmds · <span style={{ color: C.amber }}>⚠ drives {sessionTarget} live</span>
      </div>
    </div>
  );
}

function Popup({ children, tall }: { children: React.ReactNode; tall?: boolean }) {
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 50,
      background: C.panel, border: `1px solid ${C.line2}`, borderRadius: C.radius, overflow: 'hidden',
      maxHeight: tall ? 360 : 300, overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.6)',
    }}>
      {children}
    </div>
  );
}

function Row({ cmd, active, onPick, onHover }: { cmd: SlashCommand; active?: boolean; onPick: () => void; onHover?: () => void }) {
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      onMouseEnter={onHover}
      style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 11px', cursor: 'pointer', background: active ? 'rgba(34,255,106,.10)' : 'transparent' }}
    >
      <span style={{ fontFamily: C.mono, fontSize: 12.5, color: C.green, flex: '0 0 auto' }}>/{cmd.name}</span>
      <span style={{ fontFamily: C.sans, fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{cmd.desc}</span>
      <span style={{ fontFamily: C.mono, fontSize: 9, color: SRC[cmd.source]?.color ?? C.faint, flex: '0 0 auto' }}>{SRC[cmd.source]?.label}</span>
    </div>
  );
}
