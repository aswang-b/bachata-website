// The editor's buttons and toggles, and the details panel's admin buttons.
import { shared } from '../state';
import { performDelete } from './api';
import {
  colorPicker,
  descriptionInput,
  hideLessonOverviewInput,
  lessonOverviewBodyInput,
  recentColorsRow,
  recurrenceHint,
  repeatCountInput,
  repeatDayButtons,
  repeatEndRadios,
  repeatInput,
  repeatOptions,
  repeatUntilInput,
  typeButtons,
} from './dom';
import { renderColorButtons, renderRepeatDayButtons, renderTypeButtons, syncLessonOverviewFields, updateDateLockForSeriesEdit } from './fieldRender';
import { linkedEditor } from './linked';
import { cancelEditing, openModal } from './modal';
import { editor } from './state';
import { editEvent } from './tabs';

export function initEditorControls() {
  typeButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      editor.selectedType = btn.dataset.type as 'class' | 'event';
      renderTypeButtons();
      linkedEditor.render();
    })
  );

  recentColorsRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.event-color-btn');
    if (!btn?.dataset.color) return;
    editor.selectedColor = btn.dataset.color;
    renderColorButtons();
  });
  colorPicker.addEventListener('input', () => {
    editor.selectedColor = colorPicker.value.toLowerCase();
    renderColorButtons();
  });

  document.querySelectorAll<HTMLButtonElement>('.description-format-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      descriptionInput.focus();
      document.execCommand(btn.dataset.cmd!, false);
    });
  });

  hideLessonOverviewInput.addEventListener('change', syncLessonOverviewFields);

  document.querySelectorAll<HTMLButtonElement>('.lesson-overview-format-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      lessonOverviewBodyInput.focus();
      document.execCommand(btn.dataset.cmd!, false);
    });
  });

  document.getElementById('event-lesson-overview-link-btn')?.addEventListener('click', () => {
    const url = prompt('Link URL (must start with https:// or /):');
    if (!url) return;
    lessonOverviewBodyInput.focus();
    document.execCommand('createLink', false, url);
  });

  document.getElementById('event-description-link-btn')?.addEventListener('click', () => {
    const url = prompt('Link URL (must start with https:// or /):');
    if (!url) return;
    descriptionInput.focus();
    document.execCommand('createLink', false, url);
  });

  repeatInput.addEventListener('change', () => {
    repeatOptions.classList.toggle('hidden', !repeatInput.checked);
    repeatOptions.classList.toggle('flex', repeatInput.checked);
    recurrenceHint.classList.toggle('hidden', !(editor.editingId && editor.editingRecurringId));
    updateDateLockForSeriesEdit();
  });

  repeatDayButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      const day = btn.dataset.day ?? '';
      if (editor.selectedRepeatDays.has(day)) editor.selectedRepeatDays.delete(day);
      else editor.selectedRepeatDays.add(day);
      renderRepeatDayButtons();
    })
  );

  repeatEndRadios.forEach((radio) =>
    radio.addEventListener('change', () => {
      repeatCountInput.disabled = radio.value !== 'count' || !radio.checked;
      repeatUntilInput.disabled = radio.value !== 'until' || !radio.checked;
    })
  );
}

export function initEditorButtons() {
  document.getElementById('add-event-btn')?.addEventListener('click', () => openModal('add'));
  document.getElementById('event-cancel')?.addEventListener('click', cancelEditing);
  document.getElementById('event-close')?.addEventListener('click', cancelEditing);
  document.getElementById('event-delete')?.addEventListener('click', () => editor.editingId && performDelete(editor.editingId));
  document.getElementById('event-delete-series')?.addEventListener('click', () => editor.editingId && performDelete(editor.editingId, true));

  // Edits the admin copy of the event: one clicked before the admin data
  // loaded only has the public fields, and saving that would wipe its capacity.
  document.getElementById('detail-edit-btn')?.addEventListener('click', async () => {
    if (!shared.detailEvent) return;
    const id = shared.detailEvent.id;
    await editor.adminEventsReady;
    const full = editor.cachedAllEvents.find((e) => e.id === id);
    if (!full) {
      alert("This event's details haven't finished loading — reload the page and try again.");
      return;
    }
    editEvent(full);
  });
  document.getElementById('detail-delete-btn')?.addEventListener('click', () => {
    if (shared.detailEvent) performDelete(shared.detailEvent.id);
  });
  document.getElementById('detail-delete-series-btn')?.addEventListener('click', () => {
    if (shared.detailEvent) performDelete(shared.detailEvent.id, true);
  });
}
