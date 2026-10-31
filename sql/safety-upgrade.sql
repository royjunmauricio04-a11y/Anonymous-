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
create or replace function public.send_message(
  p_type text, p_to_name text, p_to_key text, p_body text,
  p_song text, p_artist text, p_art text default null, p_preview text default null,
  p_parent_id uuid default null, p_use_card boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare rec_auth uuid; rec_name text; new_id uuid; sender_card jsonb;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_type not in ('public','direct') then raise exception 'invalid_delivery_type'; end if;
  if char_length(btrim(coalesce(p_body,''))) < 1 or char_length(p_body) > 5000 then raise exception 'invalid_message'; end if;
  if char_length(btrim(coalesce(p_to_name,''))) < 1 or char_length(p_to_name) > 40 then raise exception 'invalid_recipient'; end if;
  if char_length(btrim(coalesce(p_song,''))) < 1 or char_length(p_song) > 200 then raise exception 'invalid_song'; end if;
  if char_length(btrim(coalesce(p_artist,''))) < 1 or char_length(p_artist) > 200 then raise exception 'invalid_artist'; end if;
  if exists (select 1 from public.blocked_words w
              where lower(p_body || ' ' || p_to_name) like '%' || lower(w.word) || '%') then
    raise exception 'blocked_content' using errcode = '22023';
  end if;
  if (select count(*) from public.send_log where auth_id = auth.uid() and at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if p_type = 'direct' then
    select auth_id, username into rec_auth, rec_name from public.users
     where username_key = lower(btrim(p_to_key)) and auth_id is not null limit 1;
    if rec_auth is null then raise exception 'recipient_not_found' using errcode = 'P0002'; end if;
    if exists (select 1 from public.blocks where recipient_auth_id = rec_auth and blocked_auth_id = auth.uid()) then
      raise exception 'blocked_sender' using errcode = 'P0001';
    end if;
  else
    rec_auth := null; rec_name := btrim(p_to_name);
  end if;
  if p_parent_id is not null then
    if p_type <> 'public' then raise exception 'parent_public_only'; end if;
    if not exists (select 1 from public.messages where id = p_parent_id and delivery_type = 'public') then
      raise exception 'parent_not_found';
    end if;
  end if;
  if coalesce(p_use_card, false) then
    select card_style into sender_card from public.users where auth_id = auth.uid() limit 1;
  end if;
  insert into public.send_log (auth_id) values (auth.uid());
  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview, parent_id, card)
  values (btrim(rec_name), lower(btrim(p_to_key)), p_type, rec_auth, btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview, p_parent_id, sender_card)
  returning id into new_id;
  if p_type = 'direct' then   -- private code so the receiver can block abuse; never shown in the app
    insert into public.message_senders (message_id, sender_auth_id) values (new_id, auth.uid());
  end if;
  return new_id;
end $$;
revoke all on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) from public, anon;
grant execute on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) to authenticated;

-- Receivers can now report a PRIVATE message too (the only way an admin ever reads one).
create or replace function public.report_message(p_message_id uuid, p_reason text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into m from public.messages where id = p_message_id;
  if not found or (m.delivery_type = 'direct' and m.recipient_auth_id is distinct from auth.uid()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.reports (message_id, reporter, reason, note)
  values (p_message_id, auth.uid(), p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  on conflict (message_id, reporter) do nothing;
  return true;
end $$;

-- Block the sender of a private message. The receiver never learns who it was.
create or replace function public.block_sender(p_message_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and delivery_type = 'direct' and recipient_auth_id = auth.uid()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select sender_auth_id into s from public.message_senders where message_id = p_message_id;
  if s is null then return json_build_object('ok', false, 'error', 'older_message'); end if;
  insert into public.blocks (recipient_auth_id, blocked_auth_id) values (auth.uid(), s) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function public.block_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.blocks where recipient_auth_id = auth.uid()
$$;

create or replace function public.unblock_all() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  delete from public.blocks where recipient_auth_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- Every link open is now also logged with its time (the total counter still works as before).
create or replace function public.record_link_view(p_username text)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer; uid uuid;
begin
  if p_username is null or char_length(btrim(p_username)) < 3 then return 0; end if;
  update public.users set link_views = coalesce(link_views, 0) + 1
   where lower(username) = lower(btrim(p_username))
  returning link_views, id into n, uid;
  if uid is not null then insert into public.link_view_log (owner_id) values (uid); end if;
  return coalesce(n, 0);
end $$;

create or replace function public.my_recent_views() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(q.at order by q.at desc), '[]'::json) from (
    select l.at from public.link_view_log l
     where l.owner_id = (select u.id from public.users u where u.auth_id = auth.uid() limit 1)
     order by l.at desc limit 30) q
$$;

-- The admin report list now says if a reported message was private.
create or replace function public.admin_reports(p_status text default 'open') returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select r.id, r.message_id, r.reason, r.note, r.status, r.created_at, m.delivery_type,
           m.to_name, left(m.body, 400) as body, m.song, m.artist,
           (select count(*) from public.reports r2 where r2.message_id = r.message_id) as report_count
      from public.reports r left join public.messages m on m.id = r.message_id
     where p_status = 'all' or r.status = p_status
     order by r.created_at desc limit 100) t;
  return out;
end $$;

revoke all on function public.report_message(uuid, text, text), public.block_sender(uuid), public.block_count(),
  public.unblock_all(), public.my_recent_views() from public, anon;
grant execute on function public.report_message(uuid, text, text), public.block_sender(uuid), public.block_count(),
  public.unblock_all(), public.my_recent_views() to authenticated;
revoke all on function public.admin_reports(text) from public, anon;
grant execute on function public.admin_reports(text) to authenticated;

-- Privacy: the view log is kept for 60 days only.
do $$ begin perform cron.unschedule('anonymous-viewlog-cleanup'); exception when others then null; end $$;
select cron.schedule('anonymous-viewlog-cleanup', '30 3 * * *',
  $q$delete from public.link_view_log where at < now() - interval '60 days'$q$);

notify pgrst, 'reload schema';
