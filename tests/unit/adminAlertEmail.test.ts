import { describe, expect, it } from 'vitest';
import { buildContactAlertHtml } from '../../src/lib/adminAlertEmail';

// The admins' alert for a contact-form message (lib/adminAlertEmail.ts), in the site's email look.
describe('the contact request alert', () => {
  const rows: [string, string][] = [
    ['Name', 'Jamie <Rivera>'],
    ['Email', 'jamie@example.com'],
    ['Phone', '(555) 555-0100'],
    ['Notes', 'Free on 2026-11-13, call 555 555 0199'],
  ];

  it('says what came in and from whom, links the contact details, and offers to reply and open the inbox', () => {
    const html = buildContactAlertHtml({ name: 'Jamie <Rivera>', createdAt: new Date('2026-11-06T18:30:00Z'), rows, replyTo: 'jamie@example.com' });
    expect(html).toContain('New contact request</h1>');
    expect(html).toContain('From Jamie &lt;Rivera&gt;');
    expect(html).not.toContain('<Rivera>');
    expect(html).toContain('<a href="mailto:jamie@example.com"');
    expect(html).toContain('<a href="tel:5555550100"');
    // A date or number in the message isn't a phone link.
    expect(html).not.toContain('tel:5555550199');
    expect(html).toContain('>Reply by email</a>');
    expect(html).toContain('https://dancewithb.fun/admin/inbox');
    // Only admins get it: a note in the footer instead of the social icons.
    expect(html).toContain('Admin alert');
    expect(html).not.toContain('email/instagram.png');
  });

  it('links contact rows by the same labels as the confirmation email (one list in registrationEmail.ts)', () => {
    const html = buildContactAlertHtml({
      name: 'Jamie',
      createdAt: new Date(),
      rows: [['WhatsApp', '555 555 0101'], ['Dancer 2', 'Sam · sam@example.com'], ['Payment method', 'Venmo 555 555 0102'], ['Instagram', '@jamie.dances']],
      replyTo: null,
    });
    expect(html).toContain('tel:5555550101');
    expect(html).toContain('mailto:sam@example.com');
    expect(html).not.toContain('tel:5555550102');
  });

  it('without an email to reply to, opening the inbox is the main button', () => {
    const html = buildContactAlertHtml({ name: 'Jamie', createdAt: new Date(), rows: [['Phone', '(555) 555-0100']], replyTo: null });
    expect(html).not.toContain('Reply by email');
    expect(html).toContain('>Open the inbox</a>');
  });
});
