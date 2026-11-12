// Opening and closing the editor on a class or event (or a new one).
import { DEFAULT_QUICK_COLORS, recentEventColors } from '../../../lib/eventColors';
import { offerPrevious } from '../../../lib/richTextHistory';
import { eventZone, zonedDateKey, zonedParts } from '../../../lib/siteTime';
import { shared } from '../state';
import type { SiteEvent } from '../types';
import { toLocalDateTimeValue, toLocalParts } from './dates';
import {
  capacityInput,
  dateInput,
  deleteBtn,
  deleteSeriesBtn,
  descriptionInput,
  earlyBirdUntilInput,
  endTimeInput,
  flashSaleUntilInput,
  followerCapacityInput,
  hideLessonOverviewInput,
  imageError,
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
  priceStudentEarlyBirdInput,
  priceStudentFlashSaleInput,
  priceStudentInput,
  priceWholeSeriesEarlyBirdInput,
  priceWholeSeriesFlashSaleInput,
  priceWholeSeriesInput,
  privateInput,
  recurrenceHint,
  recurrenceRow,
  registrationClosedInput,
  repeatCountInput,
  repeatEndRadios,
  repeatInput,
  repeatIntervalInput,
  repeatOptions,
  repeatUntilInput,
  showCapacityInput,
  showEarlyBirdEndInput,
  showFlashSaleEndInput,
  startTimeInput,
  titleInput,
} from './dom';
import { renderColorButtons, renderRepeatDayButtons, renderTypeButtons, syncLessonOverviewFields, updateDateLockForSeriesEdit } from './fieldRender';
import { flyerError, flyerUrlInput, updateFlyerPreview } from './flyer';
import { updateImagePreview } from './images';
import { linkedEditor } from './linked';
import { initLocationAutocomplete } from './places';
import { setEditorPlace } from './place';
import { prepareEditorSections, updateEditorSummaries } from './sections';
import { editor, WEEKDAY_CODES } from './state';
import { hasUnsaved, renderTabs } from './tabs';
import { setEditorZone } from './timeZone';

