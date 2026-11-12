// The month grid drawn in the browser: banners (with their hover cards), a
// phone's day of dots opened into a row, and the redraw with the admin copy of the events.
import { eventTypeLabel } from '../../lib/classSeries';
import { eventBannerStyle, eventDotStyle, eventTextStyle } from '../../lib/eventColors';
import { calendarOrder, seriesFirstOccurrences } from '../../lib/eventTimes';
import { escapeAttr, locationHref } from '../../lib/locationLink';
import { PIN_SVG } from '../../lib/locationPin';
import { eventDate, eventDayKey, eventTimeRange } from '../../lib/eventClock';
import { fitBannerLabels } from './bannerFit';
import { showEventDetail } from './detailPanel';
import { buildPriceLines, escapeHtml, spotsText } from './format';
import { keepTooltipsOutOfTabOrder } from './tooltips';
import type { SiteEvent } from './types';

function buildBannerHTML(event: SiteEvent, isCompact: boolean): string {
  const bannerClass = isCompact
    ? `truncate rounded px-1 py-0.5 text-[10px] font-semibold`
    : `event-banner-label whitespace-normal rounded-lg px-2 py-1.5 text-xs font-semibold leading-snug`;
  const weekTag = event.weekNumber
    ? `<span class="whitespace-nowrap rounded bg-white/25 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide">Wk ${event.weekNumber}</span> `
    : '';
  return `
    <div class="event-banner group relative cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" role="button" tabindex="0" data-event="${escapeAttr(JSON.stringify(event))}">
      <div class="${bannerClass}" style="${eventBannerStyle(event.color)}">${weekTag}${event.visibility === 'private' ? '🔒 ' : ''}${escapeHtml(event.title)}</div>
      <div aria-hidden="true" class="event-tooltip pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden max-h-[calc(100vh-1rem)] w-96 -translate-x-1/2 overflow-hidden rounded-2xl border-2 border-ink bg-bg p-4 text-left shadow-xl group-hover:block group-focus-visible:block">
        <p class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider" style="${eventTextStyle(event.color)}">
          <span class="h-2 w-2 rounded-full" style="${eventDotStyle(event.color)}"></span>
          ${eventTypeLabel(event.event_type, event.weekNumber)}
          ${event.weekNumber ? `<span class="font-bold text-ink">&middot; Week ${event.weekNumber}</span>` : ''}
        </p>
        <p class="mt-1 font-display font-bold text-ink">${escapeHtml(event.title)}</p>
        <p class="mt-1 text-xs text-muted">${eventDate(event)} &middot; ${eventTimeRange(event)}</p>
        ${event.description ? `<div class="tooltip-desc line-clamp-6 mt-1 text-xs text-ink/70 [&_a]:text-accent [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4">${event.description}</div><p class="tooltip-more mt-1 hidden text-[10px] font-bold uppercase tracking-wider text-accent">Click for full details</p>` : ''}
        ${buildPriceLines(event).main ? `<p class="mt-1 text-xs font-semibold text-ink">${buildPriceLines(event).main}</p>` : ''}
        ${buildPriceLines(event).student ? `<p class="text-xs font-semibold text-ink">${buildPriceLines(event).student}</p>` : ''}
        ${spotsText(event) ? `<p class="mt-1 text-xs font-bold text-accent">${spotsText(event)}</p>` : ''}
        ${
          event.location
            ? `<a href="${escapeAttr(locationHref(event.location))}" target="_blank" rel="noopener noreferrer" class="pin-link pointer-events-auto mt-1 block text-xs font-semibold text-accent" onclick="event.stopPropagation()">${PIN_SVG}<span class="underline">${escapeHtml(event.location)}</span></a>`
            : ''
        }
      </div>
    </div>`;
}

// Mobile-only: tapping a day's dot summary "opens" that day into a
// full-width row of its events (a plain sibling with col-span-7, so the
// grid's own auto-flow pushes later weeks down — no manual layout math),
// then tapping one of those opens the same detail panel desktop uses.
function closeDayExpandPanel() {
  document.querySelector('.day-expand-panel')?.remove();
  document.querySelectorAll('.calendar-cell.day-expanded').forEach((c) => c.classList.remove('day-expanded', 'ring-2', 'ring-accent'));
}

