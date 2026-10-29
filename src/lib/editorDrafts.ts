// The calendar editor's tabs (one per linked class, see calendar.astro) share
// one form: switching tabs keeps what was typed in the one being left as a
// draft and puts it back on return. A draft is every field's value (and
// whether it's disabled), keyed by id (radios by name and value), plus the
// rich-text boxes' HTML. Parts marked [data-draft-skip] (the Linked
// Classes/Events section, which saves on its own) are left out.

export type FieldValues = Record<string, { value: string | boolean; disabled: boolean }>;

function fieldKey(el: Element): string | null {
  if (el instanceof HTMLInputElement && el.type === 'radio') return el.name ? `radio:${el.name}:${el.value}` : null;
  return el.id || null;
}

function fields(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea, [contenteditable="true"]')).filter(
    // A file picker's value can't be set back (uploads are kept as their URL fields instead).
    (el) => !el.closest('[data-draft-skip]') && fieldKey(el) !== null && !(el instanceof HTMLInputElement && el.type === 'file')
  );
}

export function captureFields(root: HTMLElement): FieldValues {
  const out: FieldValues = {};
  for (const el of fields(root)) {
    const key = fieldKey(el)!;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) out[key] = { value: el.checked, disabled: el.disabled };
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) out[key] = { value: el.value, disabled: el.disabled };
    else out[key] = { value: el.innerHTML, disabled: false };
  }
  return out;
}

export function applyFields(root: HTMLElement, values: FieldValues): void {
  for (const el of fields(root)) {
    const saved = values[fieldKey(el)!];
    if (!saved) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = Boolean(saved.value);
      el.disabled = saved.disabled;
    } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      el.value = String(saved.value);
      el.disabled = saved.disabled;
    } else {
      el.innerHTML = String(saved.value);
    }
  }
}
