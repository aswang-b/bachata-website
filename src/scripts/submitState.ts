// The sending state of a public form (registration, contact, check-in). They
// post natively, so once a submit goes through the page is on its way to a new
// one: the button is locked and says what is happening until it arrives. A
// second tap is refused while it waits. If the page is shown again (back button,
// bfcache, a failed request's error page left behind) the button comes back.
//
// Nothing fires when the visitor presses Stop or the network drops and the
// browser stays on the page, so the lock also lets go by itself after
// RELEASE_AFTER_MS. That is longer than the server can take: Netlify cuts a
// function off at 10 s by default (netlify.toml sets no other limit) and a sign-up
// only waits on the database and a few emails. A tap after the release is safe:
// the server collapses a repeated sign-up or check-in into the first one
// (flagDuplicateSubmission / flagDuplicateCheckins in lib/duplicateSubmissions.ts,
// answered with a redirect to the original's confirmation).
//
// The button is disabled inside the submit event, before the browser builds the
// form data. That is fine because no submit button here has a name, value or
// formaction, and neither API route reads a field from one.

export const RELEASE_AFTER_MS = 20_000;

export function trackSubmit(form: HTMLFormElement | null, busyLabel: string): void {
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !button) return;
  const label = button.textContent ?? '';
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const restore = () => {
    clearTimeout(timer);
    busy = false;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.style.minWidth = '';
    button.textContent = label;
  };

  // Registered after the page's own checks, so a submit one of them stopped
  // (a missing field, an email note) is already defaultPrevented here.
  form.addEventListener('submit', (e) => {
    if (busy) return e.preventDefault();
    if (e.defaultPrevented) return;
    busy = true;
    button.style.minWidth = `${button.getBoundingClientRect().width}px`;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyLabel;
    button.disabled = true;
    timer = setTimeout(restore, RELEASE_AFTER_MS);
  });

  window.addEventListener('pageshow', restore);
}
