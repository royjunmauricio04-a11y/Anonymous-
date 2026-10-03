-- Anonymous: account + private Inbox + public anonymous posts.
-- Run this AFTER the existing schema.sql / previous delivery-mode migration.
-- Safe to run again.

alter table public.users
  add column if not exists auth_id uuid references auth.users(id) on delete cascade;
create unique index if not exists users_auth_id_unique on public.users(auth_id) where auth_id is not null;

alter table public.messages
  add column if not exists recipient_auth_id uuid references auth.users(id) on delete set null;
alter table public.messages
  add column if not exists is_bot boolean not null default false;
create index if not exists messages_recipient_auth_id on public.messages(recipient_auth_id, created_at desc);

alter table public.messages
  add column if not exists delivery_type text not null default 'direct'
  check (delivery_type in ('direct','public'));
create index if not exists messages_delivery_type_created on public.messages (delivery_type, created_at desc);

alter table public.users enable row level security;
alter table public.messages enable row level security;

-- Client-side table access is intentionally limited. Profiles are handled by RPCs
-- so auth_id is never exposed through a normal REST select.
drop policy if exists "read users" on public.users;
drop policy if exists "add users" on public.users;
drop policy if exists "user own profile" on public.users;

revoke all on public.users from anon, authenticated;
grant usage on schema public to anon, authenticated;

drop policy if exists "public posts or own direct messages" on public.messages;
drop policy if exists "read messages" on public.messages;
drop policy if exists "add messages" on public.messages;
create policy "public posts or own direct messages" on public.messages
  for select to anon, authenticated
  using (
    delivery_type = 'public'
    or (delivery_type = 'direct' and auth.uid() is not null and recipient_auth_id = auth.uid())
  );

revoke insert, update, delete on public.messages from anon, authenticated;
grant select on public.messages to anon, authenticated;

create or replace function public.claim_username(p_username text)
returns json
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  u text := btrim(p_username);
  k text := lower(btrim(p_username));
  existing public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = '42501';
  end if;
  if u !~ '^[A-Za-z0-9._]{3,20}$' then
    raise exception 'invalid_username';
  end if;

  select * into existing from public.users where username_key = k for update;
  if found then
    if existing.auth_id is null then
      update public.users set auth_id = auth.uid() where id = existing.id;
      return json_build_object('username', existing.username);
    elsif existing.auth_id = auth.uid() then
      return json_build_object('username', existing.username);
    else
      raise exception 'username_taken' using errcode = '23505';
    end if;
  end if;

  insert into public.users (username, username_key, auth_id)
  values (u, k, auth.uid());
  return json_build_object('username', u);
end;
$$;

create or replace function public.my_profile()
returns json
language sql
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select json_build_object('username', username)
       from public.users
      where auth_id = auth.uid()
      limit 1),
    '{}'::json
  );
$$;

create or replace function public.send_message(
  p_type text,
  p_to_name text,
  p_to_key text,
  p_body text,
  p_song text,
  p_artist text,
  p_art text default null,
  p_preview text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  rec_auth uuid;
  rec_name text;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'login_required' using errcode = '42501';
  end if;
  if p_type not in ('public','direct') then
    raise exception 'invalid_delivery_type';
  end if;
  if char_length(btrim(coalesce(p_body,''))) < 1 or char_length(p_body) > 5000 then
    raise exception 'invalid_message';
  end if;
  if char_length(btrim(coalesce(p_to_name,''))) < 1 or char_length(p_to_name) > 40 then
    raise exception 'invalid_recipient';
  end if;
  if char_length(btrim(coalesce(p_song,''))) < 1 or char_length(p_song) > 200 then
    raise exception 'invalid_song';
  end if;
  if char_length(btrim(coalesce(p_artist,''))) < 1 or char_length(p_artist) > 200 then
    raise exception 'invalid_artist';
  end if;

  if p_type = 'direct' then
    select auth_id, username into rec_auth, rec_name
      from public.users
     where username_key = lower(btrim(p_to_key))
       and auth_id is not null
     limit 1;
    if rec_auth is null then
      raise exception 'recipient_not_found' using errcode = 'P0002';
    end if;
  else
    rec_auth := null;
    rec_name := btrim(p_to_name);
  end if;

  insert into public.messages
    (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview)
  values
    (btrim(rec_name), lower(btrim(p_to_key)), p_type, rec_auth, btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.claim_username(text) from public, anon;
revoke all on function public.my_profile() from public, anon;
revoke all on function public.send_message(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.claim_username(text), public.my_profile(),
  public.send_message(text,text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
