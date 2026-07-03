import { Fragment, useState, type ReactNode } from 'react';
import { C } from './tokens';
import { tokenize, type TokClass } from './highlight';
import { safeUrl } from './sanitizeUrl';

// Rich, dependency-free markdown for the console (E1): paragraphs, headings, bold/italic, links,
// inline code, lists, blockquotes, hr, fenced code (syntax-highlighted), unified diffs, and
// inline images. React nodes only — no innerHTML. The refined premium-terminal aesthetic.

const SYN: Record<TokClass, string> = {
  kw: C.synKey, str: C.synStr, com: C.synCom, fn: C.synFn, num: C.synNum, punct: C.greenDim, '': C.ink,
};

export function looksLikeDiff(s: string): boolean {
  const lines = s.split('\n');
  const marked = lines.filter((l) => /^[+-]/.test(l) && !l.startsWith('+++') && !l.startsWith('---')).length;
  return lines.length >= 2 && marked >= 2 && (s.includes('@@') || marked / lines.length > 0.3);
}

export function DiffBlock({ source }: { source: string }) {
  return (
    <div style={{ margin: '8px 0 2px', border: `1px solid ${C.line}`, borderRadius: C.radius, overflow: 'hidden', fontFamily: C.mono, fontSize: 12 }}>
      {source.replace(/\n$/, '').split('\n').map((ln, i) => {
        const add = ln.startsWith('+') && !ln.startsWith('+++');
        const del = ln.startsWith('-') && !ln.startsWith('---');
        const meta = ln.startsWith('@@') || ln.startsWith('+++') || ln.startsWith('---');
        return (
          <div key={i} style={{
            padding: '2px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: add ? C.diffAddBg : del ? C.diffDelBg : 'transparent',
            color: add ? C.diffAddInk : del ? C.diffDelInk : meta ? C.blue : C.muted,
          }}>{ln || ' '}</div>
        );
      })}
    </div>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const body = code.replace(/\n$/, '');
  const copy = () => {
    navigator.clipboard?.writeText(body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {});
  };
  const toks = tokenize(body, lang);
  return (
    <div style={{ margin: '8px 0 2px', background: '#060a06', border: `1px solid ${C.line}`, borderRadius: C.radius, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', borderBottom: `1px solid ${C.line}`, fontFamily: C.mono, fontSize: 10.5, color: C.muted }}>
        <span>{lang || 'text'}</span>
        <button type="button" onClick={copy} style={{ background: 'transparent', border: 'none', color: copied ? C.green : C.muted, cursor: 'pointer', fontFamily: C.mono, fontSize: 10.5 }}>
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', fontFamily: C.mono, fontSize: 12, lineHeight: 1.5 }}>
        {toks.map((t, i) => <span key={i} style={{ color: SYN[t.cls] }}>{t.text}</span>)}
      </pre>
    </div>
  );
}

// ---- inline ------------------------------------------------------------------------------
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${key}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith('![')) {
      const mm = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok)!;
      const src = safeUrl(mm[2], { allowDataImage: true });
      // Drop the <img> entirely on an unsafe src — never emit a src= the browser would fetch.
      if (src) out.push(<img key={`${key}-img${i}`} src={src} alt={mm[1]} style={{ maxWidth: '100%', borderRadius: C.radius, border: `1px solid ${C.line}`, margin: '4px 0', display: 'block' }} />);
      else out.push(<Fragment key={`${key}-img${i}`}>{mm[1]}</Fragment>);
    } else if (tok.startsWith('[')) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = safeUrl(mm[2]);
      // Unsafe href → render the label as inert text instead of a live (javascript:) link.
      if (href) out.push(<a key={`${key}-a${i}`} href={href} target="_blank" rel="noreferrer" style={{ color: C.blue, textDecoration: 'none' }}>{mm[1]}</a>);
      else out.push(<Fragment key={`${key}-a${i}`}>{mm[1]}</Fragment>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={`${key}-c${i}`} style={{ fontFamily: C.mono, fontSize: 12, background: 'rgba(34,255,106,.1)', padding: '1px 5px', borderRadius: C.radius, color: C.green }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${key}-b${i}`} style={{ color: C.green, fontWeight: 700 }}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${key}-i${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length; i += 1;
  }
  if (last < text.length) out.push(<Fragment key={`${key}-tE`}>{text.slice(last)}</Fragment>);
  return out;
}

// ---- GFM tables ---------------------------------------------------------------------------
// The box TUI renders pipe tables as bordered grids; without a branch here the chat falls them
// into the paragraph gatherer, which joins every row with spaces into one unreadable line
// ("| # | Ask | | --- | --- | | 1 | … |"). We detect a header row + a delimiter row and render
// a real, horizontally-scrollable <table> in the terminal aesthetic.
type Align = 'left' | 'right' | 'center';

// a delimiter row is only dashes/colons/pipes/space AND carries at least one pipe (so a bare
// "---" stays an <hr>/setext rule, never a one-column table that eats the line above it).
function isTableDelim(s: string): boolean {
  return s.includes('|') && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(s);
}

// split one row into trimmed cells: drop the optional outer pipes, split on UNESCAPED pipes.
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '\\' && s[j + 1] === '|') { cur += '|'; j++; continue; }   // escaped pipe -> literal
    if (s[j] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[j];
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(':'), r = c.endsWith(':');
  return l && r ? 'center' : r ? 'right' : 'left';
}

function TableBlock({ head, aligns, rows }: { head: string[]; aligns: Align[]; rows: string[][] }) {
  return (
    <div style={{ margin: '8px 0 2px', overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: C.radius }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: C.sans, fontSize: 13 }}>
        <thead>
          <tr>
            {head.map((h, n) => (
              <th key={n} style={{ textAlign: aligns[n] || 'left', padding: '6px 10px', borderBottom: `1px solid ${C.line2}`, background: 'rgba(34,255,106,.05)', color: C.green, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {inline(h, `th${n}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {head.map((_, ci) => (
                <td key={ci} style={{ textAlign: aligns[ci] || 'left', padding: '5px 10px', borderTop: `1px solid ${C.line}`, color: C.ink, verticalAlign: 'top' }}>
                  {inline(r[ci] ?? '', `td${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const HSIZE = [19, 17, 15, 14, 13, 12];

export default function RichMarkdown(
  { source, dim = false, font, ink, size }:
    { source: string; dim?: boolean; font?: string; ink?: string; size?: number },
) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, key = 0;
  // `ink` (the agents-side text colour, T1 theming) overrides the default prose colour; the dim
  // "thinking" variant keeps its violet regardless.
  const prose = dim ? 'rgba(183,155,255,.85)' : (ink || C.ink);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join('\n');
      blocks.push(lang === 'diff' || looksLikeDiff(code)
        ? <DiffBlock key={key++} source={code} />
        : <CodeBlock key={key++} code={code} lang={lang || undefined} />);
      continue;
    }
    // GFM table — header row of pipe-cells immediately followed by a delimiter row. Checked
    // before headings so a heading-ish header cell ("| # | …") still reads as a table.
    if (line.includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push(<TableBlock key={key++} head={head} aligns={aligns} rows={rows} />);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={key++} style={{ fontSize: HSIZE[h[1].length - 1], fontWeight: 700, color: C.green, margin: '12px 0 6px' }}>{inline(h[2], `h${key}`)}</div>);
      i++; continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={key++} style={{ border: 'none', borderTop: `1px solid ${C.line}`, margin: '10px 0' }} />);
      i++; continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key++} style={{ borderLeft: `3px solid ${C.line2}`, margin: '8px 0', padding: '2px 0 2px 10px', color: C.muted }}>{inline(buf.join(' '), `q${key}`)}</blockquote>);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      const ls: React.CSSProperties = { margin: '6px 0', paddingLeft: 20, color: prose };
      const li: React.CSSProperties = { margin: '3px 0', lineHeight: 1.5 };
      blocks.push(ordered
        ? <ol key={key++} style={ls}>{items.map((it, n) => <li key={n} style={li}>{inline(it, `li${key}-${n}`)}</li>)}</ol>
        : <ul key={key++} style={ls}>{items.map((it, n) => <li key={n} style={li}>{inline(it, `li${key}-${n}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }

    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])
      && !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1]))) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++} style={{ margin: '0 0 8px', lineHeight: 1.6, color: prose, fontStyle: dim ? 'italic' : 'normal' }}>{inline(para.join(' '), `p${key}`)}</p>);
  }

  return <div style={{ fontFamily: font || C.sans, fontSize: size || 14 }}>{blocks}</div>;
}
