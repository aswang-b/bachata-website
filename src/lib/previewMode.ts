// Lets a signed-in admin browse the site as a public visitor would, for
// debugging — purely a client-side UI toggle (localStorage), never a real
// permission change. Server-side admin routes stay gated by requireAdmin()
// regardless of this flag.
const KEY = 'bwb-preview-as-public';

export function isPreviewingAsPublic(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPreviewAsPublic(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // localStorage unavailable — nothing to persist, toggle just won't stick.
  }
}
