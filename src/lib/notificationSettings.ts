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

export async function setNotificationRecipients(recipientEmails: string): Promise<void> {
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ id: true, recipient_emails: recipientEmails, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to update notification settings: ${error.message}`);
}
