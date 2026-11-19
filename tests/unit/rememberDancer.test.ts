import { describe, expect, it } from 'vitest';
import {
  MAX_EMAIL,
  MAX_NAME,
  MAX_PHONE,
  PENDING_KEY,
  PENDING_MAX_AGE_MS,
  SAVED_KEY,
  clearSavedDancer,
  commitParkedDancer,
  parkDancer,
  rememberOnThisDevice,
  readSavedDancer,
  saveDancer,
  type StorageLike,
} from '../../src/scripts/rememberDancer';

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const throwing = (which: 'get' | 'set' | 'remove'): StorageLike => ({
  getItem: () => {
    if (which === 'get') throw new Error('blocked');
    return null;
  },
  setItem: () => {
    if (which === 'set') throw new Error('full');
  },
  removeItem: () => {
    if (which === 'remove') throw new Error('blocked');
  },
});

const dancer = { firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', phone: '6085550100', role: 'follower' as const };

describe('remembered dancer', () => {
  it('round-trips the first dancer under one key', () => {
    const s = memory();
    expect(saveDancer(s, dancer, 1234)).toBe(true);
    expect(Object.keys(s.data)).toEqual([SAVED_KEY]);
    expect(SAVED_KEY).toBe('dwb.dancer.v1');
    expect(readSavedDancer(s)).toEqual({ ...dancer, savedAt: 1234 });
  });

  it('stores only the contact fields, whatever else is passed', () => {
    const s = memory();
    saveDancer(s, { ...dancer, payment: 'venmo', comments: 'hi', classes: ['x'] } as never);
    expect(Object.keys(JSON.parse(s.data[SAVED_KEY])).sort()).toEqual(['email', 'firstName', 'lastName', 'phone', 'role', 'savedAt']);
  });

  it('reads nothing from an empty store, corrupt JSON, or a non-object', () => {
    expect(readSavedDancer(memory())).toBeNull();
    expect(readSavedDancer(memory({ [SAVED_KEY]: '{not json' }))).toBeNull();
    expect(readSavedDancer(memory({ [SAVED_KEY]: '"text"' }))).toBeNull();
    expect(readSavedDancer(memory({ [SAVED_KEY]: 'null' }))).toBeNull();
    expect(readSavedDancer(memory({ [SAVED_KEY]: '[1,2]' }))).toBeNull();
  });

  it('ignores values that are not strings and unknown roles', () => {
    const s = memory({ [SAVED_KEY]: JSON.stringify({ firstName: 5, lastName: { a: 1 }, email: ['x'], phone: '6085550100', role: 'admin', savedAt: 'soon' }) });
    expect(readSavedDancer(s)).toEqual({ firstName: '', lastName: '', email: '', phone: '6085550100', role: '', savedAt: 0 });
    expect(readSavedDancer(memory({ [SAVED_KEY]: JSON.stringify({ firstName: 5, email: false }) }))).toBeNull();
  });

  it('caps over-long values on read', () => {
    const s = memory({ [SAVED_KEY]: JSON.stringify({ firstName: 'a'.repeat(500), lastName: 'b'.repeat(500), email: 'c'.repeat(500), phone: '1'.repeat(500), role: 'leader', savedAt: 1 }) });
    const d = readSavedDancer(s)!;
    expect(d.firstName).toHaveLength(MAX_NAME);
    expect(d.lastName).toHaveLength(MAX_NAME);
    expect(d.email).toHaveLength(MAX_EMAIL);
    expect(d.phone).toHaveLength(MAX_PHONE);
  });

  it('does not save a dancer with no contact details', () => {
    const s = memory();
    expect(saveDancer(s, { firstName: '', lastName: '', email: '', phone: '', role: 'leader' })).toBe(false);
    expect(s.data).toEqual({});
  });

  it('swallows a storage that throws on get, set or remove', () => {
    expect(readSavedDancer(throwing('get'))).toBeNull();
    expect(saveDancer(throwing('set'), dancer)).toBe(false);
    expect(() => clearSavedDancer(throwing('remove'))).not.toThrow();
    expect(() => parkDancer(throwing('set'), dancer)).not.toThrow();
    expect(commitParkedDancer(throwing('get'), memory())).toBe(false);
    expect(commitParkedDancer(memory({ [PENDING_KEY]: JSON.stringify({ ...dancer, at: Date.now() }) }), throwing('set'))).toBe(false);
  });

  it('clear removes the key', () => {
    const s = memory();
    saveDancer(s, dancer);
    clearSavedDancer(s);
    expect(s.data).toEqual({});
    expect(readSavedDancer(s)).toBeNull();
  });
});

describe('details parked at submit and kept on the confirmation page', () => {
  it('moves the parked details to the device store once, then forgets them', () => {
    const session = memory();
    const local = memory();
    parkDancer(session, dancer, 1000);
    expect(local.data).toEqual({});
    expect(commitParkedDancer(session, local, 2000)).toBe(true);
    expect(readSavedDancer(local)).toEqual({ ...dancer, savedAt: 2000 });
    expect(session.data).toEqual({});
    expect(commitParkedDancer(session, local, 3000)).toBe(false);
  });

  it('keeps nothing when nothing was parked (a failed or abandoned form)', () => {
    const local = memory();
    expect(commitParkedDancer(memory(), local)).toBe(false);
    expect(local.data).toEqual({});
  });

  it('ignores stale, future-dated, corrupt or untimed parked details, and still clears them', () => {
    for (const parked of [
      JSON.stringify({ ...dancer, at: 0 }),
      JSON.stringify({ ...dancer, at: PENDING_MAX_AGE_MS + 1000 + 10 * 60 * 1000 }),
      JSON.stringify({ ...dancer }),
      '{broken',
    ]) {
      const session = memory({ [PENDING_KEY]: parked });
      const local = memory();
      expect(commitParkedDancer(session, local, PENDING_MAX_AGE_MS + 1000)).toBe(false);
      expect(local.data).toEqual({});
      expect(session.data).toEqual({});
    }
  });
});

// An instructor signs several dancers up on their own phone: the last dancer's
// details must not fill the next form, and none is kept.
describe('a device that might be an admin\'s', () => {
  it('remembers nothing and drops a saved dancer', () => {
    const local = memory();
    saveDancer(local, dancer, 1);
    expect(rememberOnThisDevice(local, true)).toBe(false);
    expect(local.data).toEqual({});
    expect(readSavedDancer(local)).toBeNull();
  });

  it('leaves an ordinary visitor\'s saved dancer alone', () => {
    const local = memory();
    saveDancer(local, dancer, 1);
    expect(rememberOnThisDevice(local, false)).toBe(true);
    expect(readSavedDancer(local)).toEqual({ ...dancer, savedAt: 1 });
  });

  it('copes with no storage, or one that throws on remove', () => {
    expect(rememberOnThisDevice(null, true)).toBe(false);
    expect(rememberOnThisDevice(null, false)).toBe(true);
    expect(rememberOnThisDevice(throwing('remove'), true)).toBe(false);
  });
});