export function toggleDayExpand(cell: HTMLElement) {
  const wasOpen = cell.classList.contains('day-expanded');
  closeDayExpandPanel();
  if (wasOpen) return;

  const dayEvents = JSON.parse(cell.querySelector<HTMLElement>('.day-dots')?.dataset.events ?? '[]') as SiteEvent[];
  if (dayEvents.length === 0) return;

  cell.classList.add('day-expanded', 'ring-2', 'ring-accent');

  const panel = document.createElement('div');
  panel.className = 'day-expand-panel col-span-7 m-1 flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 sm:hidden';

  dayEvents.forEach((event) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-bg';
    item.innerHTML = `<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="${eventDotStyle(event.color)}"></span><span class="flex-1 truncate font-semibold text-ink">${escapeHtml(event.title)}</span><span class="shrink-0 text-xs text-muted">${eventTimeRange(event)}</span>`;
    item.addEventListener('click', () => {
      showEventDetail(event);
      closeDayExpandPanel();
      document.getElementById('event-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    panel.appendChild(item);
  });

  // Insert after the last cell of this day's week row (not right after
  // the tapped cell) so the panel opens as its own full-width row below
  // an intact week, instead of splitting that week's row in two with the
  // later days pushed down onto a line by themselves.
  const allCells = Array.from(document.querySelectorAll<HTMLElement>('.calendar-cell'));
  const cellIndex = allCells.indexOf(cell);
  const rowEndIndex = Math.min(Math.ceil((cellIndex + 1) / 7) * 7 - 1, allCells.length - 1);
  allCells[rowEndIndex].after(panel);
}

function computeWeekNumbers(allEvents: SiteEvent[]): Map<string, number> {
  const bySeriesKey = new Map<string, SiteEvent[]>();
  for (const e of allEvents) {
    if (!e.google_recurring_event_id) continue;
    const list = bySeriesKey.get(e.google_recurring_event_id) ?? [];
    list.push(e);
    bySeriesKey.set(e.google_recurring_event_id, list);
  }
  const weekNumberByEventId = new Map<string, number>();
  for (const occurrences of bySeriesKey.values()) {
    if (occurrences.length < 2) continue;
    occurrences
      .slice()
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .forEach((occ, idx) => weekNumberByEventId.set(occ.id, idx + 1));
  }
  return weekNumberByEventId;
}

export function rerenderWithMergedEvents(allEvents: SiteEvent[]) {
  const weekNumberByEventId = computeWeekNumbers(allEvents);
  allEvents = allEvents.slice().sort(calendarOrder(seriesFirstOccurrences(allEvents)));

  document.querySelectorAll('.calendar-cell').forEach((cell) => {
    const dateKey = (cell as HTMLElement).dataset.date;
    if (!dateKey) return;
    // The day it falls on in its own zone, as the server bucketed it (each cell's key is already in this month).
    const dayEvents = allEvents.filter((e) => eventDayKey(e) === dateKey);
    const container = cell.querySelector('.day-banners')!;
    const MAX = 3;
    const isCompact = dayEvents.length > 2;

    // Square on a phone (dots only); taller from tablet width up, where the banners show.
    cell.classList.remove('sm:min-h-[7.5rem]', 'sm:min-h-[6.5rem]');
    cell.classList.add(isCompact ? 'sm:min-h-[6.5rem]' : 'sm:min-h-[7.5rem]');

    container.innerHTML =
      dayEvents
        .slice(0, MAX)
        .map((e) => buildBannerHTML({ ...e, weekNumber: weekNumberByEventId.get(e.id) ?? null }, isCompact))
        .join('') + (dayEvents.length > MAX ? `<p class="text-[10px] font-semibold text-muted">+${dayEvents.length - MAX} more</p>` : '');

    const dotsContainer = cell.querySelector('.day-dots');
    if (dotsContainer) {
      // Rows of two up to 4 events, rows of three for 5 or 6; at most 6 dots (a tap lists them all).
      dotsContainer.classList.remove('grid-cols-2', 'grid-cols-3');
      dotsContainer.classList.add(dayEvents.length > 4 ? 'grid-cols-3' : 'grid-cols-2');
      (dotsContainer as HTMLElement).dataset.events = JSON.stringify(dayEvents.map((e) => ({ ...e, weekNumber: weekNumberByEventId.get(e.id) ?? null })));
      dotsContainer.innerHTML = dayEvents
        .slice(0, 6)
        .map((e) => `<span class="h-1.5 w-1.5 rounded-full" style="${eventDotStyle(e.color)}"></span>`)
        .join('');
    }
  });

  keepTooltipsOutOfTabOrder();
  fitBannerLabels();
}
