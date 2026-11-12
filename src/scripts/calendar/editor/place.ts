// The city and state of the class's venue (events.city/state, migration 0077),
// kept beside the Location field: there is no field for them. A Google Places
// pick fills them in; they belong to the location text they were found for, so
// typing a different location by hand (or any change in the plain-text
// fallback) drops them.
import { cleanPlaceText } from '../../../lib/siteLocation';
import { editor } from './state';

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

const CITY_TYPES = ['locality', 'postal_town', 'sublocality', 'administrative_area_level_3'];

// The city (locality, else postal town, else sublocality, else level 3) and the
// state (level 1, short name: "NM") of a Places result's address components.
export function placeCityState(components: AddressComponent[] | null | undefined): { city: string | null; state: string | null } {
  const list = components ?? [];
  const find = (type: string) => list.find((c) => c.types?.includes(type));
  const cityPart = CITY_TYPES.map(find).find(Boolean);
  const city = cleanPlaceText(cityPart?.long_name);
  return { city, state: city ? cleanPlaceText(find('administrative_area_level_1')?.short_name) : null };
}

// A class opened in the editor, or a place picked: the city and state that go with `text`.
export function setEditorPlace(city: string | null | undefined, state: string | null | undefined, text: string) {
  editor.place = { city: city ?? null, state: state ?? null, forText: text.trim() };
}

// What a save sends: the kept city and state while the Location still reads as it did.
export function editorPlace(locationText: string): { city: string | null; state: string | null } {
  const same = editor.place.forText === locationText.trim();
  return same && editor.place.city ? { city: editor.place.city, state: editor.place.state } : { city: null, state: null };
}
