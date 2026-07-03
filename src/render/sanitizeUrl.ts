// URL sanitizer for untrusted transcript markdown.
//
// inline() in RichMarkdown renders <a href> and <img src> straight from chat content, so a
// `javascript:` / `data:text/html` / `vbscript:` URL would be a live XSS vector across every
// markdown path (paragraphs, headings, lists, tables, links, images). Every href/src that
// originates from content MUST pass through safeUrl() first.
//
// Policy: ALLOW http:, https:, mailto:, tel:, and schemeless URLs (relative `./` `../`,
// root-relative `/`, anchors `#`, protocol-relative `//`). Everything else is neutralized by
// returning null so the caller drops the attribute (inert <a> text, non-loading <img>).
//
// data: is special — blocked by default, but img may opt into data:image/* via allowDataImage
// (head/transcript content has no legit need for any other data:).

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Browsers ignore ASCII control chars and whitespace *inside* a scheme, so "java\tscript:",
// "JaVaScRiPt:" and " javascript:" all reach the same live scheme. Collapse those away (every
// Unicode whitespace via \s, plus C0 controls / DEL / C1 controls) and lowercase before we
// look for the scheme, so none of those tricks can slip a banned scheme past the allowlist.
function probeOf(raw: string): string {
  return raw.replace(/[\s\x00-\x1f\x7f-\x9f]/g, '').toLowerCase();
}

export function safeUrl(
  raw: string | undefined | null,
  opts?: { allowDataImage?: boolean },
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const probe = probeOf(trimmed);
  if (probe === '') return null;

  const colon = probe.indexOf(':');
  // No colon → no scheme → relative / anchor / root- or protocol-relative. Always safe.
  if (colon === -1) return trimmed;

  // A `/`, `?`, `#`, or `\` before the colon means the colon is part of a path/anchor/query
  // (e.g. "foo/bar:baz", "#a:b"), not a scheme. Schemeless → safe.
  const sep = probe.search(/[/?#\\]/);
  if (sep !== -1 && sep < colon) return trimmed;

  const scheme = probe.slice(0, colon + 1); // includes the trailing ':'

  if (scheme === 'data:') {
    // Allow only image payloads, and only when the caller opts in (i.e. <img>).
    if (opts?.allowDataImage && /^data:image\/[a-z0-9.+-]+[;,]/.test(probe)) return trimmed;
    return null;
  }

  return SAFE_SCHEMES.has(scheme) ? trimmed : null;
}
