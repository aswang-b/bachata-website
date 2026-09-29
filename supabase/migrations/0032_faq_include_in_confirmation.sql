-- Run this in the Supabase SQL editor after 0001-0031.

-- Per-FAQ toggle for whether it appears in the printed/emailed registration
-- confirmation (the on-screen homepage/confirmation-page accordion still
-- always shows every FAQ regardless of this flag). Defaults to true so
-- existing FAQs keep showing up in confirmations until an admin opts one out.
alter table faqs add column include_in_confirmation boolean not null default true;
