// Save and Save all, one at a time, and what follows them (dialogs, reload).
import { showErrorDialog } from '../../../lib/errorDialog';
import { rememberBeforeSave } from '../../../lib/richTextHistory';
import { hideSync, showSync, withAuthHeader } from './api';
import { descriptionInput, lessonOverviewBodyInput } from './dom';
import { closeModal } from './modal';
import { buildSaveRequest, type SaveRequest } from './saveRequest';
import { editor } from './state';
import { followRebuild, refreshAdminEvents, showTab, stashActiveDraft } from './tabs';

export type SaveResponse = { calendarSyncSkipped?: boolean; calendarSyncError?: string; linkError?: string | null; error?: string; seriesKey?: string };

// Sends one save. On success the rich-text boxes (still showing what was
// saved) remember what it replaced, so reopening offers Undo back to it.
async function sendSave(req: SaveRequest, headers: Record<string, string>): Promise<{ ok: boolean; status: number; data: SaveResponse }> {
  const res = await fetch(req.endpoint, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(req.payload),
  });
  const data: SaveResponse = await res.json().catch(() => ({}));
  if (res.ok && req.historyKey) {
    rememberBeforeSave(descriptionInput, `${req.historyKey}:description`);
    rememberBeforeSave(lessonOverviewBodyInput, `${req.historyKey}:overview`);
  }
  return { ok: res.ok, status: res.status, data };
}

const syncFailedDialog = (saved: { title: string; data: SaveResponse }[]) =>
  showErrorDialog(
    'Saved, but Google Calendar sync failed',
    'The change is saved on the site. Google Calendar did not accept it; the next scheduled sync will retry.',
    saved.map((r) => (saved.length > 1 ? `${r.title}: ` : '') + (r.data.calendarSyncError ?? 'No Google connection was available for this save.')).join('\n')
  );

// After the editor's saves: the dialogs they need, then a reload to show what's saved.
async function finishSaves(saved: { title: string; data: SaveResponse }[]) {
  for (const r of saved.filter((s) => s.data.linkError)) {
    hideSync();
    await showErrorDialog('Saved, but not linked', "The new class is saved, but it couldn't be linked. Link it from its Linked Classes/Events section.", r.data.linkError!);
  }
  const skipped = saved.filter((s) => s.data.calendarSyncSkipped);
  if (skipped.length > 0) {
    hideSync();
    await syncFailedDialog(skipped);
    window.location.reload();
    return;
  }
  showSync('Synced!', true);
  setTimeout(() => window.location.reload(), 900);
}

// Save: just the open tab. While other tabs have unsaved changes the editor
// stays open for them; otherwise it closes and the page reloads.
// One save at a time: another click while one runs (and the editor reloads
// after it) does nothing, so a quick second Save can't go to a class the
// first one replaced.
const oneSaveAtATime = (run: () => Promise<void>) => async () => {
  if (editor.saving) return;
  editor.saving = true;
  try {
    await run();
  } finally {
    editor.saving = false;
  }
};

export function initSaveButtons() {
  document.getElementById('event-save')?.addEventListener('click', oneSaveAtATime(async () => {
    const headers = await withAuthHeader();
    if (!headers) return;
    const req = buildSaveRequest();
    if (!req) return;
    if (!editor.editorTabs.some((t, i) => i !== editor.activeTab && t.draft)) {
      closeModal();
      showSync('Syncing to Google Calendar…', false);
      const result = await sendSave(req, headers);
      if (!result.ok) {
        hideSync();
        await showErrorDialog('Save failed', `The server returned ${result.status}.`, result.data.error ?? 'unknown error');
        return;
      }
      await finishSaves([{ title: req.title, data: result.data }]);
      return;
    }
    // Shown until the editor has reloaded what's saved.
    showSync('Saving…', false);
    const result = await sendSave(req, headers);
    if (!result.ok) {
      hideSync();
      await showErrorDialog('Save failed', `The server returned ${result.status}.`, result.data.error ?? 'unknown error');
      return;
    }
    if (result.data.calendarSyncSkipped) await syncFailedDialog([{ title: req.title, data: result.data }]);
    followRebuild(editor.activeTab, result.data);
    await refreshAdminEvents(headers);
    // This tab starts over from what's now saved; the others keep their changes.
    editor.editorTabs[editor.activeTab].draft = null;
    showTab(editor.activeTab);
    showSync('Saved', true);
  }));

  // Save all: every tab with changes, one after another. One that can't be
  // saved stops there, on its tab, with the ones before it saved.
  document.getElementById('event-save-all')?.addEventListener('click', oneSaveAtATime(async () => {
    const headers = await withAuthHeader();
    if (!headers) return;
    stashActiveDraft();
    const pending = editor.editorTabs.flatMap((t, i) => (t.draft ? [i] : []));
    const saved: { title: string; data: SaveResponse }[] = [];
    for (const i of pending) {
      showTab(i);
      const req = buildSaveRequest();
      if (!req) {
        hideSync();
        if (saved.length > 0) await afterPartialSave(headers);
        return;
      }
      showSync(`Saving ${req.title}…`, false);
      const result = await sendSave(req, headers);
      if (!result.ok) {
        hideSync();
        await showErrorDialog(`Couldn't save ${req.title}`, `The server returned ${result.status}.`, result.data.error ?? 'unknown error');
        if (saved.length > 0) await afterPartialSave(headers);
        return;
      }
      editor.editorTabs[i].draft = null;
      followRebuild(i, result.data);
      saved.push({ title: req.title, data: result.data });
    }
    closeModal();
    if (saved.length > 0) await finishSaves(saved);
  }));
}

// Some tabs saved before one couldn't be: they show what's now saved, and
// the open tab keeps what's being fixed.
async function afterPartialSave(headers: Record<string, string>) {
  stashActiveDraft();
  await refreshAdminEvents(headers);
  showTab(editor.activeTab);
}
