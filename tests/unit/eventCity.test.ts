import { describe, expect, it } from 'vitest';
import { awayCity, cleanPlaceText, DEFAULT_LOCATION, placeColumns, withAwayCity } from '../../src/lib/siteLocation';
import { venueText } from '../../src/lib/flyerBlocks';
import { editorPlace, placeCityState, setEditorPlace } from '../../src/scripts/calendar/editor/place';

// The city a class is held in (migration 0077) is named only when away from home.
const home = { city: 'Madison', state: 'WI', note: '' };

describe('awayCity', () => {
  it('is null for a class with no city, or in the home city (any case, any spacing)', () => {
    expect(awayCity({ city: null, state: null }, home)).toBeNull();
    expect(awayCity({}, home)).toBeNull();
    expect(awayCity({ city: '   ', state: 'NM' }, home)).toBeNull();
    expect(awayCity({ city: 'Madison', state: 'WI' }, home)).toBeNull();
    expect(awayCity({ city: ' madison ', state: 'wi' }, home)).toBeNull();
    expect(awayCity({ city: 'MADISON', state: null }, home)).toBeNull();
    expect(awayCity({ city: 'Madison', state: 'WI' }, DEFAULT_LOCATION)).toBeNull();
  });

  it('is the city alone for a different city', () => {
    expect(awayCity({ city: 'Santa Fe', state: 'NM' }, home)).toBe('Santa Fe');
    expect(awayCity({ city: ' Santa Fe ', state: null }, home)).toBe('Santa Fe');
  });

  it('counts the same city name in a different state as away, but only when both have a state', () => {
    expect(awayCity({ city: 'Madison', state: 'AL' }, home)).toBe('Madison');
    expect(awayCity({ city: 'Madison', state: null }, home)).toBeNull();
    expect(awayCity({ city: 'Madison', state: 'AL' }, { ...home, state: '' })).toBeNull();
  });
});

describe('the venue line', () => {
  it('reads "Venue · City", the city alone without a venue, and is untouched at home', () => {
    expect(withAwayCity('Moxie Studio', 'Santa Fe')).toBe('Moxie Studio · Santa Fe');
    expect(withAwayCity(null, 'Santa Fe')).toBe('Santa Fe');
    expect(withAwayCity('  ', 'Santa Fe')).toBe('Santa Fe');
    expect(withAwayCity('Moxie Studio', null)).toBe('Moxie Studio');
    expect(withAwayCity(null, null)).toBe('');
    const offering = { location: 'Moxie Studio', city: 'Santa Fe', state: 'NM' } as never;
    expect(venueText(offering, home)).toBe('Moxie Studio · Santa Fe');
    expect(venueText({ location: 'Moxie Studio', city: 'Madison', state: 'WI' } as never, home)).toBe('Moxie Studio');
  });
});

describe('saved place text', () => {
  it('trims, caps at 80 characters and turns empty into null', () => {
    expect(cleanPlaceText('  Santa Fe ')).toBe('Santa Fe');
    expect(cleanPlaceText('   ')).toBeNull();
    expect(cleanPlaceText(undefined)).toBeNull();
    expect(cleanPlaceText(42)).toBeNull();
    expect(cleanPlaceText('x'.repeat(200))).toHaveLength(80);
  });

  it('leaves the columns out when the request has neither, clears them with nulls, and drops a state without a city', () => {
    expect(placeColumns(undefined, undefined)).toEqual({});
    expect(placeColumns(' Santa Fe ', ' NM ')).toEqual({ city: 'Santa Fe', state: 'NM' });
    expect(placeColumns(null, null)).toEqual({ city: null, state: null });
    expect(placeColumns('', 'NM')).toEqual({ city: null, state: null });
  });
});

describe('the city of a Places pick', () => {
  const part = (long_name: string, short_name: string, ...types: string[]) => ({ long_name, short_name, types });
  const state = part('New Mexico', 'NM', 'administrative_area_level_1', 'political');

  it('takes the locality, else the postal town, else the sublocality or level 3, with the state as its short name', () => {
    expect(placeCityState([part('1', '1', 'street_number'), part('Santa Fe', 'Santa Fe', 'locality', 'political'), state])).toEqual({ city: 'Santa Fe', state: 'NM' });
    expect(placeCityState([part('Brooklyn', 'Brooklyn', 'sublocality', 'sublocality_level_1'), part('London', 'London', 'postal_town'), state])).toEqual({ city: 'London', state: 'NM' });
    expect(placeCityState([part('Brooklyn', 'Brooklyn', 'sublocality', 'sublocality_level_1'), state])).toEqual({ city: 'Brooklyn', state: 'NM' });
    expect(placeCityState([part('Springfield', 'Springfield', 'administrative_area_level_3'), state])).toEqual({ city: 'Springfield', state: 'NM' });
  });

  it('is empty without a city (a state alone is not kept), or without components', () => {
    expect(placeCityState([state])).toEqual({ city: null, state: null });
    expect(placeCityState(undefined)).toEqual({ city: null, state: null });
    expect(placeCityState([])).toEqual({ city: null, state: null });
  });
});

describe('the editor keeps a class\'s city only while its Location reads as it did', () => {
  it('keeps it for the loaded or picked text, drops it once the text is typed over, and starts empty for a new class', () => {
    setEditorPlace('Santa Fe', 'NM', 'Moxie Studio');
    expect(editorPlace('Moxie Studio')).toEqual({ city: 'Santa Fe', state: 'NM' });
    expect(editorPlace('  Moxie Studio ')).toEqual({ city: 'Santa Fe', state: 'NM' });
    expect(editorPlace('Moxie Studio 2')).toEqual({ city: null, state: null });
    setEditorPlace(undefined, undefined, '');
    expect(editorPlace('')).toEqual({ city: null, state: null });
  });
});
