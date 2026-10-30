-- KathaGraph data cleanup, 30 Oct 2026
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- Everything runs as one transaction: if any line fails, nothing changes.

begin;

-- Moves everything from a duplicate monument onto the one we keep, then removes the duplicate.
create or replace function pg_temp.merge_monument(dup bigint, keep bigint) returns void language sql as $$
  update claims set entity_id = keep where entity_id = dup;
  insert into entity_sources (entity_id, source_id, tag)
    select keep, source_id, tag from entity_sources where entity_id = dup
    on conflict (entity_id, source_id) do nothing;
  insert into entity_aliases (entity_id, alias, language)
    select keep, alias, language from entity_aliases where entity_id = dup
    on conflict (entity_id, alias) do nothing;
  insert into entity_aliases (entity_id, alias, language)
    select keep, name, 'en' from entities where id = dup
    on conflict (entity_id, alias) do nothing;
  update models set entity_id = keep where entity_id = dup;
  delete from entities where id = dup;
$$;

-- 1. "Jama Mosque" (#13) mixed up three different mosques that Wikipedia all calls
--    "Jama Mosque" (Friday Mosque). Give each fact back to the right mosque, by article:
update claims set entity_id = 12 where entity_id = 13 and source_id = 28;        -- Ahmedabad article
update claims set entity_id = 34 where entity_id = 13 and source_id in (44, 46); -- Champaner articles (en, hi)
-- Facts from the Uparkot Fort article were about the small mosque inside the fort, not the fort itself;
-- they are removed rather than moved, so the fort doesn't get a mosque's dates.
delete from entities where id = 13;  -- also removes its aliases, links and the remaining Uparkot facts

-- 2. Same monument under two names
select pg_temp.merge_monument(79, 80);  -- "Ambaji" -> "Ambaji Mata Temple"
select pg_temp.merge_monument(60, 59);  -- "Trikamray temple" -> "Lakshminarayan and Trikamray temples"

-- 3. Not heritage monuments (picked up by mistake from Wikipedia text)
delete from entities where id in (
  47,  -- Kamla Nehru Zoological Garden (a 1951 zoo at Kankaria Lake)
  66,  -- "protection wall" (a line in the Bet Dwarka article)
  67   -- "temples on the island" (a line in the Bet Dwarka article)
);

-- Check: should show 74 monuments and no row for ids 13, 47, 60, 66, 67, 79
select count(*) as monuments,
       count(*) filter (where id in (13, 47, 60, 66, 67, 79)) as should_be_zero
from entities where type = 'monument';

commit;
