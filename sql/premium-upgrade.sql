-- =====================================================================
-- PREMIUM UPGRADE: free trial, price + trial length editable in Admin, sender tag + hints,
-- longer Recent views. Run once in Supabase > SQL Editor. Safe to run again.
-- Nothing here reveals who a sender is: no location, no device, no phone, no IP.
-- A "sender tag" is a random-looking code that is DIFFERENT for every receiver and cannot be
-- turned back into a person. It only tells you "these messages came from the same sender".
-- =====================================================================

-- Settings the admin can change (Admin > Controls > Premium)
insert into public.settings (key, value) values
  ('premium_price',       '99'),
  ('premium_period_days', '30'),
  ('premium_trial_days',  '3'),
  ('premium_pay_note',    'Message us on GCash to get Premium.')
on conflict (key) do nothing;

-- Who has Premium and when. No policies and no grants: only the functions below touch it.
create table if not exists public.premium (
  auth_id uuid primary key references auth.users(id) on delete cascade,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  premium_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.premium enable row level security;
revoke all on public.premium from anon, authenticated;

create or replace function public._setting_int(k text, d integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select case when value ~ '^[0-9]{1,6}$' then value::int end from public.settings where key = k), d)
$$;
revoke all on function public._setting_int(text, integer) from public, anon, authenticated;

create or replace function public._is_premium(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.premium p
                  where p.auth_id = a and (coalesce(p.premium_until, '-infinity') > now() or coalesce(p.trial_ends_at, '-infinity') > now()))
$$;
revoke all on function public._is_premium(uuid) from public, anon, authenticated;

-- What the app needs to draw the Premium card.
create or replace function public.premium_status() returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.premium%rowtype; paid boolean; tri boolean; days integer;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into p from public.premium where auth_id = auth.uid();
  paid := coalesce(p.premium_until, '-infinity') > now();
  tri  := coalesce(p.trial_ends_at, '-infinity') > now();
  days := public._setting_int('premium_trial_days', 3);
  return json_build_object(
    'active', paid or tri,
    'source', case when paid then 'paid' when tri then 'trial' else 'none' end,
    'until', case when paid or tri then greatest(coalesce(p.premium_until, '-infinity'), coalesce(p.trial_ends_at, '-infinity')) end,
    'trial_available', p.trial_started_at is null and days > 0,
    'trial_used', p.trial_started_at is not null,
    'trial_days', days,
    'price', (select value from public.settings where key = 'premium_price'),
    'period_days', public._setting_int('premium_period_days', 30),
    'pay_note', (select value from public.settings where key = 'premium_pay_note'));
end $$;

-- One free trial per account.
create or replace function public.start_trial() returns json
language plpgsql security definer set search_path = public as $$
declare days integer;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  days := public._setting_int('premium_trial_days', 3);
  if days < 1 then raise exception 'trial_off' using errcode = 'P0001'; end if;
  insert into public.premium (auth_id) values (auth.uid()) on conflict do nothing;
  update public.premium set trial_started_at = now(), trial_ends_at = now() + make_interval(days => days), updated_at = now()
   where auth_id = auth.uid() and trial_started_at is null;
  if not found then raise exception 'trial_used' using errcode = 'P0001'; end if;
  return public.premium_status();
end $$;

