// The editor's section menu, each section's one-line summary, the status chips and the series banner.
import { siteFormatter, zonedToInstant, zoneSuffix } from '../../../lib/siteTime';
import { editorZone } from './timeZone';
import type { SiteEvent } from '../types';
import {
  capacityInput,
  dateInput,
  earlyBirdUntilInput,
  endTimeInput,
  flashSaleUntilInput,
  followerCapacityInput,
  hideLessonOverviewInput,
  imageUrlInput,
  leaderCapacityInput,
  lessonOverviewBodyInput,
  lessonOverviewTitleInput,
  locationInput,
  modal,
  modalHeading,
  priceDropInEarlyBirdInput,
  priceDropInFlashSaleInput,
  priceDropInInput,
  priceWholeSeriesEarlyBirdInput,
  priceWholeSeriesFlashSaleInput,
  priceWholeSeriesInput,
  privateInput,
  registrationClosedInput,
  repeatInput,
  startTimeInput,
} from './dom';
import { flyerUrlInput } from './flyer';
import { linkedEditor } from './linked';
import { editor } from './state';
import { renderTabs } from './tabs';

// ---- Editor sections: the section menu, summaries and status ----
// The menu is a list on wide screens and a sideways-scrolling chip row on
// phones. Picking a section opens it and scrolls it into view; scrolling by
// hand highlights the section at the top.
const modalScroll = document.getElementById('event-modal-scroll')!;
const sectionNavButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.event-nav-btn'));
const editorSections = Array.from(document.querySelectorAll<HTMLDetailsElement>('.event-section'));
const statusChips = document.getElementById('event-status-chips')!;
const seriesBanner = document.getElementById('event-series-banner')!;
const wideEditor = window.matchMedia('(min-width: 768px)');
let activeSection = 'schedule';
let sectionJumpUntil = 0;

