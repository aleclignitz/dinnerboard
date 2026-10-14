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
