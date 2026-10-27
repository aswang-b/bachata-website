import { describe, expect, it } from 'vitest';
import { suggestEmail } from '../../src/lib/emailTypos';

describe('email typo suggestions', () => {
  it('fixes a misspelled common domain', () => {
    expect(suggestEmail('deb@gmial.com')).toBe('deb@gmail.com');
    expect(suggestEmail('deb@yahooo.com')).toBe('deb@yahoo.com');
    expect(suggestEmail('deb@hotmial.com')).toBe('deb@hotmail.com');
    expect(suggestEmail('deb@gmail.co')).toBe('deb@gmail.com');
    expect(suggestEmail('Deb@GMAIL.CON')).toBe('Deb@gmail.com');
    expect(suggestEmail('bucky@wsic.edu')).toBe('bucky@wisc.edu');
  });

  it('fixes a slipped ending on any domain', () => {
    expect(suggestEmail('a@mycompany.con')).toBe('a@mycompany.com');
    expect(suggestEmail('a@mycompany.ner')).toBe('a@mycompany.net');
  });

  it('leaves correct, unfamiliar and country domains alone', () => {
    expect(suggestEmail('deb@gmail.com')).toBeNull();
    expect(suggestEmail('deb@dancewithb.fun')).toBeNull();
    expect(suggestEmail('deb@company.co')).toBeNull();
    expect(suggestEmail('deb@example.com')).toBeNull();
    expect(suggestEmail('not an email')).toBeNull();
  });

  it("leaves real providers that are an edit or two from a common one alone (they were 'corrected' before)", () => {
    expect(suggestEmail('deb@mail.com')).toBeNull();
    expect(suggestEmail('deb@aim.com')).toBeNull();
    expect(suggestEmail('deb@gmx.com')).toBeNull();
    expect(suggestEmail('deb@yahoo.ca')).toBeNull();
    expect(suggestEmail('deb@live.ca')).toBeNull();
    expect(suggestEmail('deb@hotmail.fr')).toBeNull();
    expect(suggestEmail('deb@yahoo.co.uk')).toBeNull();
    // Still slips: .co for .com, and a misspelled provider.
    expect(suggestEmail('deb@yahoo.co')).toBe('deb@yahoo.com');
    expect(suggestEmail('deb@yaho.com')).toBe('deb@yahoo.com');
  });
});
