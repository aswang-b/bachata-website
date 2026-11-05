import { describe, expect, it, vi } from 'vitest';

// Without an API key a batch send fails rather than pretending it went, so a
// feedback request never counts dancers as emailed who got nothing.
vi.mock('../../src/lib/env', () => ({ env: () => undefined }));
vi.mock('../../src/lib/testMode', () => ({ emailSinkPath: () => null, recordSunkEmail: () => {} }));
vi.mock('../../src/lib/notificationSettings', () => ({ getNotificationRecipients: async () => [] }));
vi.mock('../../src/lib/siteErrors', () => ({ logSiteError: async () => {} }));

import { sendEmailBatch } from '../../src/lib/email';

describe('sending a batch of emails', () => {
  it('throws when there is no Resend API key', async () => {
    await expect(sendEmailBatch([{ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>' }])).rejects.toThrow('RESEND_API_KEY');
  });
});
