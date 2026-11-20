// Pure. Apps and crawlers that open a link only to show its preview (a link
// pasted into WhatsApp, iMessage, Slack…) or to index it, rather than a person
// scanning a code. A short link (/c/<code>) asks the QR site with HEAD for
// them, so they aren't counted as scans; they still get the same redirect, so
// their preview shows the page the code opens.

// By name. iMessage's previews come as "facebookexternalhit/1.1 Facebot
// Twitterbot/1.0". Pinterest's crawler, not its in-app browser ("[Pinterest/iOS]").
const NAMED = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|Applebot|Googlebot|bingbot|Pinterestbot|Pinterest\/0\.|Embedly|SkypeUriPreview|redditbot|Iframely|vkShare/i;

// Anything else calling itself one ("AhrefsBot", "Snap URL Preview Service").
const GENERIC = /bot|crawler|spider|preview/i;

// Android's "(Linux; Android 14; CUBOT X30)" names the phone, and some phones'
// names hold "bot": the generic test skips that part.
const ANDROID_DEVICE = /\(Linux;[^)]*\)/g;

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  // Every phone's browser sends one; nothing at all is a script.
  if (!ua) return true;
  return NAMED.test(ua) || GENERIC.test(ua.replace(ANDROID_DEVICE, ''));
}
