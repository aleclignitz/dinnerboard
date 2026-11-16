-- Recipe Box: lets the `recipes` table hold more than the NYT dataset
-- (a Paprika export, and recipes added one at a time from the board), and
-- adds a search function for the board's Recipe Box tab.
-- Safe to run more than once. Paste into the Supabase SQL editor.

-- Where each recipe came from: 'nyt' (tools/import_recipes.py),
-- 'paprika' (tools/import_paprika.py) or 'manual' (added on the board).
alter table recipes add column if not exists source text not null default 'nyt';
-- Stable id from the source app (Paprika's uid), so re-imports update in place.
alter table recipes add column if not exists source_uid text;
-- Free-text credit, e.g. the cookbook or website a Paprika recipe came from.
alter table recipes add column if not exists credit text;

create unique index if not exists recipes_source_uid_key on recipes (source_uid);
create index if not exists recipes_source_idx on recipes (source);

-- NYT rows keep their NYT ids; everything else gets ids from this range.
create sequence if not exists recipes_custom_id_seq start with 2000000000 maxvalue 2147483647 owned by recipes.id;
alter table recipes alter column id set default nextval('recipes_custom_id_seq');
grant usage, select on sequence recipes_custom_id_seq to authenticated;

-- Signed-in household members can add (and remove) their own recipes from the
-- board. Imported datasets stay read-only for them.
drop policy if exists "household add recipes" on recipes;
create policy "household add recipes" on recipes
  for insert with check (auth.role() = 'authenticated' and source = 'manual');

drop policy if exists "household remove added recipes" on recipes;
create policy "household remove added recipes" on recipes
  for delete using (auth.role() = 'authenticated' and source = 'manual');

-- Every word in `q` must appear somewhere in the title, description, credit,
-- tags or ingredients. Title matches and your own recipes sort first.
-- Runs as the caller, so Row Level Security still applies.
create or replace function search_recipes(q text default '', src text default null, prot text default null, lim integer default 30)
returns setof recipes
language sql
stable
security invoker
set search_path = public
as $$
  select r.*
  from recipes r
  where (coalesce(src, '') = '' or r.source = src)
    and (coalesce(prot, '') = '' or r.protein = prot)
    and not exists (
      select 1
      from unnest(regexp_split_to_array(lower(trim(coalesce(q, ''))), '\s+')) as w(word)
      where w.word <> ''
        and position(w.word in lower(concat_ws(' ', r.title, r.description, r.credit, array_to_string(r.tags, ' '), r.ingredients::text))) = 0
    )
  order by
    position(lower(trim(coalesce(q, ''))) in lower(r.title)) > 0 desc,
    r.source <> 'nyt' desc,
    r.rating desc nulls last,
    r.title
  limit least(greatest(coalesce(lim, 30), 1), 100);
$$;

grant execute on function search_recipes(text, text, text, integer) to authenticated;
