-- admin-upgrade.sql
-- Run this ONCE in Supabase > SQL Editor (after setup.sql). It is safe to run again.
-- Adds: reports, blocked words, announcement banner, bot pool tools, user list, richer stats.
-- Privacy rule kept: admins can NOT read private direct messages. Messages do not store who sent them.

-- ---------- 1. Announcement banner (shown to everyone) ----------
insert into public.settings (key, value) values ('announcement', '') on conflict (key) do nothing;

drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select to anon, authenticated
  using (key in ('maintenance', 'maintenance_note', 'announcement'));

-- ---------- 2. Reports on public posts ----------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  reporter uuid not null,
  reason text not null check (reason in ('hate', 'harassment', 'sexual', 'selfharm', 'spam', 'other')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  unique (message_id, reporter)
);
create index if not exists reports_status_created on public.reports (status, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;   -- only the functions below can touch it

create or replace function public.report_message(p_message_id uuid, p_reason text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and delivery_type = 'public') then
    raise exception 'not_public' using errcode = 'P0002';
  end if;
  if (select count(*) from public.reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into public.reports (message_id, reporter, reason, note)
  values (p_message_id, auth.uid(), p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''))
  on conflict (message_id, reporter) do nothing;
  return true;
end $$;
revoke all on function public.report_message(uuid, text, text) from public, anon;
grant execute on function public.report_message(uuid, text, text) to authenticated;

-- ---------- 3. Blocked words (checked on the server when someone sends) ----------
create table if not exists public.blocked_words (
  word text primary key check (char_length(word) between 2 and 40),
  created_at timestamptz not null default now()
);
alter table public.blocked_words enable row level security;
revoke all on public.blocked_words from anon, authenticated;

-- same as the latest send_message in setup.sql, plus the blocked-words check.
-- The old 8-argument copy must not exist (it causes HTTP 300), so remove it first.
drop function if exists public.send_message(text,text,text,text,text,text,text,text);
create or replace function public.send_message(
  p_type text, p_to_name text, p_to_key text, p_body text,
  p_song text, p_artist text, p_art text default null, p_preview text default null,
  p_parent_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare rec_auth uuid; rec_name text; new_id uuid;
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
  else
    rec_auth := null; rec_name := btrim(p_to_name);
  end if;
  if p_parent_id is not null then
    if p_type <> 'public' then raise exception 'parent_public_only'; end if;
    if not exists (select 1 from public.messages where id = p_parent_id and delivery_type = 'public') then
      raise exception 'parent_not_found';
    end if;
  end if;
  insert into public.send_log (auth_id) values (auth.uid());
  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview, parent_id)
  values (btrim(rec_name), lower(btrim(p_to_key)), p_type, rec_auth, btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview, p_parent_id)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.send_message(text,text,text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.send_message(text,text,text,text,text,text,text,text,uuid) to authenticated;

-- ---------- 4. Admin functions ----------
-- Stats for the dashboard: totals, today, and the last 7 days.
create or replace function public.admin_stats() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return json_build_object(
    'users', (select count(*) from public.users),
    'users_today', (select count(*) from public.users where created_at >= date_trunc('day', now())),
    'public_total', (select count(*) from public.messages where delivery_type = 'public' and not is_bot),
    'direct_total', (select count(*) from public.messages where delivery_type = 'direct'),
    'bot_total', (select count(*) from public.messages where is_bot),
    'messages_today', (select count(*) from public.messages where created_at >= date_trunc('day', now()) and not is_bot),
    'reactions', (select count(*) from public.reactions),
    'reports_open', (select count(*) from public.reports where status = 'open'),
    'tickets_pending', (select count(*) from public.support_tickets where status = 'pending'),
    'chat_today', coalesce((select n from public.chat_usage where day = current_date), 0),
    'blocked_words', (select count(*) from public.blocked_words),
    'days', (select coalesce(json_agg(d order by d.day), '[]'::json) from (
        select g.day::date as day,
               (select count(*) from public.messages m where m.created_at::date = g.day::date and not m.is_bot) as messages,
               (select count(*) from public.users u where u.created_at::date = g.day::date) as users
          from generate_series(current_date - 6, current_date, interval '1 day') as g(day)) d)
  );
end $$;

-- Public posts only (private direct messages stay private). Optional search and filter.
create or replace function public.admin_posts(p_search text default null, p_kind text default 'all', p_limit integer default 40, p_before timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select m.id, m.to_name, left(m.body, 400) as body, m.song, m.artist, m.is_bot, m.created_at,
           (select count(*) from public.reactions r where r.message_id = m.id) as reactions,
           (select count(*) from public.reports rp where rp.message_id = m.id and rp.status = 'open') as open_reports
      from public.messages m
     where m.delivery_type = 'public'
       and (p_kind = 'all' or (p_kind = 'bot' and m.is_bot) or (p_kind = 'people' and not m.is_bot))
       and (p_search is null or p_search = '' or m.body ilike '%' || p_search || '%' or m.to_name ilike '%' || p_search || '%' or m.song ilike '%' || p_search || '%')
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 40), 100))) t;
  return out;
end $$;

