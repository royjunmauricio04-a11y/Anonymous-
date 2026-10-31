-- =====================================================================
-- card-share-upgrade.sql   (run ONCE in Supabase > SQL Editor; safe to run again)
-- Run it AFTER setup.sql, admin-upgrade.sql, profile-upgrade.sql and safety-upgrade.sql.
--
-- What it fixes: a sender's card design (photo, gradient, colour) must be visible to EVERYONE who sees the post.
-- Before: the whole design (a photo can be 200 KB) was copied onto every post, so Browse downloaded it 50 times.
-- Now:    each distinct design is stored ONCE (card_styles). A post only holds a small id (messages.card_id).
-- =====================================================================

-- stop early, with a clear message, if an earlier script has not been run
do $$ begin
  if to_regclass('public.blocked_words') is null then raise exception 'Run admin-upgrade.sql first (blocked_words is missing)'; end if;
  if to_regclass('public.message_senders') is null or to_regclass('public.blocks') is null then raise exception 'Run safety-upgrade.sql first (blocks / message_senders are missing)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'card_style') then
    raise exception 'Run profile-upgrade.sql first (users.card_style is missing)';
  end if;
end $$;

-- 1. one row per distinct design
create table if not exists public.card_styles (
  id uuid primary key default gen_random_uuid(),
  digest text not null unique,
  style jsonb not null check (char_length(style::text) <= 300000),
  created_at timestamptz not null default now()
);
alter table public.card_styles enable row level security;
revoke all on public.card_styles from anon, authenticated;   -- only the functions below can read it

alter table public.messages add column if not exists card jsonb;   -- legacy: designs used to be copied onto each post (kept empty from now on)
alter table public.messages add column if not exists card_id uuid references public.card_styles(id) on delete set null;
create index if not exists messages_card_id on public.messages (card_id) where card_id is not null;

-- 2. move designs that were saved on posts into the shared table (then free the space)
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'card' and data_type = 'jsonb') then
    insert into public.card_styles (digest, style)
      select distinct on (md5(card::text)) md5(card::text), card from public.messages where card is not null
      on conflict (digest) do nothing;
    update public.messages m set card_id = c.id, card = null
      from public.card_styles c where m.card is not null and c.digest = md5(m.card::text);
  end if;
end $$;

-- 3. read designs by id (anyone who can see a post may see its design; ids are random, nothing else is exposed)
create or replace function public.get_cards(p_ids uuid[]) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(id::text, style), '{}'::json)
    from public.card_styles where id = any (p_ids[1:40]);
$$;
revoke all on function public.get_cards(uuid[]) from public;
grant execute on function public.get_cards(uuid[]) to anon, authenticated;

-- 4. send_message: same as safety-upgrade.sql (blocks, private sender code) + the design is stored once and linked by id
drop function if exists public.send_message(text,text,text,text,text,text,text,text);
drop function if exists public.send_message(text,text,text,text,text,text,text,text,uuid);
create or replace function public.send_message(
  p_type text, p_to_name text, p_to_key text, p_body text,
  p_song text, p_artist text, p_art text default null, p_preview text default null,
  p_parent_id uuid default null, p_use_card boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare rec_auth uuid; rec_name text; new_id uuid; sender_card jsonb; sender_card_id uuid;
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
    select card_style into sender_card from public.users where auth_id = auth.uid() limit 1;   -- from the saved profile, never from the browser
    if sender_card is not null then
      insert into public.card_styles (digest, style) values (md5(sender_card::text), sender_card) on conflict (digest) do nothing;
      select id into sender_card_id from public.card_styles where digest = md5(sender_card::text);
    end if;
  end if;
  insert into public.send_log (auth_id) values (auth.uid());
  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview, parent_id, card_id)
  values (btrim(rec_name), lower(btrim(p_to_key)), p_type, rec_auth, btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview, p_parent_id, sender_card_id)
  returning id into new_id;
  if p_type = 'direct' then   -- private code so the receiver can block abuse; never shown in the app
    insert into public.message_senders (message_id, sender_auth_id) values (new_id, auth.uid());
  end if;
  return new_id;
end $$;
revoke all on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) from public, anon;
grant execute on function public.send_message(text,text,text,text,text,text,text,text,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';

-- Check: this must list exactly ONE send_message (with p_use_card).
select p.oid::regprocedure as send_message_versions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'send_message';
