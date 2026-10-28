import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bouncesFrom, deliveryOutcomeFrom, verifyResendSignature } from '../../src/lib/resendWebhook';

const secret = `whsec_${Buffer.from('unit-test-secret').toString('base64')}`;
const now = 1_800_000_000;
const sign = (id: string, ts: number, body: string) =>
  `v1,${createHmac('sha256', Buffer.from('unit-test-secret')).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('Resend webhook signatures', () => {
  const body = '{"type":"email.bounced"}';

  it('accepts a correctly signed, recent message (also among several signatures)', () => {
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: String(now), signature: sign('msg_1', now, body) }, body, now)).toBe(true);
    const several = `v1,AAAA ${sign('msg_1', now, body)}`;
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: String(now), signature: several }, body, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a missing header and an old (replayed) message', () => {
    const signature = sign('msg_1', now, body);
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: String(now), signature }, '{"type":"x"}', now)).toBe(false);
    expect(verifyResendSignature('whsec_b3RoZXI=', { id: 'msg_1', timestamp: String(now), signature }, body, now)).toBe(false);
    expect(verifyResendSignature(secret, { id: null, timestamp: String(now), signature }, body, now)).toBe(false);
    expect(verifyResendSignature(secret, { id: 'msg_1', timestamp: String(now), signature }, body, now + 600)).toBe(false);
  });
});

describe('bounced addresses from a Resend event', () => {
  it('reads the recipients, lowercased, with the bounce type and message', () => {
    const event = { type: 'email.bounced', data: { to: ['Deb@Gmial.com'], bounce: { type: 'Permanent', message: 'Mailbox does not exist' } } };
    expect(bouncesFrom(event)).toEqual([{ email: 'deb@gmial.com', bounceType: 'Permanent', reason: 'Mailbox does not exist' }]);
  });

  it('ignores other events and malformed ones', () => {
    expect(bouncesFrom({ type: 'email.delivered', data: { to: ['a@b.com'] } })).toEqual([]);
    expect(bouncesFrom(null)).toEqual([]);
    expect(bouncesFrom({ type: 'email.bounced', data: { to: ['not-an-email'] } })).toEqual([]);
  });
});

describe('how one email went, from a Resend event', () => {
  it('reads delivered and bounced events by email id', () => {
    expect(deliveryOutcomeFrom({ type: 'email.delivered', data: { email_id: 'e1', to: ['Deb@Example.com'] } })).toEqual({ emailId: 'e1', status: 'delivered', email: 'deb@example.com', reason: null });
    expect(deliveryOutcomeFrom({ type: 'email.bounced', data: { email_id: 'e2', to: ['deb@gmial.com'], bounce: { message: 'Mailbox does not exist' } } })).toEqual({
      emailId: 'e2',
      status: 'bounced',
      email: 'deb@gmial.com',
      reason: 'Mailbox does not exist',
    });
  });

  it('ignores other events and ones without an email id', () => {
    expect(deliveryOutcomeFrom({ type: 'email.opened', data: { email_id: 'e1', to: ['a@b.com'] } })).toBeNull();
    expect(deliveryOutcomeFrom({ type: 'email.delivered', data: { to: ['a@b.com'] } })).toBeNull();
    expect(deliveryOutcomeFrom(null)).toBeNull();
  });
});
