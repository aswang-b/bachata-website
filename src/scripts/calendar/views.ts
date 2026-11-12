// The Calendar / List switch (remembered in this browser) and the list view's Read more links.

// --- Calendar / List view toggle ---
const viewToggleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.view-toggle-btn'));
const calendarViewEl = document.getElementById('calendar-view')!;
const listViewEl = document.getElementById('list-view')!;

function setActiveView(view: string) {
  calendarViewEl.classList.toggle('hidden', view !== 'calendar');
  listViewEl.classList.toggle('hidden', view !== 'list');
  listViewEl.classList.toggle('flex', view === 'list');
  if (view === 'list') refreshReadMoreLinks();
  viewToggleButtons.forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('gradient-accent', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-ink/70', !active);
  });
}

// List view: a "Read more" link under each description that's cut off,
// expanding it in place.
function refreshReadMoreLinks() {
  listViewEl.querySelectorAll<HTMLElement>('.list-desc').forEach((desc) => {
    const toggle = desc.nextElementSibling as HTMLButtonElement | null;
    if (!toggle?.classList.contains('list-desc-toggle') || toggle.getAttribute('aria-expanded') === 'true') return;
    toggle.classList.toggle('hidden', desc.scrollHeight <= desc.clientHeight + 1);
  });
}

export function initListView() {
  listViewEl.addEventListener('click', (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLButtonElement>('.list-desc-toggle');
    if (!toggle) return;
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.previousElementSibling?.classList.toggle('line-clamp-2', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'Show less' : 'Read more';
  });
  window.addEventListener('resize', refreshReadMoreLinks);
}

const VIEW_STORAGE_KEY = 'bwb-calendar-view';

function saveActiveView(view: string) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // ignore — the toggle still works for this page load, it just won't persist.
  }
}

export function initViewToggle() {
  viewToggleButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      const view = btn.dataset.view ?? 'calendar';
      setActiveView(view);
      saveActiveView(view);
    })
  );

  let savedView = 'calendar';
  try {
    savedView = localStorage.getItem(VIEW_STORAGE_KEY) ?? 'calendar';
  } catch {
    // ignore — default to calendar.
  }
  setActiveView(savedView === 'list' ? 'list' : 'calendar');
}
