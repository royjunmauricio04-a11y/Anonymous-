-- =====================================================================
-- Anonymous: ONE-STEP DATABASE SETUP
-- Paste ALL of this into Supabase > SQL Editor > New query > Run.
-- It is safe to run again and again. It works on a new OR an existing database.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------- PART 1: usernames and messages ----------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(username) between 3 and 20),
  username_key text not null unique,
  created_at timestamptz default now()
);
alter table public.users add column if not exists auth_id uuid references auth.users(id) on delete cascade;
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

create or replace function public.claim_username(p_username text) returns json
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  u text := btrim(p_username);
  k text := lower(btrim(p_username));
  existing public.users%rowtype;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if u !~ '^[A-Za-z0-9._]{3,20}$' then raise exception 'invalid_username'; end if;
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
  insert into public.users (username, username_key, auth_id) values (u, k, auth.uid());
  return json_build_object('username', u);
end $$;

create or replace function public.my_profile() returns json
language sql security definer set search_path = public, pg_catalog as $$
  select coalesce((select json_build_object('username', username) from public.users where auth_id = auth.uid() limit 1), '{}'::json)
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

revoke all on function public.claim_username(text), public.my_profile(),
  public.send_message(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.claim_username(text), public.my_profile(),
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

notify pgrst, 'reload schema';
