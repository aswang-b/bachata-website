// Small allow-list HTML sanitizer for admin-authored rich text that renders
// via innerHTML for site visitors — strips anything script-capable as a
// safety net (e.g. a compromised admin account, or a bad paste). Runs
// server-side (Node, no DOM), so it's regex-based rather than a full parser.
export function sanitizeRichHtml(html: string, allowedTags: Set<string>): string {
  let out = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/ on[a-z]+="[^"]*"/gi, '')
    .replace(/ on[a-z]+='[^']*'/gi, '');

  out = out.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_full, closing, tagName, attrs) => {
    const tag = tagName.toUpperCase();
    if (!allowedTags.has(tag)) return '';
    if (closing) return `</${tag.toLowerCase()}>`;
    if (tag === 'A') {
      const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i) || attrs.match(/href\s*=\s*'([^']*)'/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      if (/^https?:\/\//i.test(href) || href.startsWith('/')) {
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
      }
      return '<a>';
    }
    return `<${tag.toLowerCase()}>`;
  });

  return out;
}

// Matches the formatting Google Calendar's own event description editor
// supports natively (bold, italic, underline, strikethrough, links, bulleted
// and numbered lists) — DIV/BR are included too since contenteditable
// browsers use them for line breaks, not because Google renders them.
const EVENT_DESCRIPTION_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'BR', 'DIV', 'UL', 'OL', 'LI']);

export function sanitizeEventDescriptionHtml(html: string): string {
  return sanitizeRichHtml(html, EVENT_DESCRIPTION_TAGS);
}
