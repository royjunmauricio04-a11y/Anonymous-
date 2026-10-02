-- Run this once in Supabase: SQL Editor > New query > Run
create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(username) between 3 and 20),
  username_key text not null unique,
  created_at timestamptz default now()
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  to_name text not null,
  to_key text not null,
  body text not null check (char_length(body) between 1 and 5000),
  song text not null,
  artist text not null,
  art text,
  preview text,
  created_at timestamptz default now()
);
create index on messages (to_key);
create index on messages (created_at desc);
alter table users enable row level security;
alter table messages enable row level security;
-- Anyone can read and add. Nobody can edit or delete.
create policy "read users" on users for select using (true);
create policy "add users" on users for insert with check (true);
create policy "read messages" on messages for select using (true);
create policy "add messages" on messages for insert with check (true);
