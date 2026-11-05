import { fakeQrServices } from './testMode';

// Venmo accounts for the door sign (/admin/qr). Venmo's own QR codes hold
// https://venmo.com/code?user_id=<id> (not the username), which is what its
// in-app scanner reads. The id, name and photo come from the account's public
// profile page (account.venmo.com/u/<username>), so an admin can confirm the
// person before printing their code. The page is Venmo's, not an API: if it
// changes, lookups fail with a clear message and the plain profile link still works.

export interface VenmoAccount {
  username: string;
  // The account's name on Venmo, e.g. "B Zh".
  name: string;
  userId: string;
  picture: string | null;
}

export class VenmoLookupError extends Error {}

// Venmo usernames: letters, numbers, - and _, 5-30 long (older ones may be shorter).
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;
const PROFILE_TIMEOUT_MS = 10_000;

export function cleanVenmoUsername(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim().replace(/^@/, '') : '';
  return USERNAME.test(name) ? name : null;
}

// What Venmo's scanner opens: the account's own code link.
export const venmoCodeUrl = (userId: string) => `https://venmo.com/code?user_id=${userId}`;
// What a phone camera opens in the Venmo app (or on the web).
export const venmoProfileUrl = (username: string) => `https://venmo.com/u/${username}`;

// The user record in a profile page's Next.js data, or null when it has none.
export function parseVenmoProfile(html: string, username: string): VenmoAccount | null {
  const script = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!script) return null;
  let user: { id?: unknown; username?: unknown; displayName?: unknown; profilePictureUrl?: unknown } | undefined;
  try {
    user = JSON.parse(script[1])?.props?.pageProps?.user;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'string' || !/^\d{5,25}$/.test(user.id)) return null;
  if (typeof user.username !== 'string' || user.username.toLowerCase() !== username.toLowerCase()) return null;
  const picture = typeof user.profilePictureUrl === 'string' && user.profilePictureUrl.startsWith('https://') ? user.profilePictureUrl : null;
  return { username: user.username, name: typeof user.displayName === 'string' ? user.displayName.slice(0, 100) : user.username, userId: user.id, picture };
}

// The test suite's stand-in for Venmo: any username is found, except "missing".
function fakeLookup(username: string): VenmoAccount {
  if (username.toLowerCase() === 'missing') throw new VenmoLookupError(`Venmo has no @${username}. Check the spelling.`);
  return { username, name: `Test ${username}`, userId: '1234567890123456789', picture: null };
}

export async function lookupVenmo(raw: unknown): Promise<VenmoAccount> {
  const username = cleanVenmoUsername(raw);
  if (!username) throw new VenmoLookupError('Venmo usernames are letters, numbers, - and _ only.');
  if (fakeQrServices()) return fakeLookup(username);

  let res: Response;
  try {
    res = await fetch(`https://account.venmo.com/u/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DanceWithB/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
  } catch {
    throw new VenmoLookupError("Couldn't reach Venmo. Try again in a moment.");
  }
  if (res.status === 404) throw new VenmoLookupError(`Venmo has no @${username}. Check the spelling.`);
  if (!res.ok) throw new VenmoLookupError(`Venmo didn't answer (${res.status}). Try again in a moment.`);
  const account = parseVenmoProfile(await res.text(), username);
  if (!account) throw new VenmoLookupError(`Couldn't read @${username}'s Venmo profile. It may be private, or Venmo changed its page.`);
  return account;
}
