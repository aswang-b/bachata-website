-- Run this in the Supabase SQL editor after 0001-0063, BEFORE deploying the
-- code that asks dancers for feedback.
--
-- Feedback campaigns: an admin asks the dancers who came to a class
-- occurrence, a whole series, or an event for a quick anonymous rating (by
-- email, or a ready-made WhatsApp message). Each dancer asked is an invite
-- with one-time links; their answer is stored apart from it, so nothing
-- links an answer back to who gave it unless the dancer chooses to share
-- their name.

create table if not exists feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text,
  -- e.g. "Bachata Foundations · Oct 28"
  title text not null,
  class_title text not null,
  scope text not null check (scope in ('occurrence', 'series', 'event')),
  series_key text,
  -- The occurrence or event asked about (null for a whole series). No foreign
  -- key: the feedback stays when the class is later deleted.
  event_id uuid,
  question text not null,
  -- Closed campaigns take no more answers.
  closed_at timestamptz
);

create index if not exists feedback_campaigns_created_at_idx on feedback_campaigns (created_at desc);

create table if not exists feedback_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references feedback_campaigns(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  emailed_at timestamptz,
  whatsapp_at timestamptz,
  -- Set once any of their links is answered. Never shown per dancer.
  responded boolean not null default false
);

create index if not exists feedback_invites_campaign_idx on feedback_invites (campaign_id);

-- Each link sent to a dancer (the email's, each WhatsApp message's), by the
-- SHA-256 of its secret; the links themselves are never stored.
create table if not exists feedback_links (
  token_hash text primary key,
  invite_id uuid not null references feedback_invites(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_links_invite_idx on feedback_links (invite_id);

create table if not exists feedback_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references feedback_campaigns(id) on delete cascade,
  -- To the hour only, so it can't be lined up with when each dancer was asked.
  created_at timestamptz not null default date_trunc('hour', now()),
  -- SHA-256 of a value derived from the link answered: lets that link come
  -- back to add a comment, without naming its invite.
  response_key text not null unique,
  rating int not null check (rating between 1 and 5),
  comment text,
  -- Only when the dancer ticked "you may contact me about this".
  contact_name text,
  contact_email text,
  contact_phone text
);

create index if not exists feedback_responses_campaign_idx on feedback_responses (campaign_id);

-- Server only (see 0045).
alter table feedback_campaigns enable row level security;
alter table feedback_invites enable row level security;
alter table feedback_links enable row level security;
alter table feedback_responses enable row level security;
revoke all on table feedback_campaigns from anon, authenticated;
revoke all on table feedback_invites from anon, authenticated;
revoke all on table feedback_links from anon, authenticated;
revoke all on table feedback_responses from anon, authenticated;
grant select, insert, update, delete on table feedback_campaigns to service_role;
grant select, insert, update, delete on table feedback_invites to service_role;
grant select, insert, update, delete on table feedback_links to service_role;
grant select, insert, update, delete on table feedback_responses to service_role;
