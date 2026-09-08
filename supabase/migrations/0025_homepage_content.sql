-- Run this in the Supabase SQL editor after 0001-0024.
-- Singleton row holding the homepage "lesson overview" rich text shown under
-- Current Lesson Offerings, seeded with the copy that used to be hardcoded.

create table if not exists homepage_content (
  id boolean primary key default true check (id),
  lesson_overview text not null default '',
  updated_at timestamptz not null default now()
);

insert into homepage_content (id, lesson_overview) values (
  true,
  '<p>Each class consists of a warmup, explanation of technique, practice without music, and practice to music. We rotate partners throughout the class, so you do not need to bring a partner with you. There will be a few minutes at the end of class for a recording and recap.</p><p>Class material and difficulty progresses through the series. We cannot extensively review prior content, so I strongly recommend consistent attendance and practice in order to get the most out of your classes. If you are interested in a practica (casual group practice), <a href="/contact">contact me</a> and I can help coordinate!</p>'
) on conflict (id) do nothing;

-- Ordered FAQ entries shown in the homepage's "FAQs & Other Info" accordion,
-- seeded with the entries that used to be hardcoded.
create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into faqs (question, answer, sort_order)
select * from (values
  (
    'What should I wear to class?',
    '<p>Please change into indoor shoes (clean and dry) if you would like to wear shoes. Otherwise, you should dance in clean socks.</p><p>I recommend wearing something comfortable to class! Here are a few things to consider:</p><ul><li>Activewear/sweat-wicking material — you will get sweaty!</li><li>Minimal hanging jewelry/accessories as it may get caught in hair or clothes.</li><li>Seeing how your body moves is integral to learning — extremely baggy clothes may obscure smaller movements and details.</li></ul>',
    0
  ),
  (
    'Does the studio have lockers?',
    '<p>There are coat hangers in the lobby, but minimal storage — we most often set our bags on the edges of the floor, so please keep that in mind.</p>',
    1
  ),
  (
    'Tips for first-timers',
    '<p>We will be in close contact with others, so feel free to bring gum/mints to class.</p>',
    2
  )
) as seed(question, answer, sort_order)
where not exists (select 1 from faqs);
