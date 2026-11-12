// Remembering the first dancer's contact details on this device, so the next
// sign-up on the same phone or laptop starts filled in.
//
// What is kept (localStorage, key dwb.dancer.v1, never sent anywhere, no cookie):
// first and last name, email, phone and role of the FIRST dancer only. Never
// the payment choice, the classes, the notes, answers, or any other dancer.
//
// When: the form posts natively and the server answers with a redirect, so the
// form cannot tell a success from a failure. At submit it parks the values in
// sessionStorage (this tab only); the confirmation page, which only exists for a
// sign-up the server saved, moves them into localStorage (commitPendingDancer).
// A failed or abandoned form never reaches it, and the form clears anything
// still parked when it loads. Every storage call is wrapped: a blocked, full
// or corrupt store leaves the form exactly as it was.
//
// Stored text is only ever assigned to input values, never written as HTML.

export const SAVED_KEY = 'dwb.dancer.v1';
export const PENDING_KEY = 'dwb.dancer.pending.v1';
// A parked record older than this is not a sign-up the visitor just made.
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

export const MAX_NAME = 120;
export const MAX_EMAIL = 254;
export const MAX_PHONE = 40;

export type DancerRole = 'leader' | 'follower' | '';

export interface DancerDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: DancerRole;
}

export interface SavedDancer extends DancerDetails {
  savedAt: number;
}

// The part of Storage used here, so tests can pass a plain object.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function clean(raw: unknown): DancerDetails {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    firstName: text(o.firstName, MAX_NAME),
    lastName: text(o.lastName, MAX_NAME),
    email: text(o.email, MAX_EMAIL),
    phone: text(o.phone, MAX_PHONE),
    role: o.role === 'leader' || o.role === 'follower' ? o.role : '',
  };
}

const hasContact = (d: DancerDetails) => Boolean(d.firstName || d.lastName || d.email || d.phone);

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The saved details, capped and checked, or null when there are none to use.
export function readSavedDancer(storage: StorageLike): SavedDancer | null {
  const raw = readJson(storage, SAVED_KEY);
  const d = clean(raw);
  if (!hasContact(d)) return null;
  const at = (raw as Record<string, unknown>).savedAt;
  return { ...d, savedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0 };
}

// Returns whether anything was stored.
export function saveDancer(storage: StorageLike, details: DancerDetails, now = Date.now()): boolean {
  const d = clean(details);
  if (!hasContact(d)) return false;
  try {
    storage.setItem(SAVED_KEY, JSON.stringify({ ...d, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedDancer(storage: StorageLike): void {
  try {
    storage.removeItem(SAVED_KEY);
  } catch {
    /* nothing to do: the form works the same without it */
  }
}

// Parks the first dancer's details for the confirmation page to keep.
export function parkDancer(session: StorageLike, details: DancerDetails, now = Date.now()): void {
  try {
    session.setItem(PENDING_KEY, JSON.stringify({ ...clean(details), at: now }));
  } catch {
    /* nothing to do */
  }
}

export function dropParkedDancer(session: StorageLike): void {
  try {
    session.removeItem(PENDING_KEY);
  } catch {
    /* nothing to do */
  }
}

// On a confirmation page of a saved sign-up: keeps what was parked at submit.
export function commitParkedDancer(session: StorageLike, local: StorageLike, now = Date.now()): boolean {
  const raw = readJson(session, PENDING_KEY);
  dropParkedDancer(session);
  if (!raw || typeof raw !== 'object') return false;
  const at = (raw as Record<string, unknown>).at;
  if (typeof at !== 'number' || now - at > PENDING_MAX_AGE_MS || at > now + 60_000) return false;
  return saveDancer(local, clean(raw), now);
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return window[kind];
  } catch {
    return null; // blocked: even reading the property throws
  }
}

// For the confirmation page.
export function commitParkedDancerInBrowser(): void {
  const session = browserStorage('sessionStorage');
  const local = browserStorage('localStorage');
  if (session && local) commitParkedDancer(session, local);
}

const ROLE_ACTIVE = ['gradient-accent', 'text-white', 'border-transparent'];
const ROLE_IDLE = ['text-ink/70', 'border-border'];

function fire(input: HTMLInputElement) {
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Wires the sign-up form: fills the first dancer when it is still empty and
// offers Clear, and parks the first dancer's details when a submit goes through.
// Call after the first dancer block exists and the form's own submit checks are
// registered. Nothing is added to the page unless something was filled; the one
// empty status line is zero-height and cancels its flex gap.
export function initRememberDancer(form: HTMLFormElement | null): void {
  const block = form?.querySelector<HTMLElement>('.dancer-block');
  if (!form || !block) return;
  const local = browserStorage('localStorage');
  const session = browserStorage('sessionStorage');

  const field = (cls: string) => block.querySelector<HTMLInputElement>(cls);
  const first = field('.dancer-first-name');
  const last = field('.dancer-last-name');
  const phone = field('.dancer-phone');
  const email = field('.dancer-email');
  if (!first || !last || !phone || !email) return;
  const roleButtons = Array.from(block.querySelectorAll<HTMLButtonElement>('.dancer-role-btn'));

  const current = (): DancerDetails =>
    clean({
      firstName: first.value,
      lastName: last.value,
      email: email.value,
      phone: phone.value,
      role: block.dataset.role,
    });

  // Anything left parked belongs to a submit that did not reach a confirmation.
  if (session) dropParkedDancer(session);
  if (session) {
    form.addEventListener('submit', (e) => {
      if (e.defaultPrevented) return; // stopped by a check; trackSubmit does the same
      parkDancer(session, current());
    });
  }

  if (!local) return;
  const saved = readSavedDancer(local);
  if (!saved) return;
  const untouched = !first.value && !last.value && !phone.value && !email.value && !block.dataset.role;
  if (!untouched) return; // server-prefilled or restored by the browser: leave it

  // The live region sits in the page (empty) before it speaks, and its flex
  // gap is cancelled while empty, so a visitor with nothing saved sees no gap.
  const note = document.createElement('p');
  note.setAttribute('role', 'status');
  note.className = 'remembered-note text-xs text-muted empty:-mt-3';
  (phone.closest('.grid') ?? block.lastElementChild)!.after(note);

  const assign = (input: HTMLInputElement, value: string) => {
    if (!value) return;
    input.value = value;
    fire(input);
  };
  assign(first, saved.firstName);
  assign(last, saved.lastName);
  assign(phone, saved.phone);
  assign(email, saved.email);
  if (saved.role) roleButtons.find((b) => b.dataset.role === saved.role)?.click();

  note.append('Filled in from your last sign-up on this device. ');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.className = 'hit-44 relative font-semibold text-accent underline hover:no-underline';
  note.append(clear);

  clear.addEventListener('click', () => {
    clearSavedDancer(local);
    for (const input of [first, last, phone, email]) {
      input.value = '';
      fire(input);
    }
    delete block.dataset.role;
    for (const b of roleButtons) {
      b.setAttribute('aria-pressed', 'false');
      b.classList.remove(...ROLE_ACTIVE);
      b.classList.add(...ROLE_IDLE);
    }
    note.textContent = '';
    first.focus();
  });
}
