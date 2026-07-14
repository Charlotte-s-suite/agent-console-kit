import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import RichMarkdown from './RichMarkdown';

// Nested inline tokens (2026-07-14): a link/code/URL/path inside **bold** or *em* must stay
// LIVE. Regression for the merritt class — `**same link: [Merritt 2.0](https://…)**` rendered
// as dead <strong> text because the bold branch emitted its body as a plain string, eating the
// markdown link an operator then couldn't tap. These tests pin the recursion.

const md = (source: string) => renderToStaticMarkup(createElement(RichMarkdown, { source }));

describe('inline tokens nested in bold', () => {
  it('markdown link inside ** ** renders a live anchor', () => {
    const out = md('**r2 is live, same link: [Merritt 2.0 — thesis & blueprint](https://claude.ai/code/artifact/a3ebdee7)**');
    expect(out).toContain('href="https://claude.ai/code/artifact/a3ebdee7"');
    expect(out).toContain('Merritt 2.0 — thesis &amp; blueprint');
    expect(out).not.toContain('[Merritt 2.0');           // no literal bracket text survives
  });

  it('bare URL inside ** ** renders a live anchor', () => {
    const out = md('**see https://hq.shmaptech.com now**');
    expect(out).toContain('href="https://hq.shmaptech.com"');
  });

  it('unsafe scheme inside bold stays inert (sanitizer still applies through the recursion)', () => {
    const out = md('**do not [click](javascript:alert(1)) this**');
    expect(out).not.toContain('href=');
    expect(out).toContain('click');                       // label survives as inert text
  });

  it('code chip inside bold keeps the chip render', () => {
    const out = md('**commit `3b7a95b` landed**');
    expect(out).toContain('<code');
    expect(out).toContain('3b7a95b');
  });

  it('home-rooted path inside bold stays a live path token', () => {
    const out = md('**doc at ~/shmorganism/workshop/merritt-studio/MERRITT.md**');
    expect(out).toContain('title="copy path"');
  });
});

describe('inline tokens nested in em', () => {
  it('link inside *em* renders a live anchor', () => {
    const out = md('*the [doc](https://example.com) again*');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<em>');
  });

  it('link inside _em_ renders a live anchor', () => {
    const out = md('_the [doc](https://example.com) again_');
    expect(out).toContain('href="https://example.com"');
  });
});

describe('no regressions on plain emphasis', () => {
  it('plain bold still bolds', () => {
    expect(md('**just bold**')).toContain('just bold');
  });
  it('bold inside _em_ still renders (single-level nesting the other way)', () => {
    const out = md('_outer **inner** outer_');
    expect(out).toContain('<em>');
    expect(out).toContain('inner');
  });
});
