// The admin side of the calendar: the event editor, loaded by adminGate.ts
// only once the page finds an admin session. startAdminEditor wires every
// editor control (in the order the page always registered them) before any
// admin control is shown.
import type { Session } from '@supabase/supabase-js';
import { installRichTextHistory } from '../../../lib/richTextHistory';
import { installRichTextShortcuts } from '../../../lib/richTextShortcuts';
import { rerenderWithMergedEvents } from '../monthGrid';
import { shared } from '../state';
import { initEditorButtons, initEditorControls } from './controls';
import { initCapacityToggle } from './fieldRender';
import { initFlyerUpload } from './flyer';
import { initImageUpload } from './images';
import { initLinkedClasses, linkedEditor } from './linked';
import { openModal } from './modal';
import { initSaveButtons } from './save';
import { initSectionNav, initSummaryUpdates } from './sections';
import { editor } from './state';
import { initShareFlyer } from './shareFlyer';
import { initTabs } from './tabs';
import { initTimeZonePicker } from './timeZone';

export function startAdminEditor() {
  installRichTextShortcuts();
  installRichTextHistory();
  initLinkedClasses();
  initCapacityToggle();
  initSectionNav();
  initSummaryUpdates();
  initTimeZonePicker();
  initShareFlyer();
  initImageUpload();
  initFlyerUpload();
  initEditorControls();
  initEditorButtons();
  initSaveButtons();
  initTabs();
  shared.openAddForDay = (dateKey) => openModal('add', undefined, dateKey);
}

export async function revealAdminControls(session: Session) {
  shared.adminModeActive = true;
  document.getElementById('add-event-btn')?.classList.remove('hidden');

  editor.adminEventsReady = (async () => {
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const [allEventsRes] = await Promise.all([fetch('/api/admin/all-events', { headers }), linkedEditor.load(headers)]);
    if (allEventsRes.ok) {
      const { events } = await allEventsRes.json();
      editor.cachedAllEvents = events;
      rerenderWithMergedEvents(events);
    }
  })().catch(() => undefined);
  await editor.adminEventsReady;
}