export function openModal(mode: 'add' | 'edit', event?: SiteEvent, presetDate?: string) {
  editor.editingId = event?.id || null;
  editor.editingRecurringId = event?.google_recurring_event_id ?? null;
  editor.editingEvent = mode === 'edit' ? event ?? null : null;
  editor.pendingLinkTo = null;
  // A new class has no tabs (editEvent sets them up for a linked one).
  if (mode === 'add') {
    editor.editorTabs = [];
    renderTabs();
  }
  modalHeading.textContent = mode === 'add' ? 'Add Event' : 'Edit Event';
  titleInput.value = event?.title ?? '';
  descriptionInput.innerHTML = event?.description ?? '';
  locationInput.value = event?.location ?? '';
  setEditorPlace(event?.city, event?.state, locationInput.value);
  priceWholeSeriesInput.value = event?.price_whole_series != null ? String(event.price_whole_series) : '';
  priceDropInInput.value = event?.price_drop_in != null ? String(event.price_drop_in) : '';
  priceStudentInput.value = event?.price_student != null ? String(event.price_student) : '';
  priceWholeSeriesEarlyBirdInput.value = event?.price_whole_series_early_bird != null ? String(event.price_whole_series_early_bird) : '';
  priceDropInEarlyBirdInput.value = event?.price_drop_in_early_bird != null ? String(event.price_drop_in_early_bird) : '';
  priceStudentEarlyBirdInput.value = event?.price_student_early_bird != null ? String(event.price_student_early_bird) : '';
  earlyBirdUntilInput.value = toLocalDateTimeValue(event?.early_bird_until);
  priceWholeSeriesFlashSaleInput.value = event?.price_whole_series_flash_sale != null ? String(event.price_whole_series_flash_sale) : '';
  priceDropInFlashSaleInput.value = event?.price_drop_in_flash_sale != null ? String(event.price_drop_in_flash_sale) : '';
  priceStudentFlashSaleInput.value = event?.price_student_flash_sale != null ? String(event.price_student_flash_sale) : '';
  flashSaleUntilInput.value = toLocalDateTimeValue(event?.flash_sale_until);
  showEarlyBirdEndInput.checked = event?.show_early_bird_end ?? true;
  showFlashSaleEndInput.checked = event?.show_flash_sale_end ?? true;
  registrationClosedInput.checked = event?.registration_closed ?? false;
  lessonOverviewTitleInput.value = event?.lesson_overview_title ?? '';
  lessonOverviewBodyInput.innerHTML = event?.lesson_overview_body ?? '';
  hideLessonOverviewInput.checked = event?.hide_lesson_overview ?? false;
  // Each box's Undo starts here, or at what the last save here replaced.
  const historyKey = `event:${mode === 'edit' && event ? event.google_recurring_event_id ?? event.id : 'new'}`;
  offerPrevious(descriptionInput, `${historyKey}:description`);
  offerPrevious(lessonOverviewBodyInput, `${historyKey}:overview`);
  syncLessonOverviewFields();
  imageUrlInput.value = event?.image_url ?? '';
  imageError.classList.add('hidden');
  updateImagePreview();
  flyerUrlInput.value = event?.flyer_url ?? '';
  flyerError.classList.add('hidden');
  updateFlyerPreview();
  editor.selectedType = event?.event_type === 'event' ? 'event' : 'class';
  // A new event starts with the most recently used color.
  editor.selectedColor = event?.color ?? (editor.cachedAllEvents.length > 0 ? recentEventColors(editor.cachedAllEvents)[0] : DEFAULT_QUICK_COLORS[0]);
  privateInput.checked = event?.visibility === 'private';
  capacityInput.value = event?.capacity != null ? String(event.capacity) : '';
  showCapacityInput.checked = event?.show_capacity ?? false;
  leaderCapacityInput.value = event?.leader_capacity != null ? String(event.leader_capacity) : '';
  followerCapacityInput.value = event?.follower_capacity != null ? String(event.follower_capacity) : '';
  editor.capacityByRole = event?.capacity_by_role ?? false;

  const isSeriesOccurrence = mode === 'edit' && Boolean(editor.editingRecurringId);
  recurrenceRow.classList.toggle('hidden', !(mode === 'add' || isSeriesOccurrence));

  repeatOptions.classList.add('hidden');
  repeatOptions.classList.remove('flex');
  repeatIntervalInput.value = '1';
  repeatCountInput.value = '4';
  repeatUntilInput.disabled = true;
  repeatCountInput.disabled = false;
  repeatEndRadios.forEach((r) => (r.checked = r.value === 'count'));
  recurrenceHint.classList.add('hidden');
  editor.originalPattern = null;

  if (isSeriesOccurrence && event) {
    const weekday = WEEKDAY_CODES[zonedParts(event.start_time, eventZone(event)).weekday];
    editor.selectedRepeatDays = new Set([weekday]);
    const siblingCount = editor.cachedAllEvents.filter((e) => e.google_recurring_event_id === editor.editingRecurringId).length || 1;
    repeatCountInput.value = String(siblingCount);
    // Existing series data doesn't track a stored interval, so default to 1 (weekly).
    repeatIntervalInput.value = '1';
    editor.originalPattern = { byDay: [weekday], count: siblingCount, interval: 1 };

    repeatInput.checked = true;
    repeatOptions.classList.remove('hidden');
    repeatOptions.classList.add('flex');
    recurrenceHint.textContent = "This class is part of a series. Turn off Repeats to edit just this one instead of the whole series.";
    recurrenceHint.classList.remove('hidden');
  } else {
    repeatInput.checked = false;
  }

  // Its own zone (a new class: the site's; a linked copy: its source's).
  setEditorZone(event?.time_zone);
  if (event) {
    const start = toLocalParts(event.start_time, eventZone(event));
    const end = toLocalParts(event.end_time, eventZone(event));
    dateInput.value = start.date;
    startTimeInput.value = start.time;
    endTimeInput.value = end.time;
    if (!isSeriesOccurrence) {
      editor.selectedRepeatDays = new Set([WEEKDAY_CODES[zonedParts(event.start_time, eventZone(event)).weekday]]);
    }
  } else {
    // Today in the site's time zone; a "YYYY-MM-DD" day's weekday is plain calendar math.
    dateInput.value = presetDate ?? zonedDateKey(new Date());
    const targetDate = new Date(`${dateInput.value}T12:00:00Z`);
    startTimeInput.value = '18:00';
    endTimeInput.value = '19:00';
    editor.selectedRepeatDays = new Set([WEEKDAY_CODES[targetDate.getUTCDay()]]);
  }
  renderRepeatDayButtons();
  updateDateLockForSeriesEdit();

  deleteBtn.classList.toggle('hidden', mode === 'add');
  deleteSeriesBtn.classList.toggle('hidden', mode === 'add' || !editor.editingRecurringId);
  const notifyLink = document.getElementById('event-notify') as HTMLAnchorElement;
  notifyLink.classList.toggle('hidden', mode === 'add' || event?.visibility === 'private');
  if (event) notifyLink.href = `/admin/notifications?event=${encodeURIComponent(event.id)}`;
  renderTypeButtons();
  renderColorButtons();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('event-modal-scroll')!.scrollTop = 0;
  prepareEditorSections(mode, event);

  // Deferred until the modal (and its location input) is actually visible —
  // Google's Autocomplete widget measures the input's width when it's
  // constructed, and gets it wrong (an invisible, zero-width dropdown) if
  // that happens while the input is still display:none.
  if (shared.adminModeActive) initLocationAutocomplete();
}

export function closeModal() {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  editor.editingId = null;
  editor.editingEvent = null;
  editor.pendingLinkTo = null;
  editor.editorTabs = [];
  renderTabs();
}

// Cancel or close: asks first when a tab has changes that would be lost.
export function cancelEditing() {
  if (hasUnsaved() && !confirm('Discard your unsaved changes?')) return;
  closeModal();
}

// "New linked class": a copy of `source` with a blank title and
// description, starting at its series' next class with the same pattern,
// linked to it when saved.
export function openNewLinked(source: SiteEvent) {
  const key = source.google_recurring_event_id ?? source.id;
  const occurrences = editor.cachedAllEvents.filter((e) => (e.google_recurring_event_id ?? e.id) === key).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const start = occurrences.find((o) => Date.parse(o.start_time) >= Date.now()) ?? source;
  const remaining = occurrences.filter((o) => o.start_time >= start.start_time);
  openModal('add', { ...start, id: '', title: '', description: null, google_recurring_event_id: null });
  editor.pendingLinkTo = key;
  if (source.google_recurring_event_id && remaining.length > 1) {
    repeatInput.checked = true;
    repeatOptions.classList.remove('hidden');
    repeatOptions.classList.add('flex');
    editor.selectedRepeatDays = new Set(remaining.map((o) => WEEKDAY_CODES[zonedParts(o.start_time, eventZone(o)).weekday]));
    repeatCountInput.value = String(remaining.length);
    renderRepeatDayButtons();
  }
  modalHeading.textContent = `New linked ${editor.selectedType}`;
  updateEditorSummaries();
  linkedEditor.render();
  titleInput.focus();
}
