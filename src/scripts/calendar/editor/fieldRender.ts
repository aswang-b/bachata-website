// Redraws the editor's fields from its state: class or event (pricing columns and capacity),
// color picks, repeat days, the lesson overview and the series date lock.
import { DEFAULT_QUICK_COLORS, eventColorHex, recentEventColors } from '../../../lib/eventColors';
import {
  capacityByRoleRow,
  capacityByRoleToggle,
  capacityGeneralRow,
  capacityRolesRow,
  classOnlyPriceEls,
  colorPicker,
  dateInput,
  hideLessonOverviewInput,
  lessonOverviewFields,
  priceWholeLabel,
  recentColorsRow,
  repeatDayButtons,
  repeatInput,
  typeButtons,
} from './dom';
import { editor } from './state';

// Events have one ticket price (plus its early bird / flash sale), so the
// per-series, drop-in and student columns only show for classes.
// Swaps the general Capacity field for the Leader/Follower ones. Events
// never ask for a role, so they only get the general cap.
export function renderCapacityFields() {
  const isEvent = editor.selectedType === 'event';
  const byRole = editor.capacityByRole && !isEvent;
  capacityByRoleRow.classList.toggle('hidden', isEvent);
  capacityByRoleRow.classList.toggle('flex', !isEvent);
  capacityByRoleToggle.setAttribute('aria-checked', String(byRole));
  capacityGeneralRow.classList.toggle('hidden', byRole);
  capacityGeneralRow.classList.toggle('flex', !byRole);
  capacityRolesRow.classList.toggle('hidden', !byRole);
  capacityRolesRow.classList.toggle('flex', byRole);
}

function renderPricingForType() {
  const isEvent = editor.selectedType === 'event';
  priceWholeLabel.textContent = isEvent ? 'Ticket price' : 'Whole series';
  classOnlyPriceEls.forEach((el) => {
    el.classList.toggle('hidden', isEvent);
    if (el.tagName === 'LABEL') el.classList.toggle('flex', !isEvent);
  });
}

export function renderTypeButtons() {
  renderPricingForType();
  renderCapacityFields();
  for (const btn of typeButtons) {
    const active = btn.dataset.type === editor.selectedType;
    btn.classList.toggle('gradient-accent', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-transparent', active);
    btn.classList.toggle('text-ink/70', !active);
    btn.classList.toggle('border-border', !active);
  }
}

// The picker shows the event's color; the quick picks are the five colors
// most recently used on events (newest first), with the current one ringed.
export function renderColorButtons() {
  const current = eventColorHex(editor.selectedColor);
  colorPicker.value = current;
  const quick = editor.cachedAllEvents.length > 0 ? recentEventColors(editor.cachedAllEvents) : DEFAULT_QUICK_COLORS;
  recentColorsRow.replaceChildren(
    ...quick.map((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.color = hex;
      btn.className = 'event-color-btn h-7 w-7 rounded-full';
      btn.style.backgroundColor = hex;
      btn.setAttribute('aria-label', `Use ${hex}`);
      btn.title = hex;
      const active = hex === current;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('ring-2', active);
      btn.classList.toggle('ring-offset-2', active);
      btn.classList.toggle('ring-offset-bg', active);
      btn.classList.toggle('ring-ink', active);
      return btn;
    })
  );
}

export function renderRepeatDayButtons() {
  for (const btn of repeatDayButtons) {
    const active = editor.selectedRepeatDays.has(btn.dataset.day ?? '');
    btn.classList.toggle('gradient-accent', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-transparent', active);
    btn.classList.toggle('text-ink/70', !active);
    btn.classList.toggle('border-border', !active);
  }
}

// While the section is hidden the header/body are ignored, so dim them
// (their values are kept in case the toggle is switched back off).
export function syncLessonOverviewFields() {
  lessonOverviewFields.classList.toggle('opacity-40', hideLessonOverviewInput.checked);
}

export function updateDateLockForSeriesEdit() {
  const lockDate = Boolean(editor.editingId && editor.editingRecurringId && repeatInput.checked);
  dateInput.disabled = lockDate;
  dateInput.classList.toggle('opacity-50', lockDate);
}

export function initCapacityToggle() {
  capacityByRoleToggle.addEventListener('click', (e) => {
    e.preventDefault();
    editor.capacityByRole = !editor.capacityByRole;
    renderCapacityFields();
  });
}
