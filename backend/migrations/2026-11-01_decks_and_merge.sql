-- KathaGraph: slide decks, Word reports, credit, and "Same place?" decisions (1 Nov 2026)
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run) BEFORE pushing the code that uses it.

begin;

-- New kinds of source: PowerPoint decks and Word reports
-- (drops the old type rule whatever it was named)
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'sources'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%type%photo%'
  loop
    execute format('alter table sources drop constraint %I', c);
  end loop;
end $$;
alter table sources add constraint sources_type_check
  check (type in ('photo', 'pdf', 'note', 'csv', 'web', 'slides', 'doc'));

-- A photo taken out of a deck or report remembers the file it came from
alter table sources add column if not exists parent_source_id bigint references sources(id) on delete cascade;

-- Pairs of monuments a person has said are different places (never suggested as duplicates again)
create table if not exists entity_not_same (
  a bigint not null references entities(id) on delete cascade,
  b bigint not null references entities(id) on delete cascade,
  decided_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table entity_not_same enable row level security;

-- Check: should list the new type rule and the new table
select conname from pg_constraint where conname = 'sources_type_check'
union all select 'entity_not_same' from information_schema.tables where table_name = 'entity_not_same';

commit;
