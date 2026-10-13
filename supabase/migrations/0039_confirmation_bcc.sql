-- Run this in the Supabase SQL editor after 0001-0038, BEFORE deploying the
-- code that reads this column.
--
-- Admin emails that get a blind copy of every registration confirmation
-- email (one copy per registration, BCC'd so dancers never see them).
-- Comma-separated like recipient_emails; empty = no copies.

alter table notification_settings add column if not exists confirmation_bcc_emails text not null default '';
