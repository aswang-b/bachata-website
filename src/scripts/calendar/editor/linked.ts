// The editor's Linked Classes/Events section (src/lib/linkedClassesEditor.ts), wired to the editor.
import { initLinkedEditor } from '../../../lib/linkedClassesEditor';
import type { SiteEvent } from '../types';
import { withAuthHeader } from './api';
import { flyerUrlInput, updateFlyerPreview } from './flyer';
import { openNewLinked } from './modal';
import { updateEditorSummaries } from './sections';
import { editor, seriesKeyOfEvent } from './state';
import { editEvent, renderTabs, showTab, stashActiveDraft, tabsFor } from './tabs';

export let linkedEditor: ReturnType<typeof initLinkedEditor<SiteEvent>>;

export function initLinkedClasses() {
  linkedEditor = initLinkedEditor<SiteEvent>({
    events: () => editor.cachedAllEvents,
    current: () => ({ event: editor.editingEvent, pendingLinkTo: editor.pendingLinkTo, eventType: editor.selectedType }),
    authHeaders: withAuthHeader,
    // Its tab, when it has one.
    openEvent(event) {
      const i = editor.editorTabs.findIndex((t) => t.key === seriesKeyOfEvent(event));
      if (i === -1) return editEvent(event);
      if (i === editor.activeTab) return;
      stashActiveDraft();
      showTab(i);
    },
    linksChanged() {
      if (!editor.editingEvent) return;
      const key = seriesKeyOfEvent(editor.editingEvent);
      editor.editorTabs = tabsFor(editor.editingEvent, editor.editorTabs);
      editor.activeTab = Math.max(0, editor.editorTabs.findIndex((t) => t.key === key));
      renderTabs();
      updateFlyerPreview();
    },
    newLinked: openNewLinked,
    flyerShared(flyerUrl, seriesKeys) {
      const keys = new Set(seriesKeys);
      for (const e of editor.cachedAllEvents) if (keys.has(e.google_recurring_event_id ?? e.id)) e.flyer_url = flyerUrl;
      flyerUrlInput.value = flyerUrl;
      editor.pendingFlyer = flyerUrl;
      updateFlyerPreview();
      updateEditorSummaries();
    },
  });
}
