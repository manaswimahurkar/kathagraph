-- KathaGraph: where each source comes from, 30 Oct 2026
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run) BEFORE pushing the code that uses it.

begin;

-- Field record (made by the archive's own team) or imported web material (Wikipedia, Wikidata, Commons)
alter table sources add column if not exists origin text not null default 'field'
  check (origin in ('field', 'web'));
alter table sources add column if not exists author text;       -- who made it (photographer, "Wikipedia contributors")
alter table sources add column if not exists licence text;      -- e.g. "CC BY-SA 4.0 (https://...)"
alter table sources add column if not exists source_url text;   -- the page it was imported from
-- The monument an imported item is about (an article or photo imported *for* that monument)
alter table sources add column if not exists entity_id bigint references entities(id) on delete set null;

-- Everything imported so far came from Wikipedia
update sources
   set origin = 'web',
       author = 'Wikipedia contributors',
       licence = 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
       source_url = exif_json->'web'->>'url',
       entity_id = (select e.id from entities e where e.id = (sources.exif_json->'web'->>'entity_id')::bigint)
 where type = 'web';

-- Facts read from structured data (Wikidata) rather than extracted by AI
alter table claims drop constraint if exists claims_method_check;
alter table claims add constraint claims_method_check
  check (method in ('ocr', 'llm', 'exif', 'manual', 'import'));

-- Check: published sources and how many are tied to a monument
select origin, count(*) as sources, count(entity_id) as tied_to_a_monument from sources group by origin;

commit;