create or replace function public.admin_reports(p_status text default 'open') returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select r.id, r.message_id, r.reason, r.note, r.status, r.created_at,
           m.to_name, left(m.body, 400) as body, m.song, m.artist,
           (select count(*) from public.reports r2 where r2.message_id = r.message_id) as report_count
      from public.reports r left join public.messages m on m.id = r.message_id
     where p_status = 'all' or r.status = p_status
     order by r.created_at desc limit 100) t;
  return out;
end $$;

-- action: 'dismiss' keeps the post; 'delete' removes the post and closes all its reports.
create or replace function public.admin_resolve_report(p_id uuid, p_action text) returns boolean
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  perform public.assert_admin();
  select message_id into mid from public.reports where id = p_id;
  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed' where message_id = mid and status = 'open';
  elsif p_action = 'delete' then
    update public.reports set status = 'actioned' where message_id = mid and status = 'open';
    delete from public.messages where id = mid and delivery_type = 'public';
  else
    raise exception 'unknown action';
  end if;
  return true;
end $$;

create or replace function public.admin_words() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return (select coalesce(json_agg(word order by word), '[]'::json) from public.blocked_words);
end $$;
create or replace function public.admin_word_add(p_word text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  insert into public.blocked_words (word) values (lower(btrim(p_word))) on conflict do nothing;
  return true;
end $$;
create or replace function public.admin_word_del(p_word text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.blocked_words where word = lower(btrim(p_word));
  return true;
end $$;

-- Bot message pool (so you no longer need SQL to change what the bot posts)
create or replace function public.admin_pool() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return (select coalesce(json_agg(p order by p.id desc), '[]'::json) from public.bot_pool p);
end $$;
create or replace function public.admin_pool_add(p_to text, p_body text, p_song text, p_artist text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if char_length(btrim(coalesce(p_to,''))) < 1 or char_length(btrim(coalesce(p_body,''))) < 1
     or char_length(btrim(coalesce(p_song,''))) < 1 or char_length(btrim(coalesce(p_artist,''))) < 1 then
    raise exception 'fill every field';
  end if;
  insert into public.bot_pool (to_name, body, song, artist, art)
  values (left(btrim(p_to), 40), left(btrim(p_body), 500), left(btrim(p_song), 200), left(btrim(p_artist), 200), '#E5334B');
  return true;
end $$;
create or replace function public.admin_pool_del(p_id integer) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.bot_pool where id = p_id;
  return true;
end $$;

-- Usernames (no PINs, no messages, no auth ids are returned)
create or replace function public.admin_users(p_search text default null, p_limit integer default 50) returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select u.id, u.username, u.created_at, (u.pin_hash is not null) as has_pin,
           (select count(*) from public.messages m where m.recipient_auth_id = u.auth_id) as inbox_count
      from public.users u
     where p_search is null or p_search = '' or u.username_key like '%' || lower(p_search) || '%'
     order by u.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) t;
  return out;
end $$;

-- Remove a username and its login (their Inbox goes with it). Use for abuse or by request.
create or replace function public.admin_delete_user(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare a uuid;
begin
  perform public.assert_admin();
  select auth_id into a from public.users where id = p_id;
  if a is not null and exists (select 1 from public.admins where user_id = a) then
    raise exception 'cannot delete an admin';
  end if;
  delete from public.users where id = p_id;
  if a is not null then delete from auth.users where id = a; end if;
  return true;
end $$;

-- Let the admin panel also change the announcement
create or replace function public.admin_set(k text, v text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if k not in ('bot_enabled', 'bot_interval_min', 'maintenance', 'maintenance_note', 'announcement') then raise exception 'unknown setting'; end if;
  if k in ('bot_enabled', 'maintenance') and v not in ('true', 'false') then raise exception 'must be true or false'; end if;
  if k = 'bot_interval_min' then
    if v !~ '^[0-9]{1,4}$' then raise exception 'minutes must be a number'; end if;
    v := greatest(1, least(v::int, 1440))::text;
  end if;
  insert into public.settings (key, value) values (k, left(v, 200))
  on conflict (key) do update set value = excluded.value;
  return true;
end $$;

-- Recent list: public posts only now (it used to include private direct messages)
create or replace function public.admin_recent() returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select id, to_name, left(body, 120) as body, song, is_bot, created_at
      from public.messages where delivery_type = 'public' order by created_at desc limit 30) t;
  return out;
end $$;

revoke all on function public.admin_stats(), public.admin_posts(text, text, integer, timestamptz), public.admin_reports(text),
  public.admin_resolve_report(uuid, text), public.admin_words(), public.admin_word_add(text), public.admin_word_del(text),
  public.admin_pool(), public.admin_pool_add(text, text, text, text), public.admin_pool_del(integer),
  public.admin_users(text, integer), public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_stats(), public.admin_posts(text, text, integer, timestamptz), public.admin_reports(text),
  public.admin_resolve_report(uuid, text), public.admin_words(), public.admin_word_add(text), public.admin_word_del(text),
  public.admin_pool(), public.admin_pool_add(text, text, text, text), public.admin_pool_del(integer),
  public.admin_users(text, integer), public.admin_delete_user(uuid) to authenticated;

notify pgrst, 'reload schema';