function setActiveSection(id: string, centerChip = true) {
  activeSection = id;
  for (const btn of sectionNavButtons) {
    const on = btn.dataset.section === id;
    btn.setAttribute('aria-current', on ? 'true' : 'false');
    if (on && centerChip && !wideEditor.matches) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function jumpToSection(id: string) {
  const section = document.getElementById(`sec-${id}`) as HTMLDetailsElement | null;
  if (!section) return;
  section.open = true;
  // Don't let the scroll-spy flicker through the sections passed on the way.
  sectionJumpUntil = Date.now() + 800;
  setActiveSection(id);
  modalScroll.scrollTo({ top: Math.max(0, section.offsetTop - 12), behavior: 'smooth' });
}

export function initSectionNav() {
  sectionNavButtons.forEach((btn) => btn.addEventListener('click', () => jumpToSection(btn.dataset.section ?? 'schedule')));

  modalScroll.addEventListener('scroll', () => {
    if (Date.now() < sectionJumpUntil) return;
    let current = editorSections[0]?.id.replace('sec-', '') ?? 'schedule';
    for (const section of editorSections) {
      if (section.offsetTop - 40 <= modalScroll.scrollTop) current = section.id.replace('sec-', '');
    }
    if (current !== activeSection) setActiveSection(current);
  });
}

// In the editor's picked zone (timeZone.ts), named when it isn't on the site's clock.
const formatTimeOfDay = (date: string, time: string) =>
  date && time ? siteFormatter({ hour: 'numeric', minute: '2-digit' }, 'en-US', editorZone()).format(zonedToInstant(date, time, editorZone())) : '';
const zoneNote = (date: string, time: string) => (date && time ? zoneSuffix(zonedToInstant(date, time, editorZone()), editorZone()) : '');
const dollars = (v: string) => (v.trim() ? `$${v.trim()}` : '');

// The one-line summary each section shows in the menu (and under its
// title on phones), so a closed section still says what's in it.
export function updateEditorSummaries() {
  const isEvent = editor.selectedType === 'event';
  const date = dateInput.value
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateInput.value}T12:00:00Z`))
    : 'No date';
  const byRole = !isEvent && editor.capacityByRole;
  const capacityText = byRole
    ? `${leaderCapacityInput.value || '∞'} leaders / ${followerCapacityInput.value || '∞'} followers`
    : capacityInput.value
      ? `${capacityInput.value} spots`
      : 'No limit';
  const earlyBird = (priceWholeSeriesEarlyBirdInput.value || priceDropInEarlyBirdInput.value) && earlyBirdUntilInput.value;
  const flashSale = (priceWholeSeriesFlashSaleInput.value || priceDropInFlashSaleInput.value) && flashSaleUntilInput.value;
  const prices = [
    dollars(priceWholeSeriesInput.value) && `${dollars(priceWholeSeriesInput.value)} ${isEvent ? 'ticket' : 'series'}`,
    !isEvent && dollars(priceDropInInput.value) && `${dollars(priceDropInInput.value)} drop-in`,
    earlyBird && 'early bird',
    flashSale && 'flash sale',
  ].filter(Boolean);
  const overviewSet = lessonOverviewTitleInput.value.trim() || lessonOverviewBodyInput.textContent?.trim();
  const summaries: Record<string, string> = {
    schedule: [date, `${formatTimeOfDay(dateInput.value, startTimeInput.value)}–${formatTimeOfDay(dateInput.value, endTimeInput.value)}${zoneNote(dateInput.value, startTimeInput.value)}`, repeatInput.checked ? 'repeats' : '']
      .filter(Boolean)
      .join(' · '),
    details: locationInput.value.trim() || 'No location yet',
    registration: [registrationClosedInput.checked ? 'Closed' : 'Open', privateInput.checked ? 'Private' : '', capacityText].filter(Boolean).join(' · '),
    pricing: prices.length ? prices.join(' · ') : isEvent ? 'Free' : 'No prices',
    homepage: [imageUrlInput.value ? 'Image set' : 'No image', ...(flyerUrlInput.value ? ['flyer set'] : []), hideLessonOverviewInput.checked ? 'overview hidden' : overviewSet ? 'custom overview' : 'default overview'].join(' · '),
    linked: linkedEditor.summary(),
  };
  document.querySelectorAll<HTMLElement>('#event-modal [data-summary]').forEach((el) => {
    el.textContent = summaries[el.dataset.summary ?? ''] ?? '';
  });

  const chip = (text: string, on: boolean) =>
    `<span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${on ? 'bg-green-500/15 text-green-300' : 'bg-border text-ink/70'}">${text}</span>`;
  statusChips.innerHTML = chip(privateInput.checked ? 'Private' : 'Public', !privateInput.checked) + chip(registrationClosedInput.checked ? 'Closed' : 'Open', !registrationClosedInput.checked);
}

// Editing one class of a series with Repeats on changes every class in it
// (each keeps its own date and time); say so up front.
export function updateSeriesBanner() {
  const siblingCount = editor.editingRecurringId ? editor.cachedAllEvents.filter((e) => e.google_recurring_event_id === editor.editingRecurringId).length : 0;
  const show = Boolean(editor.editingId && editor.editingRecurringId);
  seriesBanner.classList.toggle('hidden', !show);
  if (!show) return;
  seriesBanner.textContent = repeatInput.checked
    ? `Part of a ${siblingCount}-class series: changes here apply to all ${siblingCount} classes (each keeps its own date and time). Turn off Repeats under Schedule to edit only this one.`
    : 'Editing only this class of the series.';
}

export function initSummaryUpdates() {
  ['input', 'change', 'click'].forEach((type) =>
    modal.addEventListener(type, () => {
      updateEditorSummaries();
      updateSeriesBanner();
      // The open tab's unsaved-changes dot.
      if (editor.editorTabs.length > 1) renderTabs();
    })
  );
}

export function prepareEditorSections(mode: 'add' | 'edit', event?: SiteEvent) {
  // Wide screens show every section open; phones start with all closed so
  // the menu and summaries give the overview.
  editorSections.forEach((section) => (section.open = wideEditor.matches));
  setActiveSection('schedule', false);
  document.getElementById('event-section-nav')!.scrollLeft = 0;
  const typeLabel = editor.selectedType === 'event' ? 'event' : 'class';
  const total = editor.editingRecurringId ? editor.cachedAllEvents.filter((e) => e.google_recurring_event_id === editor.editingRecurringId).length : 0;
  modalHeading.textContent =
    mode === 'add' ? 'New event' : event?.weekNumber && total > 1 ? `Edit ${typeLabel} · Week ${event.weekNumber} of ${total}` : `Edit ${typeLabel}`;
  linkedEditor.render();
  updateEditorSummaries();
  updateSeriesBanner();
}
