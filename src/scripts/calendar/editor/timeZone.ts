// The Schedule section's time zone: a class's date and times are typed in its
// own zone (events.time_zone, migration 0076), the site's unless "Different
// time zone" picks another. The picker shows already open on a class in
// another zone. Changing it keeps the typed date and times and reads them in
// the new zone on save (a series is rebuilt so every class moves).
import { isValidTimeZone, siteTimeZone } from '../../../lib/siteTime';

const select = document.getElementById('event-time-zone') as HTMLSelectElement;
const toggle = document.getElementById('event-time-zone-toggle') as HTMLButtonElement;
const row = document.getElementById('event-time-zone-row')!;
const hint = document.getElementById('event-time-zone-hint')!;

// The zone the editor's date and times are in.
export function editorZone(): string {
  return isValidTimeZone(select.value) ? select.value : siteTimeZone();
}

function showPicker(open: boolean) {
  row.classList.toggle('hidden', !open);
  row.classList.toggle('flex', open);
  toggle.classList.toggle('hidden', open);
}

// "Times are in Mountain time." after the picker's current value.
export function syncTimeZoneField() {
  const option = select.selectedOptions[0];
  const name = option?.dataset.name ?? editorZone();
  hint.textContent = `Times are in ${name} time. An end time before the start is the next day.`;
  if (editorZone() !== siteTimeZone()) showPicker(true);
}

// Opening the editor: the class's stored zone, or the site's for a new one.
export function setEditorZone(tz: string | null | undefined) {
  const zone = isValidTimeZone(tz) ? tz : siteTimeZone();
  if (![...select.options].some((o) => o.value === zone)) select.add(new Option(zone, zone));
  select.value = zone;
  showPicker(zone !== siteTimeZone());
  syncTimeZoneField();
}

// The section summaries follow a change through the modal's own listeners (sections.ts).
export function initTimeZonePicker() {
  toggle.addEventListener('click', () => {
    showPicker(true);
    select.focus();
  });
  select.addEventListener('change', syncTimeZoneField);
}
