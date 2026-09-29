import { supabase } from './supabase';

export function parseRecipientEmails(value: string): string[] {
  return value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

// Raw stored string (comma-separated), for populating the admin editor as-typed.
export async function getNotificationRecipientsRaw(): Promise<string> {
  const { data, error } = await supabase.from('notification_settings').select('recipient_emails').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load notification settings:', error.message);
  if (error || !data) return '';
  return data.recipient_emails;
}

export async function getNotificationRecipients(): Promise<string[]> {
  return parseRecipientEmails(await getNotificationRecipientsRaw());
}

export const DEFAULT_CONFIRMATION_EMAIL_PER_IP_CAP = 50;
export const MAX_CONFIRMATION_EMAIL_PER_IP_CAP = 1000;

// Falls back to the default if the row/column is missing or the lookup fails,
// so a settings problem never disables the throttle or the confirmations.
export async function getConfirmationEmailPerIpCap(): Promise<number> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('confirmation_email_per_ip_daily_cap')
    .eq('id', true)
    .maybeSingle();
  if (error) console.error('Failed to load confirmation email cap:', error.message);
  return data?.confirmation_email_per_ip_daily_cap ?? DEFAULT_CONFIRMATION_EMAIL_PER_IP_CAP;
}

export async function setConfirmationEmailPerIpCap(cap: number): Promise<void> {
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ id: true, confirmation_email_per_ip_daily_cap: cap, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to update confirmation email cap: ${error.message}`);
}

export const DEFAULT_CONTACT_EMAIL_PER_IP_CAP = 3;
export const MAX_CONTACT_EMAIL_PER_IP_CAP = 100;

export async function getContactEmailPerIpCap(): Promise<number> {
  const { data, error } = await supabase.from('notification_settings').select('contact_email_per_ip_daily_cap').eq('id', true).maybeSingle();
  if (error) console.error('Failed to load contact email cap:', error.message);
  return data?.contact_email_per_ip_daily_cap ?? DEFAULT_CONTACT_EMAIL_PER_IP_CAP;
}

export async function setContactEmailPerIpCap(cap: number): Promise<void> {
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ id: true, contact_email_per_ip_daily_cap: cap, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to update contact email cap: ${error.message}`);
}

export async function setNotificationRecipients(recipientEmails: string): Promise<void> {
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ id: true, recipient_emails: recipientEmails, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to update notification settings: ${error.message}`);
}
