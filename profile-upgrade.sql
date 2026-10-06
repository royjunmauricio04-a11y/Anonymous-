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
