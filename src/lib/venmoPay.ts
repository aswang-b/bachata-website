// Dance with B's Venmo account and the links to it. No imports: the registration
// form's browser script and the server (confirmation page, email) share this file,
// so both build the same links.

// The account (also named in the form's QR label).
export const VENMO_USERNAME = 'amumira';
// The pay link's words on the confirmation page and email: who the dancer pays.
export const PAY_LINK_TEXT = `Click here to pay @${VENMO_USERNAME}`;
// The account's code link (no amount): what the form's QR code holds and what the
// Venmo app's scanner reads. A link of the pay form below doesn't work when scanned.
export const VENMO_URL = 'https://venmo.com/code?user_id=2024335518728192092&created=1788834419';

const NOTE_FALLBACK = 'Dance with B';
const NOTE_MAX = 120;

// The payment note: the class name(s), joined with ", ". Whitespace is tidied, a
// repeated name is said once, and a long list is cut after a whole name with "…"
// (a single name too long for that is cut at 119 characters plus "…").
export function venmoNote(names: string[]): string {
  const clean = names.map((n) => String(n ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const unique = clean.filter((n, i) => clean.indexOf(n) === i);
  if (unique.length === 0) return NOTE_FALLBACK;
  const all = unique.join(', ');
  if (all.length <= NOTE_MAX) return all;
  let kept = '';
  for (const name of unique) {
    const next = kept ? `${kept}, ${name}` : name;
    if (next.length + 1 > NOTE_MAX) break;
    kept = next;
  }
  return kept ? `${kept}…` : `${unique[0].slice(0, NOTE_MAX - 1)}…`;
}

// The link that opens Venmo's pay screen with the amount and note filled in when
// tapped. Without an amount to pay (free, unknown, not chosen yet) it is the plain
// account link, never a pay link for nothing.
export function venmoPayUrl({ amount, note }: { amount: number | null | undefined; note?: string | string[] | null }): string {
  const cents = typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  if (cents <= 0) return VENMO_URL;
  const text = venmoNote(Array.isArray(note) ? note : [note ?? '']);
  return `https://venmo.com/${VENMO_USERNAME}?txn=pay&amount=${(cents / 100).toFixed(2)}&note=${encodeURIComponent(text)}`;
}
