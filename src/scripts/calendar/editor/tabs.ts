// The editor's tabs, one per linked class, each keeping its unsaved draft.
import { applyFields, captureFields } from '../../../lib/editorDrafts';
import { escapeHtml } from '../format';
import { rerenderWithMergedEvents } from '../monthGrid';
import type { SiteEvent } from '../types';
import { modal, modalHeading, repeatInput, repeatOptions } from './dom';
import {
  renderCapacityFields,
  renderColorButtons,
  renderRepeatDayButtons,
  renderTypeButtons,
  syncLessonOverviewFields,
  updateDateLockForSeriesEdit,
} from './fieldRender';
import { flyerUrlInput, updateFlyerPreview } from './flyer';
import { updateImagePreview } from './images';
import { linkedEditor } from './linked';
import { openModal } from './modal';
import type { SaveResponse } from './save';
import { updateEditorSummaries, updateSeriesBanner } from './sections';
import { syncTimeZoneField } from './timeZone';
import { editor, seriesKeyOfEvent, type EditorDraft, type EditorTab } from './state';

// ---- Tabs: one per linked class (src/lib/linkedClassesEditor.ts) ----
// One form serves every tab: leaving a tab keeps its changes as a draft
// (src/lib/editorDrafts.ts), which comes back on return and is what Save
// all saves. The Linked Classes/Events section saves on its own.
const tabsEl = document.getElementById('event-tabs')!;
const saveAllBtn = document.getElementById('event-save-all')!;

function snapshot(): EditorDraft {
  return { fields: captureFields(modal), type: editor.selectedType, color: editor.selectedColor, capacityByRole: editor.capacityByRole, repeatDays: [...editor.selectedRepeatDays].sort(), place: { ...editor.place } };
}

const activeHasChanges = () => editor.editorTabs.length > 0 && JSON.stringify(snapshot()) !== editor.pristine;
export const hasUnsaved = () => activeHasChanges() || editor.editorTabs.some((t, i) => i !== editor.activeTab && t.draft);

export function stashActiveDraft() {
  const tab = editor.editorTabs[editor.activeTab];
  if (tab) tab.draft = activeHasChanges() ? snapshot() : null;
}

function applyDraft(d: EditorDraft) {
  applyFields(modal, d.fields);
  syncTimeZoneField();
  editor.selectedType = d.type;
  editor.selectedColor = d.color;
  editor.capacityByRole = d.capacityByRole;
  editor.selectedRepeatDays = new Set(d.repeatDays);
  editor.place = { ...d.place };
  repeatOptions.classList.toggle('hidden', !repeatInput.checked);
  repeatOptions.classList.toggle('flex', repeatInput.checked);
  renderTypeButtons();
  renderColorButtons();
  renderRepeatDayButtons();
  renderCapacityFields();
  updateImagePreview();
  updateFlyerPreview();
  syncLessonOverviewFields();
  updateDateLockForSeriesEdit();
  updateEditorSummaries();
  updateSeriesBanner();
}

export function showTab(i: number) {
  editor.activeTab = i;
  const tab = editor.editorTabs[i];
  openModal('edit', tab.event);
  editor.pristine = JSON.stringify(snapshot());
  if (tab.draft) applyDraft(tab.draft);
  if (editor.pendingFlyer !== undefined && editor.editorTabs.length > 1) {
    flyerUrlInput.value = editor.pendingFlyer;
    updateFlyerPreview();
  }
  renderTabs();
}

// Tabs in date order (then title), for the linked set `event` is in.
export function tabsFor(event: SiteEvent, keep: EditorTab[] = []): EditorTab[] {
  const keys = linkedEditor.groupKeys(seriesKeyOfEvent(event));
  if (keys.length < 2) return [];
  const kept = new Map(keep.map((t) => [t.key, t]));
  return keys
    .flatMap((key): EditorTab[] => {
      if (kept.has(key)) return [kept.get(key)!];
      const occurrence = key === seriesKeyOfEvent(event) ? event : linkedEditor.occurrenceFor(key, event);
      return occurrence ? [{ key, event: occurrence, draft: null }] : [];
    })
    .sort((a, b) => a.event.start_time.localeCompare(b.event.start_time) || a.event.title.localeCompare(b.event.title));
}

