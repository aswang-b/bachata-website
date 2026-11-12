// What a Save sends: the open tab's fields as a create or update request.
import { endAfterStart } from '../../../lib/eventTimes';
import { eventZone } from '../../../lib/siteTime';
import { fromLocalDateTimeValue, fromLocalParts } from './dates';
import {
  capacityInput,
  dateInput,
  descriptionInput,
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
  registrationClosedInput,
  repeatCountInput,
  repeatEndRadios,
  repeatInput,
  repeatIntervalInput,
  repeatUntilInput,
  showCapacityInput,
  showEarlyBirdEndInput,
  showFlashSaleEndInput,
  startTimeInput,
  titleInput,
} from './dom';
import { flyerUrlInput } from './flyer';
import { editor, WEEKDAY_CODES } from './state';
import { editorZone } from './timeZone';
import { editorPlace } from './place';

export interface SaveRequest {
  endpoint: string;
  payload: Record<string, unknown>;
  historyKey: string | null;
  title: string;
}

// What the editor (its open tab) would save, or null when it can't be saved
// yet (after saying why, or with the empty field focused).
export function buildSaveRequest(): SaveRequest | null {
  if (!titleInput.value.trim() || !dateInput.value || !startTimeInput.value || !endTimeInput.value) {
    (!titleInput.value.trim() ? titleInput : dateInput).focus();
    return null;
  }
  // The typed date and times, read in the picked zone (timeZone.ts).
  const timeZone = editorZone();
  const endTimeIso = endAfterStart(dateInput.value, startTimeInput.value, endTimeInput.value, timeZone);
  if (!endTimeIso) {
    alert('The end time is the same as the start time — pick when the event ends.');
    return null;
  }

  const payload: Record<string, unknown> = {
    id: editor.editingId ?? undefined,
    title: titleInput.value.trim(),
    description: descriptionInput.innerHTML.trim(),
    location: locationInput.value.trim(),
    // The venue's city and state, while the Location still reads as when they were found (place.ts).
    ...editorPlace(locationInput.value),
    priceWholeSeries: priceWholeSeriesInput.value.trim(),
    priceDropIn: priceDropInInput.value.trim(),
    priceStudent: priceStudentInput.value.trim(),
    priceWholeSeriesEarlyBird: priceWholeSeriesEarlyBirdInput.value.trim(),
    priceDropInEarlyBird: priceDropInEarlyBirdInput.value.trim(),
    priceStudentEarlyBird: priceStudentEarlyBirdInput.value.trim(),
    earlyBirdUntil: fromLocalDateTimeValue(earlyBirdUntilInput.value),
    priceWholeSeriesFlashSale: priceWholeSeriesFlashSaleInput.value.trim(),
    priceDropInFlashSale: priceDropInFlashSaleInput.value.trim(),
    priceStudentFlashSale: priceStudentFlashSaleInput.value.trim(),
    flashSaleUntil: fromLocalDateTimeValue(flashSaleUntilInput.value),
    showEarlyBirdEnd: showEarlyBirdEndInput.checked,
    showFlashSaleEnd: showFlashSaleEndInput.checked,
    registrationClosed: registrationClosedInput.checked,
    lessonOverviewTitle: lessonOverviewTitleInput.value.trim(),
    lessonOverviewBody: lessonOverviewBodyInput.innerHTML.trim(),
    hideLessonOverview: hideLessonOverviewInput.checked,
    imageUrl: imageUrlInput.value.trim(),
    flyerUrl: flyerUrlInput.value.trim(),
    eventType: editor.selectedType,
    capacity: capacityInput.value.trim(),
    showCapacity: showCapacityInput.checked,
    capacityByRole: editor.capacityByRole && editor.selectedType === 'class',
    leaderCapacity: leaderCapacityInput.value.trim(),
    followerCapacity: followerCapacityInput.value.trim(),
    color: editor.selectedColor,
    visibility: privateInput.checked ? 'private' : 'public',
    startTime: fromLocalParts(dateInput.value, startTimeInput.value, timeZone),
    endTime: endTimeIso,
    timeZone,
  };

  if (editor.selectedType === 'event') {
    // Only the ticket price (and its tiers) applies to an event.
    for (const field of ['priceDropIn', 'priceStudent', 'priceDropInEarlyBird', 'priceStudentEarlyBird', 'priceDropInFlashSale', 'priceStudentFlashSale']) {
      payload[field] = '';
    }
  }

  if (!editor.editingId && repeatInput.checked) {
    if (editor.selectedRepeatDays.size === 0) {
      alert('Pick at least one day of the week for the recurrence.');
      return null;
    }
    const endType = repeatEndRadios.find((r) => r.checked)?.value === 'until' ? 'until' : 'count';
    if (endType === 'until' && !repeatUntilInput.value) {
      alert('Pick an end date for the recurrence.');
      return null;
    }
    payload.recurrence = {
      byDay: WEEKDAY_CODES.filter((d) => editor.selectedRepeatDays.has(d)),
      interval: Number(repeatIntervalInput.value) || 1,
      endType,
      count: endType === 'count' ? Number(repeatCountInput.value) || 4 : undefined,
      until: endType === 'until' ? repeatUntilInput.value : undefined,
    };
  }

  if (editor.editingId && editor.editingRecurringId && repeatInput.checked) {
    payload.applyToSeries = true;

    const currentByDay = WEEKDAY_CODES.filter((d) => editor.selectedRepeatDays.has(d));
    const endType = repeatEndRadios.find((r) => r.checked)?.value === 'until' ? 'until' : 'count';
    const currentCount = Number(repeatCountInput.value) || 4;
    const currentInterval = Number(repeatIntervalInput.value) || 1;

    const patternChanged =
      endType === 'until' ||
      JSON.stringify([...currentByDay].sort()) !== JSON.stringify([...(editor.originalPattern?.byDay ?? [])].sort()) ||
      currentCount !== editor.originalPattern?.count ||
      currentInterval !== editor.originalPattern?.interval ||
      // A new zone moves every class of the series, which only a rebuild does.
      (editor.editingEvent != null && timeZone !== eventZone(editor.editingEvent));

    if (patternChanged) {
      if (endType === 'until' && !repeatUntilInput.value) {
        alert('Pick an end date for the recurrence.');
        return null;
      }
      payload.rebuildSeries = true;
      payload.recurrence = {
        byDay: currentByDay,
        interval: currentInterval,
        endType,
        count: endType === 'count' ? currentCount : undefined,
        until: endType === 'until' ? repeatUntilInput.value : undefined,
      };
    }
  }

  if (!editor.editingId && editor.pendingLinkTo) payload.linkTo = editor.pendingLinkTo;

  return {
    endpoint: editor.editingId ? '/api/admin/update-event' : '/api/admin/create-event',
    payload,
    historyKey: editor.editingEvent ? `event:${editor.editingEvent.google_recurring_event_id ?? editor.editingEvent.id}` : null,
    title: titleInput.value.trim(),
  };
}
