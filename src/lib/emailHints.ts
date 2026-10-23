import { suggestEmail } from './emailTypos';

// Browser side of the email checks on the sign-up and contact forms. When an
// email field is left, a note under it offers a likely fix ("Did you mean
// …@gmail.com?", see emailTypos.ts) or says its domain can't receive email
// (/api/email-domain). Neither blocks for good: the first submit with a note
// still showing stops at it, and submitting again goes ahead as typed.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const domainCache = new Map<string, Promise<boolean>>();

function domainOk(domain: string): Promise<boolean> {
  const key = domain.toLowerCase();
  let pending = domainCache.get(key);
  if (!pending) {
    pending = fetch(`/api/email-domain?domain=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { ok: true }))
      .then((b: { ok?: boolean }) => b.ok !== false)
      // Can't check right now: don't hold anyone up.
      .catch(() => true);
    domainCache.set(key, pending);
  }
  return pending;
}

type HintState = { value: string; note: 'none' | 'suggest' | 'domain'; acknowledged: boolean; check: Promise<void> };
const states = new WeakMap<HTMLInputElement, HintState>();

function hintFor(input: HTMLInputElement): HTMLElement {
  const id = input.dataset.hintId ?? `email-hint-${Math.random().toString(36).slice(2, 8)}`;
  input.dataset.hintId = id;
  let hint = document.getElementById(id);
  if (!hint) {
    hint = document.createElement('p');
    hint.id = id;
    hint.className = 'email-hint hidden text-xs font-semibold text-amber-300';
    hint.setAttribute('role', 'status');
    input.insertAdjacentElement('afterend', hint);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
  }
  return hint;
}

function show(input: HTMLInputElement, content: (string | Node)[] | null) {
  const hint = hintFor(input);
  hint.replaceChildren(...(content ?? []));
  hint.classList.toggle('hidden', !content);
}

function check(input: HTMLInputElement): HintState {
  const value = input.value.trim();
  const existing = states.get(input);
  if (existing && existing.value === value) return existing;

  const state: HintState = { value, note: 'none', acknowledged: false, check: Promise.resolve() };
  states.set(input, state);
  show(input, null);
  if (!EMAIL_RE.test(value)) return state;

  const suggestion = suggestEmail(value);
  if (suggestion) {
    state.note = 'suggest';
    const fix = document.createElement('button');
    fix.type = 'button';
    fix.className = 'email-hint-fix underline hover:text-ink';
    fix.textContent = suggestion;
    fix.addEventListener('click', () => {
      input.value = suggestion;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      check(input);
      input.focus();
    });
    show(input, ['Did you mean ', fix, '?']);
    return state;
  }

  const domain = value.slice(value.lastIndexOf('@') + 1);
  state.check = domainOk(domain).then((ok) => {
    if (states.get(input) !== state || ok) return;
    state.note = 'domain';
    show(input, [`We couldn't find the email domain "${domain}". Please double-check it.`]);
  });
  return state;
}

export function attachEmailHint(input: HTMLInputElement) {
  input.addEventListener('blur', () => check(input));
  input.addEventListener('input', () => {
    const state = states.get(input);
    if (state && state.value !== input.value.trim()) show(input, null);
  });
}

// Run on submit, after the form's own checks pass. Resolves true when it can
// go ahead; false (once per note) when a note is showing, focusing that field
// and adding "or submit again to use it as typed".
export async function emailsReadyToSubmit(inputs: HTMLInputElement[]): Promise<boolean> {
  const filled = inputs.filter((i) => i.value.trim());
  const checked = filled.map((input) => ({ input, state: check(input) }));
  await Promise.all(checked.map((c) => c.state.check));
  const open = checked.find((c) => c.state.note !== 'none' && !c.state.acknowledged);
  if (!open) return true;
  for (const c of checked) if (c.state.note !== 'none') c.state.acknowledged = true;
  const hint = hintFor(open.input);
  hint.append(' Or submit again to use it as typed.');
  open.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  open.input.focus({ preventScroll: true });
  return false;
}
