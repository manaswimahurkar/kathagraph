-- Contributor accounts and "My contributions" (v1.4)
create table if not exists users (
  id            bigserial primary key,
  email         text not null unique,
  name          text not null,
  reason        text,                -- "What brought you here?"
  password_hash text not null,       -- salted scrypt, never the password
  created_at    timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,       -- SHA-256 of the sign-in token, never the token
  user_id    bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);
alter table users enable row level security;
alter table sessions enable row level security;

alter table sources add column if not exists contributor_id bigint references users(id) on delete set null;
alter table claims add column if not exists reviewed_by bigint references users(id) on delete set null;
alter table claims add column if not exists reviewed_at timestamptz;
create index if not exists sources_contributor_idx on sources(contributor_id);
create index if not exists claims_reviewer_idx on claims(reviewed_by);
select 'ok' as result;
