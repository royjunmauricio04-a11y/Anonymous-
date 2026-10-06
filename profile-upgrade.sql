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
