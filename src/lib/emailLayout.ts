import { SITE_URL } from './seoSchema';

// The look every email to a dancer shares: a dark band with the Dance with B
// wordmark and the heading, a thin red line, the content on a light body, and
// a dark footer with the wordmark and the site's social links (WhatsApp only
// when a community link is set). Tables with bgcolor and inline styles, since
// many email apps ignore anything else; icons are hosted PNGs (no SVG in email).

export const EMAIL_COLORS = {
  dark: '#170f0d',
  onDark: '#f5ece9',
  mutedOnDark: '#b9a89b',
  pink: '#ff5577',
  red: '#b81640',
  ink: '#1c1114',
  muted: '#6b5a5e',
  border: '#ecdfe2',
  body: '#fffdfb',
  tint: '#fbf3f4',
} as const;

const C = EMAIL_COLORS;
const DISPLAY = "Poppins,'Segoe UI',Arial,Helvetica,sans-serif";
const TEXT = 'Inter,Arial,Helvetica,sans-serif';
const INSTAGRAM = 'https://www.instagram.com/ohmytofuu/';
const SPOTIFY = 'https://open.spotify.com/playlist/15WaYTwjYFwQ2yq33c9Gh8';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const wordmark = (size: number) =>
  `<span style="font-family:${DISPLAY};font-size:${size}px;font-weight:800;letter-spacing:-0.01em;color:${C.onDark};">Dance with <span style="color:${C.pink};">B</span></span>`;

const icon = (href: string, name: string, label: string) =>
  `<a href="${escapeAttr(href)}" style="text-decoration:none;margin-left:14px;"><img src="${SITE_URL}/email/${name}.png" width="22" height="22" alt="${label}" style="border:0;vertical-align:middle;" /></a>`;

export interface EmailLayoutParams {
  // Plain text (escaped here).
  heading: string;
  subheading?: string;
  // The content (already escaped where it holds what people typed).
  bodyHtml: string;
  whatsappUrl?: string | null;
}

export function emailLayout(p: EmailLayoutParams): string {
  const socials = [icon(INSTAGRAM, 'instagram', 'Instagram'), icon(SPOTIFY, 'spotify', 'Spotify'), p.whatsappUrl ? icon(p.whatsappUrl, 'whatsapp', 'Join our WhatsApp community') : ''].join('');
  return `
<div style="background:${C.body};padding:0;margin:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;border-collapse:collapse;">
    <tr>
      <td bgcolor="${C.dark}" style="background:${C.dark};padding:24px 28px 22px;">
        ${wordmark(20)}
        <h1 style="margin:16px 0 0;font-family:${DISPLAY};font-size:24px;line-height:1.2;font-weight:800;color:${C.onDark};">${escapeAttr(p.heading)}</h1>
        ${p.subheading ? `<p style="margin:4px 0 0;font-family:${TEXT};font-size:15px;color:${C.mutedOnDark};">${escapeAttr(p.subheading)}</p>` : ''}
      </td>
    </tr>
    <tr><td bgcolor="${C.red}" style="background:${C.red};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
    <tr>
      <td bgcolor="${C.body}" style="background:${C.body};padding:22px 28px 26px;font-family:${TEXT};color:${C.ink};">
        ${p.bodyHtml}
      </td>
    </tr>
    <tr>
      <td bgcolor="${C.dark}" style="background:${C.dark};padding:16px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;"><a href="${SITE_URL}" style="text-decoration:none;">${wordmark(15)}</a></td>
            <td style="vertical-align:middle;text-align:right;white-space:nowrap;">${socials}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}