// Opens the editor on `event`, with a tab for each class linked to it.
export function editEvent(event: SiteEvent) {
  editor.pendingFlyer = undefined;
  editor.editorTabs = tabsFor(event);
  if (editor.editorTabs.length === 0) {
    openModal('edit', event);
    renderTabs();
    return;
  }
  showTab(Math.max(0, editor.editorTabs.findIndex((t) => t.key === seriesKeyOfEvent(event))));
}

export function renderTabs() {
  const show = editor.editorTabs.length > 1;
  tabsEl.classList.toggle('hidden', !show);
  tabsEl.classList.toggle('flex', show);
  modalHeading.classList.toggle('hidden', show);
  saveAllBtn.classList.toggle('hidden', !show);
  if (!show) {
    tabsEl.replaceChildren();
    delete tabsEl.dataset.keys;
    return;
  }
  // Updated in place, not redrawn: a field losing focus as a tab is pressed
  // redraws this, and a redrawn tab would lose that click.
  const keys = editor.editorTabs.map((t) => t.key).join('|');
  if (tabsEl.dataset.keys !== keys) {
    tabsEl.dataset.keys = keys;
    tabsEl.innerHTML = editor.editorTabs
      .map(
        (t, i) => `<button type="button" role="tab" data-tab-index="${i}" class="event-tab flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-1.5 text-sm font-semibold aria-selected:border-accent aria-selected:text-ink aria-[selected=false]:border-transparent aria-[selected=false]:text-ink/60 hover:text-ink">
          <span class="truncate">${escapeHtml(t.event.title)}</span><span class="event-tab-dot hidden h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="unsaved changes"></span>
        </button>`
      )
      .join('');
  }
  tabsEl.querySelectorAll<HTMLButtonElement>('.event-tab').forEach((btn, i) => {
    btn.setAttribute('aria-selected', String(i === editor.activeTab));
    const dirty = i === editor.activeTab ? activeHasChanges() : Boolean(editor.editorTabs[i]?.draft);
    btn.querySelector('.event-tab-dot')?.classList.toggle('hidden', !dirty);
  });
  // The open tab in view when the row scrolls sideways (phones, many links).
  const open = tabsEl.querySelector<HTMLElement>('.event-tab[aria-selected="true"]');
  if (open && (open.offsetLeft < tabsEl.scrollLeft || open.offsetLeft + open.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth)) {
    tabsEl.scrollLeft = open.offsetLeft - 8;
  }
}

export function initTabs() {
  tabsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.event-tab');
    const i = Number(btn?.dataset.tabIndex);
    if (!btn || Number.isNaN(i) || i === editor.activeTab) return;
    stashActiveDraft();
    showTab(i);
  });
}

// The admin copy of the events again (after a save that keeps the editor open).
export async function refreshAdminEvents(headers: Record<string, string>) {
  const res = await fetch('/api/admin/all-events', { headers });
  if (!res.ok) return;
  const { events } = await res.json();
  editor.cachedAllEvents = events;
  rerenderWithMergedEvents(events);
  // A rebuilt series moved its links to its new key.
  await linkedEditor.load(headers);
  for (const tab of editor.editorTabs) {
    tab.event = editor.cachedAllEvents.find((e) => e.id === tab.event.id) ?? linkedEditor.occurrenceFor(tab.key, tab.event) ?? tab.event;
  }
}

// A save that rebuilt its series (a new repeat pattern) gave it new classes
// under a new key: its tab follows them, so the next save isn't of a deleted class.
export function followRebuild(i: number, data: SaveResponse) {
  if (data.seriesKey && editor.editorTabs[i]) editor.editorTabs[i].key = data.seriesKey;
}
