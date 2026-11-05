-- Run this in the Supabase SQL editor after 0001-0065, BEFORE deploying the
-- code that uses questionnaires.
--
-- Feedback questionnaires: reusable, ordered lists of questions and messages
-- an admin writes. Each request keeps its own copy (items), so editing a
-- questionnaire never changes what past results mean. Each request also gets a
-- link anyone can use (share_token), besides the dancers' own one-time links,
-- and needn't be about a class or event at all (scope 'general').

create table if not exists feedback_questionnaires (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  -- In order: { id, kind, text, required?, options?: [{ id, label }] }.
  items jsonb not null default '[]',
  -- Whether it ends by offering to be contacted about the answers.
  contact_box boolean not null default true,
  -- Hidden instead of deleted once a request has used it.
  hidden_at timestamptz
);

alter table feedback_questionnaires enable row level security;
revoke all on table feedback_questionnaires from anon, authenticated;
grant select, insert, update, delete on table feedback_questionnaires to service_role;

-- The starter: as quick as a request can be.
insert into feedback_questionnaires (name, items)
select 'Quick feedback', '[
  {"id": "rating", "kind": "faces", "text": "How was {class}?"},
  {"id": "comment", "kind": "text", "text": "Anything you''d like to add?"}
]'::jsonb
where not exists (select 1 from feedback_questionnaires);

alter table feedback_campaigns
  add column if not exists questionnaire_id uuid references feedback_questionnaires(id) on delete set null,
  add column if not exists items jsonb,
  add column if not exists contact_box boolean not null default true,
  add column if not exists share_token text not null default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists feedback_campaigns_share_token_idx on feedback_campaigns (share_token);

alter table feedback_campaigns drop constraint if exists feedback_campaigns_scope_check;
alter table feedback_campaigns add constraint feedback_campaigns_scope_check check (scope in ('occurrence', 'series', 'event', 'general'));

alter table feedback_responses
  add column if not exists answers jsonb not null default '{}',
  -- Through a dancer's own link, or the request's shared one.
  add column if not exists via text not null default 'invite' check (via in ('invite', 'shared')),
  -- Set when they press Done; answers save as they go, so many won't.
  add column if not exists finished_at timestamptz;

-- Requests from before questionnaires: one rating and a comment.
update feedback_campaigns
set items = jsonb_build_array(
  jsonb_build_object('id', 'rating', 'kind', 'faces', 'text', question),
  jsonb_build_object('id', 'comment', 'kind', 'text', 'text', 'Anything you''d like to add?')
)
where items is null;

update feedback_responses
set answers = jsonb_strip_nulls(jsonb_build_object('rating', rating, 'comment', comment)),
    finished_at = created_at;

alter table feedback_campaigns alter column items set not null;
alter table feedback_campaigns drop column question;
alter table feedback_responses drop column rating;
alter table feedback_responses drop column comment;
