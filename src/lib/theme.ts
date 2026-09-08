// Site-wide light/dark toggle for all visitors. Defaults to dark for every
// visitor regardless of OS preference (handled in global.css); an explicit
// choice here overrides it via a cookie so it persists across visits.
const COOKIE_NAME = 'bwb-theme';

export type Theme = 'light' | 'dark';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function getExplicitTheme(): Theme | null {
  const value = readCookie(COOKIE_NAME);
  return value === 'light' || value === 'dark' ? value : null;
}

export function getEffectiveTheme(): Theme {
  return getExplicitTheme() ?? 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  writeCookie(COOKIE_NAME, theme);
}
