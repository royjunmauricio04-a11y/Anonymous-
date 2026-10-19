-- Safety upgrade: PART 1 of 4
-- Paste ALL of this, press Run, wait for Success, then do PART 2. Safe to run again.

-- =====================================================================
-- SAFETY UPGRADE: block abusive senders, report private messages, recent views
-- Safe to run again. Run after the base setup. Nothing here reveals who a sender is.
-- =====================================================================

-- For every PRIVATE message the system keeps a private code of the sender's device account.
-- It is used only to stop a blocked sender. No screen, no admin page and no API can read it.
create table if not exists public.message_senders (
  message_id uuid primary key references public.messages(id) on delete cascade,
  sender_auth_id uuid not null
);

alter table public.message_senders enable row level security;

revoke all on public.message_senders from anon, authenticated;

create table if not exists public.blocks (
  recipient_auth_id uuid not null,
  blocked_auth_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (recipient_auth_id, blocked_auth_id)
);

alter table public.blocks enable row level security;

revoke all on public.blocks from anon, authenticated;

-- One row per link open: only the time. No device, no place, no person.
create table if not exists public.link_view_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.users(id) on delete cascade,
  at timestamptz not null default now()
);

create index if not exists link_view_log_owner_at on public.link_view_log (owner_id, at desc);

alter table public.link_view_log enable row level security;

revoke all on public.link_view_log from anon, authenticated;

-- Only ONE send_message may exist (two versions make every send fail).
drop function if exists public.send_message(text,text,text,text,text,text,text,text);

drop function if exists public.send_message(text,text,text,text,text,text,text,text,uuid);
