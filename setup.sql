-- =====================================================================
-- Anonymous: ONE-STEP DATABASE SETUP
-- Paste ALL of this into Supabase > SQL Editor > New query > Run.
-- It is safe to run again and again. It works on a new OR an existing database.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pgcrypto with schema extensions;

-- ---------- PART 1: usernames and messages ----------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(username) between 3 and 20),
  username_key text not null unique,
  created_at timestamptz default now()
);
alter table public.users add column if not exists auth_id uuid references auth.users(id) on delete cascade;
alter table public.users add column if not exists pin_hash text;   -- PIN so you can log in again on another phone
create unique index if not exists users_auth_id_unique on public.users (auth_id) where auth_id is not null;

create table if not exists public.messages (
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
alter table public.messages add column if not exists delivery_type text not null default 'direct' check (delivery_type in ('direct','public'));
alter table public.messages add column if not exists recipient_auth_id uuid references auth.users(id) on delete set null;
alter table public.messages add column if not exists is_bot boolean not null default false;
create index if not exists messages_to_key on public.messages (to_key);
create index if not exists messages_created on public.messages (created_at desc);
create index if not exists messages_delivery_type_created on public.messages (delivery_type, created_at desc);
create index if not exists messages_recipient_auth_id on public.messages (recipient_auth_id, created_at desc);

-- a private log used only to slow down spammers (nobody can read it from the app)
create table if not exists public.send_log (auth_id uuid not null, at timestamptz not null default now());
create index if not exists send_log_auth_at on public.send_log (auth_id, at desc);
alter table public.send_log enable row level security;
revoke all on public.send_log from anon, authenticated;

-- wrong-PIN counter (locks a username for 15 minutes after 5 wrong tries)
create table if not exists public.pin_attempts (user_key text primary key, fails integer not null default 0, locked_until timestamptz);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

alter table public.users enable row level security;
alter table public.messages enable row level security;
revoke all on public.users from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Everyone can read public posts. Only the recipient can read a direct message.
drop policy if exists "read users" on public.users;
drop policy if exists "add users" on public.users;
drop policy if exists "read messages" on public.messages;
drop policy if exists "add messages" on public.messages;
drop policy if exists "public posts or own direct messages" on public.messages;
create policy "public posts or own direct messages" on public.messages
  for select to anon, authenticated
  using (delivery_type = 'public'
         or (delivery_type = 'direct' and auth.uid() is not null and recipient_auth_id = auth.uid()));
revoke insert, update, delete on public.messages from anon, authenticated;
grant select on public.messages to anon, authenticated;

-- ---------- PART 2: functions the app calls ----------
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select not exists (select 1 from public.users
                      where username_key = lower(btrim(p_username)) and auth_id is not null)
$$;

create or replace function public.username_exists(p_username text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.users
                  where username_key = lower(btrim(p_username)) and auth_id is not null)
$$;

drop function if exists public.claim_username(text);   -- replaced by the version with a PIN
create or replace function public.claim_username(p_username text, p_pin text default null) returns json
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  u text := btrim(p_username);
  k text := lower(btrim(p_username));
  existing public.users%rowtype;
  mine public.users%rowtype;
  handle text;
  tries integer := 0;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if u !~ '^[A-Za-z0-9._]{3,20}$' then raise exception 'invalid_username'; end if;

  -- This account already has a username: give it back (double tap, reload) or refuse a second one.
  select * into mine from public.users where auth_id = auth.uid() limit 1;
  if found then
    if mine.username_key = k or left(mine.username_key, greatest(char_length(mine.username_key) - 5, 0)) = k then
      return json_build_object('username', mine.username);
    end if;
    raise exception 'already_has_username';
  end if;

  -- An old name from before accounts, typed in full: first come, first served.
  select * into existing from public.users where username_key = k and auth_id is null for update;
  if found then
    update public.users set auth_id = auth.uid(),
      pin_hash = case when p_pin is not null and char_length(p_pin) between 4 and 20
                      then extensions.crypt(p_pin, extensions.gen_salt('bf')) else pin_hash end
     where id = existing.id;
    return json_build_object('username', existing.username);
  end if;

  if p_pin is null or char_length(p_pin) < 4 or char_length(p_pin) > 20 then raise exception 'pin_required'; end if;
  if u !~ '^[A-Za-z0-9._]{3,15}$' then raise exception 'invalid_username'; end if;   -- room for the random number

  -- Many people can pick the same name: we add a random 4-digit number, e.g. rjay_4821.
  loop
    tries := tries + 1;
    handle := u || '_' || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    begin
      insert into public.users (username, username_key, auth_id, pin_hash)
      values (handle, lower(handle), auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')));
      return json_build_object('username', handle);
    exception when unique_violation then
      if tries >= 30 then raise exception 'name_busy'; end if;
    end;
  end loop;
end $$;

-- Log in again (new phone, cleared browser): username + PIN. The Inbox moves to this device.
-- It returns ok:false instead of raising, so the wrong-try counter is really saved.
create or replace function public.recover_username(p_username text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare k text := lower(btrim(p_username)); u public.users%rowtype; a public.pin_attempts%rowtype; old uuid;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into a from public.pin_attempts where user_key = k;
  if found and a.locked_until is not null and a.locked_until > now() then
    return json_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  select * into u from public.users where username_key = k for update;
  if not found or u.pin_hash is null or u.pin_hash <> extensions.crypt(coalesce(p_pin, ''), u.pin_hash) then
    if found then
      insert into public.pin_attempts (user_key, fails) values (k, 1)
      on conflict (user_key) do update
        set fails = public.pin_attempts.fails + 1,
            locked_until = case when public.pin_attempts.fails + 1 >= 5 then now() + interval '15 minutes' else public.pin_attempts.locked_until end;
    end if;
    return json_build_object('ok', false, 'error', 'wrong_username_or_pin');
  end if;
  if exists (select 1 from public.users where auth_id = auth.uid() and id <> u.id) then
    return json_build_object('ok', false, 'error', 'already_has_username');
  end if;
  delete from public.pin_attempts where user_key = k;
  old := u.auth_id;
  update public.users set auth_id = auth.uid() where id = u.id;
  if old is not null and old <> auth.uid() then
    update public.messages set recipient_auth_id = auth.uid() where recipient_auth_id = old;
  end if;
  return json_build_object('ok', true, 'username', u.username);
end $$;

create or replace function public.set_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_pin is null or char_length(p_pin) < 4 or char_length(p_pin) > 20 then raise exception 'invalid_pin'; end if;
  update public.users set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where auth_id = auth.uid();
  if not found then raise exception 'no_profile'; end if;
  return true;
end $$;

create or replace function public.my_profile() returns json
language sql security definer set search_path = public, pg_catalog as $$
  select coalesce((select json_build_object('username', username, 'has_pin', pin_hash is not null)
                     from public.users where auth_id = auth.uid() limit 1), '{}'::json)
$$;

create or replace function public.send_message(
  p_type text, p_to_name text, p_to_key text, p_body text,
  p_song text, p_artist text, p_art text default null, p_preview text default null
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
  insert into public.send_log (auth_id) values (auth.uid());
  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview)
  values (btrim(rec_name), lower(btrim(p_to_key)), p_type, rec_auth, btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview)
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.claim_username(text, text), public.recover_username(text, text), public.set_pin(text), public.my_profile(),
  public.send_message(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.claim_username(text, text), public.recover_username(text, text), public.set_pin(text), public.my_profile(),
  public.send_message(text,text,text,text,text,text,text,text) to authenticated;
revoke all on function public.username_available(text), public.username_exists(text) from public;
grant execute on function public.username_available(text), public.username_exists(text) to anon, authenticated;

do $$ begin perform cron.unschedule('anonymous-sendlog-cleanup'); exception when others then null; end $$;
select cron.schedule('anonymous-sendlog-cleanup', '15 3 * * *', $q$delete from public.send_log where at < now() - interval '2 days'$q$);

-- ---------- PART 3: admin accounts (Supabase Auth) ----------
-- Who is an admin is decided ONLY by the table below. It lives outside the user's own profile,
-- and no app user can read or change it, so nobody can make themselves an admin.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;   -- no policies, no grants: SQL Editor only

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
end $$;
revoke all on function public.assert_admin() from public, anon, authenticated;

-- Remove the old passcode system if you ran the earlier bot.sql
drop function if exists public.admin_state(text);
drop function if exists public.admin_set(text, text, text);
drop function if exists public.admin_post_now(text);
drop function if exists public.admin_delete_bots(text);
drop function if exists public.admin_recent(text);
drop function if exists public.admin_delete_msg(text, uuid);
drop function if exists public.admin_ok(text);
drop table if exists public.admin_secret;



-- ---------- PART 4: posting bot + maintenance settings ----------

alter table public.messages add column if not exists is_bot boolean not null default false;

create table if not exists public.settings (key text primary key, value text not null);
insert into public.settings (key, value) values
  ('bot_enabled', 'false'),
  ('bot_interval_min', '15'),
  ('bot_last_run', '1970-01-01T00:00:00Z'),
  ('maintenance', 'false'),
  ('maintenance_note', 'We are making quick fixes. Back soon.')
on conflict (key) do nothing;

create table if not exists public.bot_pool (
  id serial primary key,
  to_name text not null, body text not null, song text not null, artist text not null, art text
);

alter table public.settings enable row level security;
alter table public.bot_pool enable row level security;
drop policy if exists "read settings" on public.settings;
-- Visitors may only read the maintenance flag. Admins read everything through admin_state().
create policy "read settings" on public.settings for select to anon, authenticated
  using (key in ('maintenance', 'maintenance_note'));
grant select on public.settings to anon, authenticated;

-- bot_pool has no policies and no grants: the app cannot touch them directly.

insert into public.bot_pool (to_name, body, song, artist, art)
select * from (values
 ('lyra','you still live in my playlists, pasensya na','Heather','Conan Gray','#3B6E8F'),
 ('kinan','i hope your day is as soft as this song','Sana','I Belong to the Zoo','#2C3E75'),
 ('jensen','kadang i wish i said it sooner, pero eto na','Tingin','Cup of Joe, Janine Tenoso','#3F6B55'),
 ('mil','you were my safe place, even when we drifted','Lucky','Jason Mraz, Colbie Caillat','#9C8F7A'),
 ('rey','no goodbyes, tapi salamat pa rin','Perfect','Ed Sheeran','#D9A441'),
 ('ana','this one is for the quiet days with you','Binibini','Zack Tabudlo','#D4547A'),
 ('jo','sorry sa lahat ng hindi ko nasabi nung kaya ko pa','Multo','Cup of Joe','#5B3A8C'),
 ('mark','pakinggan mo to pag namimiss mo ko, kahit konti','Kathang Isip','Ben&Ben','#4A7A9B'),
 ('tin','ikaw pa rin yung paborito kong kwento','Pasilyo','SunKissed Lola','#C97B4A'),
 ('paolo','hindi ko alam kung nababasa mo to, pero salamat','Pagsamo','Arthur Nery','#2F4858'),
 ('bea','you make ordinary tuesdays feel like something','Die With A Smile','Lady Gaga, Bruno Mars','#8B1E2D'),
 ('carlo','for the days you thought nobody noticed you','Someone You Loved','Lewis Capaldi','#6B7A8F'),
 ('nica','i still save the seat beside me','A Thousand Years','Christina Perri','#9A6A8E'),
 ('migs','tara, ulitin natin yung unang kanta natin','Ere','Juan Karlos','#B5533C'),
 ('shane','kung babalik ka, nandito pa rin ako','Hanggang Kailan','Orange and Lemons','#C8A04A'),
 ('dan','you were the plot twist i did not hate','Mundo','IV of Spades','#3E5C76'),
 ('kia','may kanta tayo, pero wala nang tayo','Tadhana','Up Dharma Down','#55697A'),
 ('ron','thank you for staying when i was hard to love','Sining','Dionela, Jay R','#7A8C5C'),
 ('liza','i hope you hear this and smile','Uhaw','Dilaw','#C9A227'),
 ('ken','para sa araw na gusto ko lang sabihing masaya ako para sayo','Torete','Moonstar88','#6A4C93'),
 ('pia','you are the reason i stay up late, sorry not sorry','Heather','Conan Gray','#3B6E8F'),
 ('gab','sana pala sinabi ko na dati pa','Sana','I Belong to the Zoo','#2C3E75'),
 ('mae','this is my little gift for you','Perfect','Ed Sheeran','#D9A441'),
 ('jun','for the one who always listens first','Lucky','Jason Mraz, Colbie Caillat','#9C8F7A')
) as v(to_name, body, song, artist, art)
where not exists (select 1 from public.bot_pool);

create or replace function public.bot_post() returns void
language plpgsql security definer set search_path = public as $$
declare r public.bot_pool%rowtype;
begin
  select * into r from public.bot_pool
   where body not in (select body from public.messages where is_bot order by created_at desc limit 12)
   order by random() limit 1;
  if not found then select * into r from public.bot_pool order by random() limit 1; end if;
  if not found then return; end if;
  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, is_bot)
  values (r.to_name, 'public', 'public', null, r.body, r.song, r.artist, r.art, true);
end $$;
revoke all on function public.bot_post() from public, anon, authenticated;

create or replace function public.bot_tick() returns void
language plpgsql security definer set search_path = public as $$
declare en text; iv int; lr timestamptz;
begin
  select value into en from public.settings where key = 'bot_enabled';
  if en is distinct from 'true' then return; end if;
  select value::int into iv from public.settings where key = 'bot_interval_min';
  select value::timestamptz into lr from public.settings where key = 'bot_last_run';
  if now() - lr >= make_interval(mins => greatest(iv, 1)) - interval '30 seconds' then
    perform public.bot_post();
    update public.settings
       set value = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
     where key = 'bot_last_run';
  end if;
end $$;
revoke all on function public.bot_tick() from public, anon, authenticated;

-- Admin functions: they run only for a signed-in user listed in public.admins.
create or replace function public.admin_state() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return json_build_object('ok', true,
    'settings', (select json_object_agg(key, value) from public.settings),
    'users', (select count(*) from public.users),
    'messages', (select count(*) from public.messages),
    'bots', (select count(*) from public.messages where is_bot),
    'pool', (select count(*) from public.bot_pool));
end $$;

create or replace function public.admin_set(k text, v text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if k not in ('bot_enabled', 'bot_interval_min', 'maintenance', 'maintenance_note') then raise exception 'unknown setting'; end if;
  if k in ('bot_enabled', 'maintenance') and v not in ('true', 'false') then raise exception 'must be true or false'; end if;
  if k = 'bot_interval_min' then
    if v !~ '^[0-9]{1,4}$' then raise exception 'minutes must be a number'; end if;
    v := greatest(1, least(v::int, 1440))::text;
  end if;
  update public.settings set value = left(v, 200) where key = k;
  return true;
end $$;

create or replace function public.admin_post_now() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  perform public.bot_post();
  return true;
end $$;

create or replace function public.admin_delete_bots() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.assert_admin();
  delete from public.messages where is_bot;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_recent() returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select id, to_name, left(body, 120) as body, song, is_bot, created_at
      from public.messages order by created_at desc limit 30) t;
  return out;
end $$;

create or replace function public.admin_delete_msg(mid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.messages where id = mid;
  return true;
end $$;

revoke all on function public.admin_state(), public.admin_set(text, text), public.admin_post_now(),
  public.admin_delete_bots(), public.admin_recent(), public.admin_delete_msg(uuid) from public, anon;
grant execute on function public.admin_state(), public.admin_set(text, text), public.admin_post_now(),
  public.admin_delete_bots(), public.admin_recent(), public.admin_delete_msg(uuid) to authenticated;

-- Run the bot check every minute (it only posts when the bot is ON and the interval has passed)
do $$ begin perform cron.unschedule('anonymous-bot'); exception when others then null; end $$;
select cron.schedule('anonymous-bot', '* * * * *', 'select public.bot_tick()');


-- ---------- PART 5: support tickets + knowledge base ----------
-- Visitors can only (a) create a ticket with consent and (b) look up THEIR ticket with its secret code.
-- Only admins (public.admins) can read or change tickets and the knowledge base.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity,
  code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  summary text not null check (char_length(summary) between 5 and 2000),
  consent boolean not null default true check (consent),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved')),
  admin_response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_status_created on public.support_tickets (status, created_at desc);

create table if not exists public.kb_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'general' check (char_length(category) between 1 and 60),
  problem text not null check (char_length(problem) between 5 and 1000),
  response text not null check (char_length(response) between 5 and 2000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  source_ticket uuid references public.support_tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kb_status on public.kb_entries (status);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists tickets_touch on public.support_tickets;
create trigger tickets_touch before update on public.support_tickets for each row execute function public.touch_updated_at();
drop trigger if exists kb_touch on public.kb_entries;
create trigger kb_touch before update on public.kb_entries for each row execute function public.touch_updated_at();

alter table public.support_tickets enable row level security;
alter table public.kb_entries enable row level security;
drop policy if exists "admin tickets" on public.support_tickets;
drop policy if exists "admin kb" on public.kb_entries;
create policy "admin tickets" on public.support_tickets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin kb" on public.kb_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.support_tickets, public.kb_entries from anon;
grant select, insert, update, delete on public.support_tickets, public.kb_entries to authenticated;
grant select on public.kb_entries to service_role;   -- the chatbot function reads APPROVED entries only

-- A visitor creates a ticket only after agreeing; they get a private code to check it later.
create or replace function public.create_ticket(p_summary text, p_consent boolean) returns json
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  if p_consent is not true then raise exception 'consent required' using errcode = '22023'; end if;
  if (select count(*) from public.support_tickets where created_at > now() - interval '1 minute') >= 10 then
    raise exception 'busy, try again soon' using errcode = '54000';
  end if;
  insert into public.support_tickets (summary) values (left(trim(coalesce(p_summary, '')), 2000)) returning * into t;
  return json_build_object('ticket_no', t.ticket_no, 'code', t.code);
end $$;

-- A visitor sees status and the admin reply only for the code they hold, and only once an admin really replied.
create or replace function public.ticket_status(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('ticket_no', ticket_no, 'status', status,
    'admin_response', case when responded_at is not null then admin_response end,
    'responded_at', responded_at, 'created_at', created_at)
  from public.support_tickets where code = p_code
$$;
revoke all on function public.create_ticket(text, boolean), public.ticket_status(text) from public;
grant execute on function public.create_ticket(text, boolean), public.ticket_status(text) to anon, authenticated;

-- Admin overview now includes ticket numbers
create or replace function public.admin_state() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return json_build_object('ok', true,
    'settings', (select json_object_agg(key, value) from public.settings),
    'users', (select count(*) from public.users),
    'messages', (select count(*) from public.messages),
    'bots', (select count(*) from public.messages where is_bot),
    'pool', (select count(*) from public.bot_pool),
    'tickets_pending', (select count(*) from public.support_tickets where status = 'pending'),
    'tickets_total', (select count(*) from public.support_tickets),
    'kb_approved', (select count(*) from public.kb_entries where status = 'approved'));
end $$;
revoke all on function public.admin_state() from public, anon;
grant execute on function public.admin_state() to authenticated;

-- Privacy: resolved tickets are deleted automatically after 90 days.
do $$ begin perform cron.unschedule('anonymous-ticket-cleanup'); exception when others then null; end $$;
select cron.schedule('anonymous-ticket-cleanup', '0 3 * * *',
  $q$delete from public.support_tickets where status = 'resolved' and updated_at < now() - interval '90 days'$q$);


-- Daily cap for the AI chat, so a surprise bill is impossible (the function reads it with the service role).
create table if not exists public.chat_usage (day date primary key, n integer not null default 0);
alter table public.chat_usage enable row level security;
revoke all on public.chat_usage from anon, authenticated;
create or replace function public.chat_allow(p_cap integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare c integer;
begin
  insert into public.chat_usage (day, n) values (current_date, 1)
  on conflict (day) do update set n = public.chat_usage.n + 1 returning n into c;
  return c <= p_cap;
end $$;
revoke all on function public.chat_allow(integer) from public, anon, authenticated;
grant execute on function public.chat_allow(integer) to service_role;

notify pgrst, 'reload schema';

-- ---------- PART: reactions on public posts ----------
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  auth_id uuid not null,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz default now(),
  primary key (message_id, auth_id)
);
create index if not exists reactions_message on public.reactions (message_id);
alter table public.reactions enable row level security;
revoke all on public.reactions from anon, authenticated;
grant select on public.reactions to anon, authenticated;

-- anyone signed in can read reaction counts; only own row can be written via RPC
drop policy if exists "read reactions" on public.reactions;
create policy "read reactions" on public.reactions for select to anon, authenticated using (true);

create or replace function public.toggle_reaction(p_message_id uuid, p_emoji text)
returns json
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  existing text;
  counts json;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if p_emoji is null or char_length(p_emoji) < 1 or char_length(p_emoji) > 8 then
    raise exception 'invalid_emoji';
  end if;
  -- only allow reacting to public posts
  if not exists (select 1 from public.messages where id = p_message_id and delivery_type = 'public') then
    raise exception 'not_public';
  end if;
  select emoji into existing from public.reactions
   where message_id = p_message_id and auth_id = auth.uid();
  if existing is not null and existing = p_emoji then
    delete from public.reactions where message_id = p_message_id and auth_id = auth.uid();
  else
    insert into public.reactions (message_id, auth_id, emoji)
    values (p_message_id, auth.uid(), p_emoji)
    on conflict (message_id, auth_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
  select coalesce(json_object_agg(emoji, c), '{}'::json) into counts
  from (select emoji, count(*)::int as c from public.reactions where message_id = p_message_id group by emoji) s;
  return json_build_object('counts', counts, 'mine', (
    select emoji from public.reactions where message_id = p_message_id and auth_id = auth.uid()
  ));
end $$;

create or replace function public.reaction_counts(p_ids uuid[])
returns json
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(json_object_agg(message_id::text, counts), '{}'::json)
  from (
    select message_id,
           json_build_object(
             'counts', (select coalesce(json_object_agg(emoji, c), '{}'::json)
                        from (select emoji, count(*)::int as c from public.reactions r2
                              where r2.message_id = r.message_id group by emoji) x),
             'mine', (select emoji from public.reactions r3
                      where r3.message_id = r.message_id and r3.auth_id = auth.uid() limit 1)
           ) as counts
    from public.reactions r
    where message_id = any(p_ids)
    group by message_id
  ) t;
$$;

revoke all on function public.toggle_reaction(uuid, text), public.reaction_counts(uuid[]) from public, anon;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;
grant execute on function public.reaction_counts(uuid[]) to anon, authenticated;

-- optional parent for soft threading (public replies)
alter table public.messages add column if not exists parent_id uuid references public.messages(id) on delete set null;
create index if not exists messages_parent on public.messages (parent_id) where parent_id is not null;

-- extend send_message to accept optional parent_id
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
  -- parent only allowed for public posts, and must itself be public
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
-- Only ONE send_message may exist. A second (8-argument) copy makes PostgREST answer HTTP 300
-- "could not choose the best candidate function", and posting fails with "Database error (300)".
drop function if exists public.send_message(text,text,text,text,text,text,text,text);

notify pgrst, 'reload schema';


-- =====================================================================
-- PART 7. Upgrades (kasama na rito para hindi mabalik sa luma kapag ni-run ulit ang setup.sql)
-- =====================================================================

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


-- Run once in the Supabase SQL editor. Profile photo, card style, and link views.
alter table public.users add column if not exists avatar text check (avatar is null or char_length(avatar) <= 120000);
alter table public.users add column if not exists card_style jsonb check (card_style is null or char_length(card_style::text) <= 300000);
alter table public.users add column if not exists link_views integer not null default 0;

create or replace function public.my_profile() returns json
language sql security definer set search_path = public, pg_catalog as $$
  select coalesce((select json_build_object('username', username, 'has_pin', pin_hash is not null, 'avatar', avatar, 'card', card_style, 'views', coalesce(link_views, 0))
                     from public.users where auth_id = auth.uid() limit 1), '{}'::json)
$$;

create or replace function public.set_avatar(p_avatar text) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if p_avatar is not null and (p_avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or char_length(p_avatar) > 120000) then
    raise exception 'invalid_image'; end if;
  update public.users set avatar = p_avatar where auth_id = auth.uid();
  if not found then raise exception 'no_profile'; end if;
  return true;
end $$;

create or replace function public.set_card_style(p_card jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if p_card is not null then
    if coalesce(p_card->>'kind', '') not in ('grad','color','photo') then raise exception 'invalid_style'; end if;
    if (p_card->>'kind') = 'photo' and (p_card->>'v') !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then raise exception 'invalid_image'; end if;
    if char_length(p_card::text) > 300000 then raise exception 'too_large'; end if;
  end if;
  update public.users set card_style = p_card where auth_id = auth.uid();
  if not found then raise exception 'no_profile'; end if;
  return true;
end $$;

create or replace function public.record_link_view(p_username text)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  n integer;
begin
  if p_username is null or char_length(btrim(p_username)) < 3 then
    return 0;
  end if;
  update public.users
     set link_views = coalesce(link_views, 0) + 1
   where lower(username) = lower(btrim(p_username))
  returning link_views into n;
  return coalesce(n, 0);
end $$;

revoke all on function public.set_avatar(text), public.set_card_style(jsonb), public.my_profile(), public.record_link_view(text) from public, anon;
grant execute on function public.set_avatar(text), public.set_card_style(jsonb), public.my_profile() to authenticated;
grant execute on function public.record_link_view(text) to anon, authenticated;

-- Public card + photo: lets people who open someone's link see that person's photo and card design.
create or replace function public.public_profile(p_username text)
returns json
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select json_build_object('username', username, 'avatar', avatar, 'card', card_style)
                     from public.users
                    where lower(username) = lower(btrim(p_username)) limit 1), '{}'::json)
$$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;

-- Card designs for several usernames at once (used by Browse). Returns {"name": card, ...} for people who made a design.
create or replace function public.public_cards(p_names text[])
returns json
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(json_object_agg(lower(username), card_style), '{}'::json)
    from public.users
   where card_style is not null
     and lower(username) = any (select lower(btrim(x)) from unnest(p_names[1:60]) as x)
$$;
revoke all on function public.public_cards(text[]) from public;
grant execute on function public.public_cards(text[]) to anon, authenticated;

-- ---------- Sender's card design travels with the post (so everybody sees it) ----------
alter table public.messages add column if not exists card jsonb check (card is null or char_length(card::text) <= 300000);

-- send_message now takes p_use_card. The design is copied from the SENDER'S saved profile on the server (never from the browser).
drop function if exists public.send_message(text,text,text,text,text,text,text,text,uuid);
drop function if exists public.send_message(text,text,text,text,text,text,text,text,uuid,boolean);
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
  return new_id;
end $$;
revoke all on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) from public, anon;
grant execute on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) to authenticated;
