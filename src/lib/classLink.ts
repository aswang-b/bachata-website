// A class's own link on this site: /register?series=<key> for a class,
// /register/events?series=<key> for an event. The homepage's Register button,
// the Share buttons and a shared flyer's caption all use this one rule. Pure.
export function classPath(eventType: string | null | undefined, key: string): string {
  return `${eventType === 'event' ? '/register/events' : '/register'}?series=${encodeURIComponent(key)}`;
}
