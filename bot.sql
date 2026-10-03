-- Anonymous: posting bot + maintenance center. Run AFTER schema.sql. Safe to run again.
-- Supabase > SQL Editor > New query > paste all > Run.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

alter table public.messages add column if not exists is_bot boolean not null default false;
alter table public.messages add column if not exists delivery_type text not null default 'direct' check (delivery_type in ('direct','public'));
alter table public.messages add column if not exists recipient_auth_id uuid references auth.users(id) on delete set null;
create index if not exists messages_recipient_auth_id on public.messages(recipient_auth_id, created_at desc);

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
create table if not exists public.admin_secret (
  id int primary key default 1 check (id = 1),
  hash text not null, fails int not null default 0, locked_until timestamptz
);

alter table public.settings enable row level security;
alter table public.bot_pool enable row level security;
alter table public.admin_secret enable row level security;
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
grant select on public.settings to anon;
-- bot_pool and admin_secret have no policies and no grants: the app cannot touch them directly.

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

-- Passcode check (bcrypt, locks for 5 minutes after 5 wrong tries). Not callable by the app directly.
create or replace function public.admin_ok(p text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare s public.admin_secret%rowtype;
begin
  select * into s from public.admin_secret where id = 1;
  if not found then return false; end if;
  if s.locked_until is not null and s.locked_until > now() then return false; end if;
  if s.hash = extensions.crypt(p, s.hash) then
    update public.admin_secret set fails = 0, locked_until = null where id = 1;
    return true;
  end if;
  update public.admin_secret
     set fails = fails + 1,
         locked_until = case when fails + 1 >= 5 then now() + interval '5 minutes' else locked_until end
   where id = 1;
  return false;
end $$;
revoke all on function public.admin_ok(text) from public, anon, authenticated;

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

-- Maintenance center functions (all need the passcode)
create or replace function public.admin_state(p text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p) then return json_build_object('ok', false); end if;
  return json_build_object('ok', true,
    'settings', (select json_object_agg(key, value) from public.settings),
    'users', (select count(*) from public.users),
    'messages', (select count(*) from public.messages),
    'bots', (select count(*) from public.messages where is_bot),
    'pool', (select count(*) from public.bot_pool));
end $$;

create or replace function public.admin_set(p text, k text, v text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p) then return false; end if;
  if k not in ('bot_enabled', 'bot_interval_min', 'maintenance', 'maintenance_note') then return false; end if;
  if k in ('bot_enabled', 'maintenance') and v not in ('true', 'false') then return false; end if;
  if k = 'bot_interval_min' then
    if v !~ '^[0-9]{1,4}$' then return false; end if;
    v := greatest(1, least(v::int, 1440))::text;
  end if;
  update public.settings set value = left(v, 200) where key = k;
  return true;
end $$;

create or replace function public.admin_post_now(p text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p) then return false; end if;
  perform public.bot_post();
  return true;
end $$;

create or replace function public.admin_delete_bots(p text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.admin_ok(p) then return -1; end if;
  delete from public.messages where is_bot;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_recent(p text) returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  if not public.admin_ok(p) then return '[]'::json; end if;
  select coalesce(json_agg(t), '[]'::json) into out from (
    select id, to_name, left(body, 120) as body, song, is_bot, created_at
      from public.messages order by created_at desc limit 30) t;
  return out;
end $$;

create or replace function public.admin_delete_msg(p text, mid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p) then return false; end if;
  delete from public.messages where id = mid;
  return true;
end $$;

grant execute on function public.admin_state(text), public.admin_set(text, text, text),
  public.admin_post_now(text), public.admin_delete_bots(text), public.admin_recent(text),
  public.admin_delete_msg(text, uuid) to anon, authenticated;

-- Run the bot check every minute (it only posts when the bot is ON and the interval has passed)
do $$ begin perform cron.unschedule('anonymous-bot'); exception when others then null; end $$;
select cron.schedule('anonymous-bot', '* * * * *', 'select public.bot_tick()');

notify pgrst, 'reload schema';