-- Hints for ONE private message you received.
-- Free: the sender tag. Premium: how many messages that tag sent you, first/last time, time of day.
create or replace function public.message_hints(p_message_id uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare m public.messages%rowtype; s uuid; prem boolean; n integer; first_at timestamptz; last_at timestamptz; h integer; tag text;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  select * into m from public.messages where id = p_message_id and delivery_type = 'direct' and recipient_auth_id = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select sender_auth_id into s from public.message_senders where message_id = p_message_id;
  if s is null then return json_build_object('tag', null); end if;
  tag := 'user_' || substr(md5(auth.uid()::text || ':' || s::text || ':anon-tag'), 1, 6);
  prem := public._is_premium(auth.uid());
  if not prem then return json_build_object('tag', tag, 'premium', false); end if;
  select count(*), min(m2.created_at), max(m2.created_at) into n, first_at, last_at
    from public.message_senders ms join public.messages m2 on m2.id = ms.message_id
   where ms.sender_auth_id = s and m2.recipient_auth_id = auth.uid();
  h := extract(hour from m.created_at at time zone 'Asia/Manila')::int;
  return json_build_object('tag', tag, 'premium', true, 'count', n, 'first_at', first_at, 'last_at', last_at,
    'time_of_day', case when h between 5 and 11 then 'morning' when h between 12 and 17 then 'afternoon' when h between 18 and 21 then 'evening' else 'late night' end);
end $$;

-- Recent views: free accounts see the latest 5, Premium sees up to 50.
create or replace function public.my_recent_views() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(q.at order by q.at desc), '[]'::json) from (
    select l.at from public.link_view_log l
     where l.owner_id = (select u.id from public.users u where u.auth_id = auth.uid() limit 1)
     order by l.at desc
     limit (case when public._is_premium(auth.uid()) then 50 else 5 end)) q
$$;

-- ---------- admin ----------
create or replace function public.admin_premium_get() returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return json_build_object(
    'price', (select value from public.settings where key = 'premium_price'),
    'period_days', (select value from public.settings where key = 'premium_period_days'),
    'trial_days', (select value from public.settings where key = 'premium_trial_days'),
    'pay_note', (select value from public.settings where key = 'premium_pay_note'),
    'active', (select coalesce(json_agg(t), '[]'::json) from (
        select u.username, p.premium_until, p.trial_ends_at
          from public.premium p join public.users u on u.auth_id = p.auth_id
         where coalesce(p.premium_until, '-infinity') > now() or coalesce(p.trial_ends_at, '-infinity') > now()
         order by greatest(coalesce(p.premium_until, '-infinity'), coalesce(p.trial_ends_at, '-infinity')) desc limit 100) t));
end $$;

create or replace function public.admin_premium_set(p_price text, p_period_days integer, p_trial_days integer, p_pay_note text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_price is null or p_price !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then raise exception 'price must be a number'; end if;
  if p_period_days is null or p_period_days < 1 or p_period_days > 3650 then raise exception 'period must be 1 to 3650 days'; end if;
  if p_trial_days is null or p_trial_days < 0 or p_trial_days > 365 then raise exception 'trial must be 0 to 365 days'; end if;
  insert into public.settings (key, value) values
    ('premium_price', p_price), ('premium_period_days', p_period_days::text),
    ('premium_trial_days', p_trial_days::text), ('premium_pay_note', left(coalesce(p_pay_note, ''), 200))
  on conflict (key) do update set value = excluded.value;
  return true;
end $$;

create or replace function public.admin_grant_premium(p_username text, p_days integer) returns json
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  perform public.assert_admin();
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'days must be 1 to 3650'; end if;
  select auth_id into a from public.users where username_key = lower(btrim(p_username)) and auth_id is not null limit 1;
  if a is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  insert into public.premium (auth_id, premium_until) values (a, now() + make_interval(days => p_days))
  on conflict (auth_id) do update
    set premium_until = greatest(coalesce(public.premium.premium_until, now()), now()) + make_interval(days => p_days), updated_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_revoke_premium(p_username text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  perform public.assert_admin();
  select auth_id into a from public.users where username_key = lower(btrim(p_username)) and auth_id is not null limit 1;
  if a is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  update public.premium set premium_until = null, trial_ends_at = null, updated_at = now() where auth_id = a;
  return true;
end $$;

revoke all on function public.premium_status(), public.start_trial(), public.message_hints(uuid), public.my_recent_views(),
  public.admin_premium_get(), public.admin_premium_set(text, integer, integer, text),
  public.admin_grant_premium(text, integer), public.admin_revoke_premium(text) from public, anon;
grant execute on function public.premium_status(), public.start_trial(), public.message_hints(uuid), public.my_recent_views(),
  public.admin_premium_get(), public.admin_premium_set(text, integer, integer, text),
  public.admin_grant_premium(text, integer), public.admin_revoke_premium(text) to authenticated;
