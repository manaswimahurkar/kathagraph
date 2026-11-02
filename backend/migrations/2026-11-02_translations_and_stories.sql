-- English translations of Hindi / Gujarati documents, and the "stories read" flag (v1.1)
create table if not exists translations (
  source_id  bigint not null references sources(id) on delete cascade,
  page       int not null default 0,
  text_en    text not null,
  created_at timestamptz not null default now(),
  primary key (source_id, page)
);
alter table translations enable row level security;
alter table sources add column if not exists stories_checked boolean not null default false;
select 'ok' as result;
