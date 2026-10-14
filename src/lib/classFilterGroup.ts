// Browser-only. The dancer dashboard's "Filter by class" control: one or more
// rows of [class] [date], a "+" on the last row to add another, and a remove
// button once there's more than one. A record passes when there are no
// filters, or when it matches ANY row (rows are OR'd together).

export interface ClassFilter {
  classTitle: string;
  // '' = every date of that class.
  occurrenceId: string;
}

interface SeriesLike {
  title: string;
  isSeries: boolean;
  occurrences: { id: string; label: string }[];
}

interface Options {
  container: HTMLElement;
  getClassTitles: () => string[];
  getSeries: () => SeriesLike[];
  onChange: () => void;
}

const SELECT_CLASS = 'min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-ink focus:border-accent focus:outline-none';
const ICON_BUTTON_CLASS =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-lg font-bold text-ink/70 transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40';

const emptyFilter = (): ClassFilter => ({ classTitle: '', occurrenceId: '' });

export function createClassFilterGroup({ container, getClassTitles, getSeries, onChange }: Options) {
  let filters: ClassFilter[] = [emptyFilter()];

  function option(value: string, label: string, selected: boolean): HTMLOptionElement {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    el.selected = selected;
    return el;
  }

  // Rebuilds every row. Keyboard focus goes to the control named by
  // `focusKey`, or else stays on whichever control (by row and role) had it,
  // so changing a filter never drops focus back to the top of the page.
  function render(focusKey?: string) {
    const active = document.activeElement;
    const keepKey = active instanceof HTMLElement && container.contains(active) ? active.dataset.focusKey : undefined;
    container.replaceChildren();
    const titles = getClassTitles();

    filters.forEach((filter, index) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';

      const classSelect = document.createElement('select');
      classSelect.className = SELECT_CLASS;
      classSelect.setAttribute('aria-label', 'Class');
      classSelect.dataset.focusKey = `class-${index}`;
      classSelect.append(option('', 'All classes', !filter.classTitle), ...titles.map((t) => option(t, t, t === filter.classTitle)));
      classSelect.addEventListener('change', () => {
        filters[index] = { classTitle: classSelect.value, occurrenceId: '' };
        render(`class-${index}`);
        onChange();
      });
      row.append(classSelect);

      // Only a real multi-date series has dates worth narrowing down to.
      const series = getSeries().find((s) => s.title === filter.classTitle && s.isSeries);
      if (series) {
        const occurrenceSelect = document.createElement('select');
        occurrenceSelect.className = SELECT_CLASS;
        occurrenceSelect.setAttribute('aria-label', 'Date');
        occurrenceSelect.dataset.focusKey = `date-${index}`;
        occurrenceSelect.append(
          option('', 'All dates', !filter.occurrenceId),
          ...series.occurrences.map((o) => option(o.id, o.label, o.id === filter.occurrenceId))
        );
        occurrenceSelect.addEventListener('change', () => {
          filters[index] = { ...filters[index], occurrenceId: occurrenceSelect.value };
          onChange();
        });
        row.append(occurrenceSelect);
      }

      if (filters.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = ICON_BUTTON_CLASS;
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove this class filter');
        remove.addEventListener('click', () => {
          filters.splice(index, 1);
          render(`class-${Math.max(0, index - 1)}`);
          onChange();
        });
        row.append(remove);
      }

      if (index === filters.length - 1) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = ICON_BUTTON_CLASS;
        add.textContent = '+';
        add.setAttribute('aria-label', 'Add another class filter');
        add.title = filter.classTitle ? 'Also show another class' : 'Pick a class first';
        add.disabled = !filter.classTitle;
        add.dataset.focusKey = 'add';
        add.addEventListener('click', () => {
          filters.push(emptyFilter());
          render(`class-${filters.length - 1}`);
        });
        row.append(add);
      }

      container.append(row);
    });

    const key = focusKey ?? keepKey;
    if (key) container.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus();
  }

  render();

  return {
    // True when `test` accepts any active filter, or no filter is set.
    matches(test: (filter: ClassFilter) => boolean): boolean {
      const active = filters.filter((f) => f.classTitle);
      return active.length === 0 || active.some(test);
    },
    reset() {
      filters = [emptyFilter()];
      render();
    },
    // Re-renders after the class list or series data loads.
    refresh: () => render(),
  };
}
