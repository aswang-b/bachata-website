import { RATINGS } from './feedback';
import { ITEM_KINDS, fillIn, type FeedbackItem, type ItemKind } from './feedbackQuestions';

// Browser-only: the questionnaire builder on /admin/feedback. Questions and
// messages in order, moved with arrows or by dragging the dots (mouse or
// touch), with a live preview of what dancers see. "Add question" opens a
// block of types; picking one turns it into that question.

const DEFAULT_TEXT: Record<ItemKind, string> = {
  faces: 'How was {class}?',
  scale: 'How likely are you to recommend us?',
  yesno: 'Would you come again?',
  single: 'Which part helped most?',
  multi: 'What should we spend more time on?',
  text: 'Anything else?',
  message: 'Hi {name}! Thanks for coming to {class}. A few quick questions would really help.',
};

const input = 'w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-ink';
const pill = 'rounded-full border border-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-white';
const textLink = 'text-sm font-semibold text-accent hover:underline disabled:opacity-40 disabled:no-underline';
const arrow = 'h-7 w-7 rounded-lg border border-border text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-ink';

const hasOptions = (kind: ItemKind) => kind === 'single' || kind === 'multi';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const newOption = (label: string) => ({ id: crypto.randomUUID(), label });

export function createBuilder(
  root: HTMLElement,
  preview: HTMLElement,
  contactBox: HTMLInputElement,
  initial: FeedbackItem[],
  previewValues: () => { className: string; name: string }
) {
  let items: FeedbackItem[] = structuredClone(initial);
  let picking = false;

  const list = el('div', 'flex flex-col gap-3');
  const adder = el('div', 'flex flex-col gap-3');
  root.replaceChildren(list, adder);

  function renderPreview() {
    const values = previewValues();
    preview.replaceChildren(
      ...items.map((item) => {
        const wrap = el('div', 'flex flex-col gap-2');
        if (item.kind === 'message') {
          wrap.append(el('p', 'whitespace-pre-line text-sm leading-relaxed text-ink', fillIn(item.text, values)));
          return wrap;
        }
        wrap.append(el('p', 'font-display text-sm font-bold text-ink', `${fillIn(item.text, values) || 'Untitled question'}${item.required ? ' *' : ''}`));
        const box = 'rounded-xl border border-border text-center text-xs text-ink';
        if (item.kind === 'faces') {
          const row = el('div', 'grid grid-cols-5 gap-1');
          for (const r of RATINGS) row.append(el('span', `${box} py-1.5 text-xl`, r.emoji));
          wrap.append(row);
        } else if (item.kind === 'scale') {
          const row = el('div', 'grid grid-cols-6 gap-1');
          for (let n = 0; n <= 10; n++) row.append(el('span', `${box} py-1 tabular-nums`, String(n)));
          wrap.append(row);
        } else if (item.kind === 'yesno') {
          const row = el('div', 'grid grid-cols-2 gap-1');
          row.append(el('span', `${box} py-2 font-semibold`, 'Yes'), el('span', `${box} py-2 font-semibold`, 'No'));
          wrap.append(row);
        } else if (item.kind === 'text') {
          wrap.append(el('div', 'h-14 rounded-xl border border-border'));
        } else {
          for (const o of item.options ?? []) wrap.append(el('span', `${box} px-3 py-2 text-left`, `${item.kind === 'single' ? '○' : '☐'} ${o.label}`));
        }
        return wrap;
      })
    );
    if (contactBox.checked) {
      const row = el('div', 'flex items-center justify-between gap-3 text-xs text-muted');
      const track = el('span', 'relative h-5 w-9 shrink-0 rounded-full bg-border');
      track.append(el('span', 'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow'));
      row.append(el('span', '', 'You may contact me about this'), track);
      preview.append(row);
    }
  }

  function changed() {
    renderList();
    renderAdder();
    renderPreview();
  }

  function move(index: number, by: number, focusSuffix: 'up' | 'down') {
    const to = index + by;
    if (to < 0 || to >= items.length) return;
    const [item] = items.splice(index, 1);
    items.splice(to, 0, item);
    changed();
    list.querySelector<HTMLButtonElement>(`[data-item="${item.id}"] .fb-move-${focusSuffix}`)?.focus();
  }

  // Dragging the dots: the other blocks step around the dragged one, which never
  // leaves the page (that would end the drag, as it holds the pointer).
  function startDrag(event: PointerEvent, card: HTMLElement) {
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);
    card.classList.add('opacity-50');
    const middle = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const onMove = (e: PointerEvent) => {
      for (;;) {
        const above = card.previousElementSibling;
        const below = card.nextElementSibling;
        if (above && e.clientY < middle(above)) card.after(above);
        else if (below && e.clientY > middle(below)) card.before(below);
        else return;
      }
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      const order = [...list.children].map((c) => (c as HTMLElement).dataset.item);
      items = order.map((id) => items.find((i) => i.id === id)!);
      changed();
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }

  function renderOptions(item: FeedbackItem): HTMLElement {
    const box = el('div', 'flex flex-col gap-1.5');
    (item.options ?? []).forEach((option, n) => {
      const row = el('div', 'flex items-center gap-2');
      const field = el('input', `fb-option ${input}`);
      field.type = 'text';
      field.value = option.label;
      field.setAttribute('aria-label', `Choice ${n + 1}`);
      field.addEventListener('input', () => {
        option.label = field.value;
        renderPreview();
      });
      const remove = button(textLink, 'Remove', () => {
        item.options!.splice(n, 1);
        changed();
      });
      remove.disabled = item.options!.length <= 2;
      row.append(field, remove);
      box.append(row);
    });
    const add = button(`${textLink} fb-add-option self-start`, '+ Add a choice', () => {
      item.options!.push(newOption(`Choice ${item.options!.length + 1}`));
      changed();
      list.querySelector<HTMLInputElement>(`[data-item="${item.id}"] .fb-option:last-of-type`)?.focus();
    });
    box.append(add);
    return box;
  }

  function renderList() {
    list.replaceChildren(
      ...items.map((item, index) => {
        const card = el('div', 'fb-item grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-border bg-surface p-3');
        card.dataset.item = item.id;
        card.dataset.kind = item.kind;

        const mover = el('div', 'flex flex-col items-center gap-0.5');
        const up = button(`fb-move-up ${arrow}`, '↑', () => move(index, -1, 'up'));
        up.disabled = index === 0;
        up.setAttribute('aria-label', `Move item ${index + 1} up`);
        const grip = el('span', 'fb-grip cursor-grab select-none px-1 py-0.5 text-muted [touch-action:none]', '⋮⋮');
        grip.title = 'Drag to reorder';
        grip.setAttribute('aria-hidden', 'true');
        grip.addEventListener('pointerdown', (e) => startDrag(e, card));
        const down = button(`fb-move-down ${arrow}`, '↓', () => move(index, 1, 'down'));
        down.disabled = index === items.length - 1;
        down.setAttribute('aria-label', `Move item ${index + 1} down`);
        mover.append(up, grip, down);

        const body = el('div', 'flex min-w-0 flex-col gap-2');
        const label = el('p', 'text-xs font-bold uppercase tracking-wider text-muted', ITEM_KINDS[item.kind]);
        const editor = item.kind === 'message' ? el('textarea', `fb-text ${input}`) : el('input', `fb-text ${input}`);
        if (editor instanceof HTMLTextAreaElement) editor.rows = 3;
        else editor.type = 'text';
        editor.value = item.text;
        editor.setAttribute('aria-label', item.kind === 'message' ? 'Message' : `Question ${index + 1}`);
        editor.addEventListener('input', () => {
          item.text = editor.value;
          renderPreview();
        });
        body.append(label, editor);

        if (hasOptions(item.kind)) body.append(renderOptions(item));

        const foot = el('div', 'flex flex-wrap items-center justify-between gap-2');
        if (item.kind === 'message') {
          foot.append(el('span', 'min-w-0 flex-1 basis-48 text-xs text-muted', 'Shows your words. Above the first question, it also opens the email and WhatsApp message.'));
        } else {
          const required = el('label', 'inline-flex items-center gap-1.5 text-sm text-muted');
          const check = el('input', 'fb-required accent-accent');
          check.type = 'checkbox';
          check.checked = Boolean(item.required);
          check.addEventListener('change', () => {
            if (check.checked) item.required = true;
            else delete item.required;
            renderPreview();
          });
          required.append(check, document.createTextNode('Required'));
          foot.append(required);
        }
        const remove = button(`fb-delete ${textLink}`, 'Delete', () => {
          items.splice(index, 1);
          changed();
        });
        foot.append(remove);
        body.append(foot);

        card.append(mover, body);
        return card;
      })
    );
  }

  function addItem(kind: ItemKind) {
    const item: FeedbackItem = { id: crypto.randomUUID(), kind, text: DEFAULT_TEXT[kind] };
    if (hasOptions(kind)) item.options = [newOption('First choice'), newOption('Second choice')];
    // A message most often opens the questionnaire.
    if (kind === 'message') items.unshift(item);
    else items.push(item);
    picking = false;
    changed();
    const editor = list.querySelector<HTMLInputElement>(`[data-item="${item.id}"] .fb-text`);
    editor?.focus();
    editor?.select();
  }

  function renderAdder() {
    if (!picking) {
      adder.replaceChildren(
        button(`fb-add ${pill} self-start`, 'Add question', () => {
          picking = true;
          renderAdder();
          adder.querySelector<HTMLButtonElement>('.fb-kind')?.focus();
        })
      );
      return;
    }
    const block = el('div', 'fb-picker flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-surface p-4');
    const top = el('div', 'flex items-center justify-between gap-3');
    top.append(
      el('p', 'text-sm font-semibold text-ink', 'What kind of question?'),
      button(textLink, 'Cancel', () => {
        picking = false;
        renderAdder();
        adder.querySelector<HTMLButtonElement>('.fb-add')?.focus();
      })
    );
    const kinds = el('div', 'flex flex-wrap gap-2');
    for (const kind of Object.keys(ITEM_KINDS) as ItemKind[]) {
      const choose = button(`fb-kind ${pill}`, ITEM_KINDS[kind], () => addItem(kind));
      choose.dataset.kind = kind;
      kinds.append(choose);
    }
    block.append(top, kinds);
    adder.replaceChildren(block);
  }

  contactBox.addEventListener('change', renderPreview);
  changed();

  return { getItems: () => items, refreshPreview: renderPreview };
}
