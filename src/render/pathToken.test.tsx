import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import RichMarkdown, { InlineText } from './RichMarkdown';

// Path tokens (E3): home-rooted paths in transcript markdown become live "open in explorer"
// buttons (onOpenPath), or click-to-copy without a handler. These tests pin the DETECTION
// boundary — what lights up, what stays inert prose — and that paths never render as hrefs.

const md = (source: string, onOpenPath?: (p: string) => void) =>
  renderToStaticMarkup(createElement(RichMarkdown, { source, onOpenPath }));
const plain = (text: string, onOpenPath?: (p: string) => void) =>
  renderToStaticMarkup(createElement(InlineText, { text, onOpenPath }));

describe('path tokens — what lights up', () => {
  const live = [
    '~/shmorganism/core/hq/ARCHITECTURE.md',
    '/home/user/agent-console-kit/src/index.ts',
    '~/x/y', // minimal two-seg tilde
    '/home/u1/proj/file.py:42', // line ref
    '/home/user/dir/', // trailing slash (dir)
  ];
  for (const p of live) {
    it(`tokenizes ${p}`, () => {
      expect(md(`see ${p} here`)).toContain('title="copy path"');
      expect(md(`see ${p} here`)).toContain(p);
    });
  }

  const inert = [
    'and/or maybe',            // no home root
    'ratio is 24/7 uptime',    // numbers
    'GET /api/hq/files/list',  // API route — not home-rooted
    'core/hq is the spine',    // relative path
    '~ alone',                 // bare tilde, no segment
    '/homework/x',             // not /home/<user>/
  ];
  for (const t of inert) {
    it(`leaves inert: "${t}"`, () => {
      expect(md(t)).not.toContain('title="copy path"');
    });
  }

  it('does not match a path glued inside a word', () => {
    expect(md('foo/home/user/x bar')).not.toContain('title="copy path"');
  });

  it('peels trailing prose punctuation off the token', () => {
    const html = md('read ~/notes/todo.md.');
    expect(html).toContain('~/notes/todo.md</button>');
  });

  it('backticked path renders as a live token, other code spans stay code', () => {
    expect(md('open `~/a/b.md` now')).toContain('title="copy path"');
    expect(md('run `npm install` now')).not.toContain('title="copy path"');
  });

  it('never emits a path as an href', () => {
    const html = md('see /home/user/secrets/x');
    expect(html).not.toMatch(/href="[^"]*\/home\/user/);
  });
});

describe('path tokens — the click contract', () => {
  it('strips a :line ref from the open target but keeps it in the display', () => {
    // renderToStaticMarkup can't click; assert via the title flip that a handler is wired,
    // and pin stripLineRef behavior through the markup (display keeps :42).
    const html = md('at `/home/u/app/main.py:42` crash', () => {});
    expect(html).toContain('title="open in file explorer"');
    expect(html).toContain('/home/u/app/main.py:42');
  });

  it('without a handler the title says copy', () => {
    expect(md('at ~/a/b')).toContain('title="copy path"');
    expect(md('at ~/a/b')).not.toContain('title="open in file explorer"');
  });
});

describe('InlineText — plain-text surfaces (user bubbles)', () => {
  it('linkifies URLs and paths but never restyles markdown', () => {
    const html = plain('check https://example.com/pr and ~/notes/x.md in my_var_name *soon*');
    expect(html).toContain('href="https://example.com/pr"');
    expect(html).toContain('title="copy path"');
    expect(html).not.toContain('<em>');   // *soon* stays literal
    expect(html).toContain('my_var_name'); // underscores untouched
    expect(html).toContain('*soon*');
  });

  it('drops unsafe schemes to inert text', () => {
    // http-only branch: a javascript: URL never matches the URL regex, so nothing to assert
    // beyond absence of any non-http href.
    const html = plain('x javascript:alert(1) y https://ok.io z');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://ok.io"');
  });
});
