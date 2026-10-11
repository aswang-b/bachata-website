// Browser-only. A modal that keeps an error on screen until the admin closes
// it, with the full text selectable and a Copy button, so sync/save failures
// can be read and pasted somewhere for debugging instead of flashing past in
// a toast. The dialog is built on first use, so pages need no extra markup.

let dialog: HTMLDialogElement | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.className =
    'm-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-bg p-0 text-ink shadow-2xl backdrop:bg-black/40';
  dialog.innerHTML = `
    <div class="p-6">
      <h3 data-error-title class="font-display text-lg font-bold text-ink"></h3>
      <p data-error-summary class="mt-2 text-sm text-ink/80"></p>
      <textarea
        data-error-detail
        readonly
        rows="8"
        class="themed-scrollbar mt-3 w-full resize-y rounded-xl border border-border bg-surface p-3 font-mono text-xs text-ink"
      ></textarea>
      <div class="mt-4 flex items-center justify-end gap-2">
        <span data-error-copied class="mr-auto text-xs font-semibold text-ink/60"></span>
        <button type="button" data-error-copy class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink/70 transition-colors hover:bg-surface">
          Copy error
        </button>
        <button type="button" data-error-close class="gradient-accent rounded-full px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90">
          Close
        </button>
      </div>
    </div>
  `;

  const detail = dialog.querySelector<HTMLTextAreaElement>('[data-error-detail]')!;
  const copied = dialog.querySelector<HTMLElement>('[data-error-copied]')!;
  dialog.querySelector('[data-error-copy]')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(detail.value);
      copied.textContent = 'Copied.';
    } catch {
      // Clipboard API blocked (e.g. insecure context): leave it selected to copy by hand.
      detail.select();
      copied.textContent = 'Press Ctrl+C to copy.';
    }
  });
  dialog.querySelector('[data-error-close]')!.addEventListener('click', () => dialog!.close());

  document.body.appendChild(dialog);
  return dialog;
}

// Shows `detail` (the raw error, stamped with the time and page) in a modal.
// Resolves once the admin closes it, so callers can wait before reloading.
export function showErrorDialog(title: string, summary: string, detail: string): Promise<void> {
  const el = ensureDialog();
  el.querySelector('[data-error-title]')!.textContent = title;
  el.querySelector('[data-error-summary]')!.textContent = summary;
  el.querySelector<HTMLTextAreaElement>('[data-error-detail]')!.value =
    `${detail}\n\n— ${new Date().toISOString()} on ${window.location.pathname}`;
  el.querySelector('[data-error-copied]')!.textContent = '';

  return new Promise((resolve) => {
    el.addEventListener('close', () => resolve(), { once: true });
    if (!el.open) el.showModal();
  });
}
