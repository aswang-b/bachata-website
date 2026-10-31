// A deal's last stretch on the homepage counts down to the second ("5:03:09
// left"): rendered by the server, then kept ticking by the page's script, so
// this stays small enough for the browser bundle.
export const COUNTDOWN_MS = 12 * 60 * 60 * 1000;

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)} left`;
}
