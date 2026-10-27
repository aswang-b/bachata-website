// "Did you mean …?" for a mistyped email domain (gmial.com, yahooo.com,
// gmail.co, hotmail.con). Pure, runs in the browser on the sign-up and
// contact forms.

const COMMON_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'live.com',
  'msn.com',
  'me.com',
  'mac.com',
  'comcast.net',
  'charter.net',
  'att.net',
  'sbcglobal.net',
  'verizon.net',
  'protonmail.com',
  'proton.me',
  'ymail.com',
  'wisc.edu',
  'madisoncollege.edu',
];

// Real mail domains a letter or two from a common one (mail.com → gmail.com,
// aim.com → aol.com): never "corrected".
const REAL_DOMAINS = ['mail.com', 'email.com', 'aim.com', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.ru', 'zoho.com', 'yandex.com', 'hey.com', 'pm.me', 'fastmail.com', 'rocketmail.com'];

// Providers with country domains of their own (yahoo.ca, live.ca, hotmail.fr):
// one of these names on a two-letter country ending is left alone. Not .co,
// which is the usual slip for .com.
const COUNTRY_PROVIDERS = ['yahoo', 'hotmail', 'live', 'outlook', 'msn'];

function isCountryVariant(domain: string): boolean {
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  const name = labels[0];
  if (!COUNTRY_PROVIDERS.includes(name) || labels.length < 2) return false;
  // yahoo.co.uk, yahoo.com.mx
  if (labels.length === 3 && ['co', 'com'].includes(labels[1]) && tld.length === 2) return true;
  return labels.length === 2 && tld.length === 2 && tld !== 'co';
}

// Endings that are almost always a slip for a common one (not .co, .cm or
// .om, which are real country domains).
const TLD_FIXES: Record<string, string> = {
  con: 'com',
  cmo: 'com',
  ocm: 'com',
  comm: 'com',
  vom: 'com',
  xom: 'com',
  cpm: 'com',
  ner: 'net',
  nett: 'net',
  nte: 'net',
  ogr: 'org',
  edi: 'edu',
};

// Optimal string alignment distance (a swap of two neighboring letters counts as one edit).
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The corrected address, or null when the domain looks fine (or isn't close
// to anything we know).
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || COMMON_DOMAINS.includes(domain) || REAL_DOMAINS.includes(domain) || isCountryVariant(domain)) return null;

  // Closest common domain, one or two edits away (only one for short ones, so
  // "me.co" isn't turned into something unrelated).
  let best: { domain: string; d: number } | null = null;
  for (const known of COMMON_DOMAINS) {
    const d = distance(domain, known);
    const limit = known.length <= 6 ? 1 : 2;
    if (d > 0 && d <= limit && (!best || d < best.d)) best = { domain: known, d };
  }
  if (best) return `${local}@${best.domain}`;

  // Otherwise just a slipped ending: "name@somecompany.con".
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot + 1) : '';
  const fix = TLD_FIXES[tld];
  if (fix) return `${local}@${domain.slice(0, dot + 1)}${fix}`;
  return null;
}
