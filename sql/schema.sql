-- One table holds every board document, keyed by the same "collection/id"
-- paths the board already uses (e.g. "meals/abc123", "plan/current").
create table if not exists documents (
  path text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table documents enable row level security;

-- Basic household-only access: any signed-in user can read and write.
-- Tighten with a specific auth.uid() allow-list if you want per-user limits.
create policy "household read" on documents
  for select using (auth.role() = 'authenticated');

create policy "household write" on documents
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Required for the board's live onSnapshot-style updates.
alter publication supabase_realtime add table documents;

-- Fixed recipe dataset (ported from an external scrape), read-only from the
-- board/scripts. Loaded in bulk by scripts/load-recipes.mjs, not edited here.
create table if not exists recipes (
  id integer primary key,
  title text not null,
  url text,
  description text,
  tags text[] not null default '{}',
  course text not null default 'other', -- 'entree' | 'side' | 'other', derived from tags at import time
  protein text, -- 'chicken' | 'beef' | 'pork' | 'turkey' | 'lamb' | 'fish' | 'vegetarian' | null
  rating real,
  rating_count integer,
  serves integer,
  time_minutes integer,
  oven text not null default '',
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  tip text not null default ''
);

alter table recipes enable row level security;

create policy "household read recipes" on recipes
  for select using (auth.role() = 'authenticated');

create index if not exists recipes_course_idx on recipes (course);
create index if not exists recipes_protein_idx on recipes (protein);
create index if not exists recipes_time_minutes_idx on recipes (time_minutes);
