import type { ClassSeriesEntry } from './classSeries';

// Browser-only: the class picker on /admin/qr. One date per class (a series
// opens its dates); the order picked is kept. "Also register attendees as
// drop-ins" needs a drop-in price and open registration on every pick.

export interface ClassPicker {
  eventIds(): string[];
  // "Bachata Foundations · Sensual Styling", for the sign.
  titles(): string[];
  // Loads a saved sign's classes (ones no longer listed, e.g. past, are left out),
  // and its "also register" choice when it's still allowed.
  select(eventIds: string[], registerToo: boolean): void;
}

const REGISTER_HINT = "For drop-in-only events: checking in also creates an unpaid drop-in registration, so attendees don't show up as orphaned check-ins.";

export function createClassPicker(
  list: HTMLElement,
  summary: HTMLElement,
  registerToo: HTMLInputElement,
  registerHint: HTMLElement,
  classes: ClassSeriesEntry[],
  onChange: () => void
): ClassPicker {
  // series key → chosen occurrence id, in the order picked
  const picked = new Map<string, string>();
  const byKey = new Map(classes.map((c) => [c.key, c]));

  function syncRegister() {
    registerToo.checked = false;
    const chosen = [...picked.keys()].map((k) => byKey.get(k)!);
    const several = chosen.length > 1;
    const closed = chosen.find((c) => c.registrationClosed);
    const noPrice = chosen.find((c) => c.priceDropIn == null);
    registerToo.disabled = chosen.length === 0 || Boolean(closed || noPrice);
    if (chosen.length === 0) registerHint.textContent = `${REGISTER_HINT} Pick a class first.`;
    else if (closed) registerHint.textContent = `Not available: registration is closed for ${several ? closed.title : 'this class'}.`;
    else if (noPrice) registerHint.textContent = `Not available: ${several ? noPrice.title : 'this class'} has no drop-in price set.`;
    else registerHint.textContent = `${REGISTER_HINT} ${several ? `Dancers are registered as drop-ins for whichever they pick (${chosen.map((c) => `${c.title} $${c.priceDropIn}`).join(', ')}).` : `Each check-in is registered at the $${chosen[0].priceDropIn} drop-in price.`}`;
  }

  function changed() {
    for (const item of list.querySelectorAll<HTMLElement>('.class-item')) item.dataset.selected = String(picked.has(item.dataset.key!));
    for (const btn of list.querySelectorAll<HTMLButtonElement>('.occurrence-btn')) {
      const on = picked.get(btn.dataset.key!) === btn.dataset.eventId;
      btn.classList.toggle('gradient-accent', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('border-transparent', on);
      btn.classList.toggle('text-ink/70', !on);
    }
    summary.textContent =
      picked.size === 0 ? '' : picked.size === 1 ? '1 class selected. Dancers check in straight to it.' : `${picked.size} classes selected. Dancers pick which they're checking in for.`;
    syncRegister();
    onChange();
  }

  list.replaceChildren(
    ...classes.map((c) => {
      const item = document.createElement('div');
      item.className = 'class-item overflow-hidden rounded-xl border border-border bg-surface data-[selected=true]:border-accent';
      item.dataset.key = c.key;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'class-select-btn flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-bg';
      const title = document.createElement('span');
      title.className = 'font-semibold text-ink';
      title.textContent = c.title;
      const sub = document.createElement('span');
      sub.className = 'text-xs text-muted';
      sub.textContent = c.subLabel;
      toggle.append(title, sub);
      item.append(toggle);

      let dates: HTMLElement | null = null;
      if (c.isSeries) {
        dates = document.createElement('div');
        dates.className = 'occurrence-picker hidden flex-wrap gap-2 border-t border-border bg-bg p-4';
        for (const o of c.occurrences) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'occurrence-btn rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink/70 transition-colors';
          b.dataset.eventId = o.id;
          b.dataset.key = c.key;
          b.textContent = o.label;
          // One date per class: another date swaps it, the same date clears it.
          b.addEventListener('click', () => {
            if (picked.get(c.key) === o.id) picked.delete(c.key);
            else picked.set(c.key, o.id);
            changed();
          });
          dates.append(b);
        }
        item.append(dates);
      }
      toggle.addEventListener('click', () => {
        if (picked.has(c.key)) {
          picked.delete(c.key);
          dates?.classList.add('hidden');
          dates?.classList.remove('flex');
          changed();
        } else if (dates) {
          const open = !dates.classList.contains('hidden');
          dates.classList.toggle('hidden', open);
          dates.classList.toggle('flex', !open);
        } else {
          picked.set(c.key, c.singleEventId!);
          changed();
        }
      });
      return item;
    })
  );
  registerToo.addEventListener('change', onChange);
  syncRegister();

  return {
    eventIds: () => [...picked.values()],
    titles: () => [...picked.keys()].map((k) => byKey.get(k)!.title),
    select(eventIds, register) {
      picked.clear();
      for (const id of eventIds) {
        const c = classes.find((x) => x.singleEventId === id || x.occurrences.some((o) => o.id === id));
        if (c && !picked.has(c.key)) picked.set(c.key, id);
      }
      for (const item of list.querySelectorAll<HTMLElement>('.class-item')) {
        const dates = item.querySelector<HTMLElement>('.occurrence-picker');
        const open = picked.has(item.dataset.key!) && Boolean(dates);
        dates?.classList.toggle('hidden', !open);
        dates?.classList.toggle('flex', open);
      }
      changed();
      if (register && !registerToo.disabled) {
        registerToo.checked = true;
        onChange();
      }
    },
  };
}
