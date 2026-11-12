// The event editor's state, in one object every editor module reads and sets
// (a module can't assign another module's `let`).
import type { FieldValues } from '../../../lib/editorDrafts';
import type { SiteEvent } from '../types';

export interface PlaceState {
  city: string | null;
  state: string | null;
  // The Location text they were found for.
  forText: string;
}

// A tab of the editor (tabs.ts) and the changes it keeps while another is open.
export interface EditorDraft {
  fields: FieldValues;
  type: 'class' | 'event';
  color: string;
  capacityByRole: boolean;
  repeatDays: string[];
  // The venue's city and state (place.ts) go with the Location text in the draft.
  place: PlaceState;
}
export interface EditorTab {
  key: string;
  event: SiteEvent;
  draft: EditorDraft | null;
}

export const editor = {
  selectedType: 'class' as 'class' | 'event',
  selectedColor: 'green' as string,
  editingId: null as string | null,
  selectedRepeatDays: new Set<string>(),
  cachedAllEvents: [] as SiteEvent[],
  // Settles once the admin copy of the events (with capacities, which the
  // public page leaves out) has loaded.
  adminEventsReady: Promise.resolve() as Promise<void>,
  editingRecurringId: null as string | null,
  originalPattern: null as { byDay: string[]; count: number; interval: number } | null,
  // The occurrence open in the editor (null while adding), and for a "New
  // linked class" copy, the series it gets linked to when saved.
  editingEvent: null as SiteEvent | null,
  pendingLinkTo: null as string | null,
  // The open class's venue city and state (place.ts); no field of their own.
  place: { city: null, state: null, forText: '' } as PlaceState,
  capacityByRole: false,
  // A flyer picked or removed while the editor is open (undefined: untouched).
  // Linked classes have one flyer, so every tab shows it, and whichever tab
  // saves first puts it on all of them (never a tab's older draft).
  pendingFlyer: undefined as string | undefined,
  editorTabs: [] as EditorTab[],
  activeTab: 0,
  // The open tab as saved, to tell whether it has changes.
  pristine: '',
  // A save is running (see oneSaveAtATime in save.ts).
  saving: false,
};

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const seriesKeyOfEvent = (e: SiteEvent) => e.google_recurring_event_id ?? e.id;
