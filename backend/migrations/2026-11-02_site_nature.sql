-- Built, natural or settlement: what kind of site each monument is (v1.2)
alter table entities add column if not exists nature text not null default 'built';
alter table entities drop constraint if exists entities_nature_check;
alter table entities add constraint entities_nature_check check (nature in ('built', 'natural', 'settlement'));
alter table entities add column if not exists nature_source text;  -- 'wikidata' or 'manual' (manual is never overwritten)

-- Decided by hand
update entities set nature = 'natural', nature_source = 'manual' where id in (70, 65, 56, 78);   -- Girnar, Bet Dwarka, Narayan Sarovar, Shyamalvan
update entities set nature = 'settlement', nature_source = 'manual' where id in (50, 4, 5, 6);  -- Lakhpat, Lothal, Dholavira, Champaner-Pavagadh
update entities set nature = 'built', nature_source = 'manual'
  where id in (26, 8, 33, 17, 9, 62, 55, 27, 28, 37, 30, 25, 23, 68);

-- Dholavira: 2021 is the year it became a World Heritage Site, not when it was built
update claims set status = 'rejected' where entity_id = 5 and field = 'built_date' and value = '2021';

-- Rani ki Vav on the map (from its Wikipedia article)
update entities set lat = 23.8589, lng = 72.1017, coord_precision = 'exact' where id = 2 and lat is null;

select id, name, nature from entities where nature <> 'built' order by nature, name;
