// Browser-only. Stops a native form POST from going out twice when the submit
// button is clicked repeatedly before the next page loads. Call it AFTER the
// form's own validation listener: a submit that validation cancelled
// (defaultPrevented) doesn't count, so the dancer can fix it and try again.
// The server still catches duplicates that get past this (see
// duplicateSubmissions.ts).
export function submitOnce(form: HTMLFormElement | null | undefined, busyLabel = 'Submitting…'): void {
  if (!form) return;
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
  const labels = buttons.map((b) => b.textContent);
  let submitted = false;

  const reset = () => {
    submitted = false;
    buttons.forEach((b, i) => {
      b.disabled = false;
      b.textContent = labels[i];
      b.classList.remove('opacity-60', 'cursor-wait');
    });
  };

  form.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    if (submitted) {
      e.preventDefault();
      return;
    }
    submitted = true;
    buttons.forEach((b) => {
      b.disabled = true;
      b.textContent = busyLabel;
      b.classList.add('opacity-60', 'cursor-wait');
    });
  });

  // Coming back with the browser's Back button can restore this page from
  // the back/forward cache with the button still disabled.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) reset();
  });
}
