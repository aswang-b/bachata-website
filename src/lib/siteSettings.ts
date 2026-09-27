import { supabase } from './supabase';

export const SITE_SETTING_KEYS = ['hide_about_nav', 'hide_contact_nav', 'hide_checkin_nav', 'disable_checkin_page'] as const;
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number];
export type SiteSettings = Record<SiteSettingKey, boolean>;

export async function getSiteSettings(): Promise<SiteSettings> {
  const settings = Object.fromEntries(SITE_SETTING_KEYS.map((key) => [key, false])) as SiteSettings;

  const { data, error } = await supabase.from('site_settings').select('key, enabled');
  if (error) {
    console.error('Failed to load site settings:', error);
    return settings;
  }

  for (const row of data ?? []) {
    if (SITE_SETTING_KEYS.includes(row.key as SiteSettingKey)) {
      settings[row.key as SiteSettingKey] = row.enabled;
    }
  }

  return settings;
}

export async function setSiteSetting(key: SiteSettingKey, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('site_settings').upsert({ key, enabled });
  if (error) throw new Error(`Failed to update site setting ${key}: ${error.message}`);
}
