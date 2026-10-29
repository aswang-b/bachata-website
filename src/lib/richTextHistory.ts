// Undo/redo for the site's rich-text boxes (any contenteditable): the
// toolbars' Undo and Redo buttons and Ctrl/⌘+Z, Ctrl/⌘+Shift+Z and Ctrl+Y.
// Each box keeps its own history, so it never undoes into another box.
//
// A save can't be undone on the server, so a box can also remember what it
// held before a save (in this browser): reopened later, the box's first Undo
// brings that version back (see rememberBeforeSave / offerPrevious).

interface History {
  stack: string[];
  index: number;
  // What the box held when it was last loaded or saved.
  baseline: string;
  // Typed since the last snapshot (snapshots wait for a pause in typing).
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_STEPS = 100;
const TYPING_PAUSE_MS = 500;
const STORAGE_PREFIX = 'rich-prev:';
const MAX_REMEMBERED = 50;

const histories = new WeakMap<HTMLElement, History>();
let applying = false;
let installed = false;

const isRichText = (el: EventTarget | null): el is HTMLElement => el instanceof HTMLElement && el.isContentEditable;

// The contenteditable root (the box itself, not a <b> inside it).
function boxOf(el: HTMLElement): HTMLElement {
  let box = el;
  while (box.parentElement?.isContentEditable) box = box.parentElement;
  return box;
}

function startHistory(box: HTMLElement, stack: string[]): History {
  const h: History = { stack, index: stack.length - 1, baseline: stack[0], pending: false, timer: null };
  histories.set(box, h);
  return h;
}

// The box's history, started fresh when its content was replaced from outside
// (a different class opened in the editor, a reload of the saved text).
function historyOf(box: HTMLElement): History {
  const h = histories.get(box);
  if (h && (h.pending || h.stack[h.index] === box.innerHTML)) return h;
  return startHistory(box, [box.innerHTML]);
}

function commit(box: HTMLElement, h: History) {
  if (h.timer) clearTimeout(h.timer);
  h.timer = null;
  if (!h.pending) return;
  h.pending = false;
  if (box.innerHTML === h.stack[h.index]) return;
  h.stack = [...h.stack.slice(0, h.index + 1), box.innerHTML].slice(-MAX_STEPS);
  h.index = h.stack.length - 1;
}

function show(box: HTMLElement, html: string) {
  applying = true;
  box.innerHTML = html;
  // Other listeners (e.g. the editor's summaries) still hear about the change.
  box.dispatchEvent(new Event('input', { bubbles: true }));
  applying = false;
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function undo(box: HTMLElement) {
  const h = historyOf(box);
  commit(box, h);
  if (h.index === 0) return;
  h.index -= 1;
  show(box, h.stack[h.index]);
}

export function redo(box: HTMLElement) {
  const h = historyOf(box);
  commit(box, h);
  if (h.index >= h.stack.length - 1) return;
  h.index += 1;
  show(box, h.stack[h.index]);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Call after a successful save: keeps what the box held before it (if the
// save changed it) under `key`, for offerPrevious when it's opened again.
export function rememberBeforeSave(box: HTMLElement, key: string) {
  const h = historyOf(box);
  commit(box, h);
  const before = h.baseline;
  h.baseline = box.innerHTML;
  if (before === box.innerHTML) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_PREFIX + key, before);
    // Only the most recent few are kept.
    const keys = Object.keys(store).filter((k) => k.startsWith(STORAGE_PREFIX));
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) store.removeItem(k);
  } catch {
    // Storage full or blocked: undo still works until the page is left.
  }
}

// Call after loading saved text into a box: if it was saved over something
// else in this browser, Undo brings that back.
export function offerPrevious(box: HTMLElement, key: string) {
  let previous: string | null = null;
  try {
    previous = storage()?.getItem(STORAGE_PREFIX + key) ?? null;
  } catch {
    previous = null;
  }
  const h = startHistory(box, previous !== null && previous !== box.innerHTML ? [previous, box.innerHTML] : [box.innerHTML]);
  h.baseline = box.innerHTML;
}

export function installRichTextHistory(): void {
  if (installed) return;
  installed = true;

  // The starting point is taken before anything changes: on focus (the
  // toolbars focus the box before formatting, which fires no beforeinput) and
  // before typing.
  for (const type of ['focusin', 'beforeinput']) {
    document.addEventListener(
      type,
      (e) => {
        if (!applying && isRichText(e.target)) historyOf(boxOf(e.target));
      },
      true
    );
  }

  document.addEventListener('input', (e) => {
    if (applying || !isRichText(e.target)) return;
    const box = boxOf(e.target);
    const h = histories.get(box);
    if (!h) return;
    h.pending = true;
    if (h.timer) clearTimeout(h.timer);
    h.timer = setTimeout(() => commit(box, h), TYPING_PAUSE_MS);
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing || !isRichText(e.target)) return;
      const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase();
      const isUndo = letter === 'z' && !e.shiftKey;
      const isRedo = (letter === 'z' && e.shiftKey) || (letter === 'y' && !e.shiftKey);
      if (!isUndo && !isRedo) return;
      e.preventDefault();
      (isUndo ? undo : redo)(boxOf(e.target));
    },
    true
  );

  // Toolbar buttons: data-rich-history="undo|redo" and data-rich-target, a
  // selector looked up inside the nearest [data-rich-scope] (else the page).
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-rich-history]');
    if (!btn?.dataset.richTarget) return;
    const scope = btn.closest('[data-rich-scope]') ?? document;
    const box = scope.querySelector<HTMLElement>(btn.dataset.richTarget);
    if (!box) return;
    (btn.dataset.richHistory === 'redo' ? redo : undo)(box);
  });
}
