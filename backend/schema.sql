-- KathaGraph schema. Run once in Supabase -> SQL Editor.
create extension if not exists vector;

-- Every uploaded file (photo, pdf, note, csv)
create table if not exists sources (
  id           bigserial primary key,
  type         text not null check (type in ('photo','pdf','note','csv')),
  filename     text not null,
  file_url     text,
  exif_json    jsonb,
  lat          double precision,
  lng          double precision,
  captured_at  timestamptz,
  status       text not null default 'pending'
               check (status in ('pending','processing','done','failed')),
  error        text,
  created_at   timestamptz not null default now()
);

-- Text pulled out of a source (OCR / parsing), split into searchable pieces
create table if not exists chunks (
  id         bigserial primary key,
  source_id  bigint not null references sources(id) on delete cascade,
  page       int,
  text       text not null,
  language   text,
  embedding  vector(384)   -- size of paraphrase-multilingual-MiniLM-L12-v2
);
create index if not exists chunks_source_idx on chunks(source_id);

-- Real-world things: monuments, motifs, crafts
create table if not exists entities (
  id          bigserial primary key,
  name        text not null,
  type        text not null check (type in ('monument','motif','craft','place','person')),
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

-- Variant names / spellings / scripts for the same entity
create table if not exists entity_aliases (
  entity_id  bigint not null references entities(id) on delete cascade,
  alias      text not null,
  language   text,
  primary key (entity_id, alias)
);

-- A single fact as stated by a single source. Never "the truth" by itself.
create table if not exists claims (
  id          bigserial primary key,
  entity_id   bigint not null references entities(id) on delete cascade,
  field       text not null,          -- e.g. built_date, builder, material
  value       text not null,
  source_id   bigint not null references sources(id) on delete cascade,
  chunk_id    bigint references chunks(id) on delete set null,
  method      text not null check (method in ('ocr','llm','exif','manual')),
  confidence  real check (confidence between 0 and 1),
  status      text not null default 'unverified'
              check (status in ('unverified','verified','rejected')),
  created_at  timestamptz not null default now()
);
create index if not exists claims_entity_field_idx on claims(entity_id, field);

-- What a complete record of an entity type should include
create table if not exists checklist_items (
  id             bigserial primary key,
  entity_type    text not null,
  required_item  text not null,       -- e.g. 'interior_photo', 'built_date'
  label          text not null        -- human-readable
);

-- Which sources are evidence for which entity
create table if not exists entity_sources (
  entity_id  bigint not null references entities(id) on delete cascade,
  source_id  bigint not null references sources(id) on delete cascade,
  tag        text,                    -- e.g. 'interior_photo', 'inscription'
  primary key (entity_id, source_id)
);

-- Conflicts = same entity + same field, more than one distinct value
create or replace view claim_conflicts as
select entity_id, field, array_agg(distinct value) as values, count(*) as n_claims
from claims
where status <> 'rejected'
group by entity_id, field
having count(distinct value) > 1;

-- Starter checklist for monuments
insert into checklist_items (entity_type, required_item, label) values
  ('monument','exterior_photo','Exterior photograph'),
  ('monument','interior_photo','Interior / structural photograph'),
  ('monument','inscription','Inscription photo or transcription'),
  ('monument','built_date','Date of construction'),
  ('monument','builder','Builder / patron'),
  ('monument','location','Reliable GPS location')
on conflict do nothing;
