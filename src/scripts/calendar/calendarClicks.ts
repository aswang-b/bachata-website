// Clicks and keys on the month grid: a banner opens its details, a phone's
// dots open the day, and an admin's click on a day's empty space adds a class.
import { showEventDetail } from './detailPanel';
import { toggleDayExpand } from './monthGrid';
import { shared } from './state';

export function initCalendarClicks() {
  // Delegated so it keeps working after client-side re-rendering.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const banner = target.closest('.event-banner');
    if (banner) {
      const event = JSON.parse((banner as HTMLElement).dataset.event ?? '{}');
      showEventDetail(event);
      return;
    }

    // Mobile only — .day-dots is hidden at the sm breakpoint and up, so this
    // branch is naturally unreachable on desktop/tablet.
    const dayDots = target.closest('.day-dots');
    if (dayDots) {
      const dotsCell = dayDots.closest('.calendar-cell') as HTMLElement | null;
      if (dotsCell) toggleDayExpand(dotsCell);
      return;
    }

    // Empty space inside a day cell (not on a specific event) — admins only.
    const cell = target.closest('.calendar-cell');
    if (cell && shared.adminModeActive) {
      const dateKey = (cell as HTMLElement).dataset.date;
      if (dateKey) shared.openAddForDay?.(dateKey);
    }
  });

  // Banners are div[role=button]s (the tooltip inside them can't live in a
  // real <button>), so Enter and Space open them by hand, then move focus to
  // the details so keyboard and screen-reader users land on what opened.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if ((e.key !== 'Enter' && e.key !== ' ') || !target.classList?.contains('event-banner')) return;
    e.preventDefault();
    showEventDetail(JSON.parse(target.dataset.event ?? '{}'));
    document.getElementById('detail-title')?.focus();
  });
}
