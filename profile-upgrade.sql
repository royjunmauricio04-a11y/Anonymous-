-- Run once in the Supabase SQL editor. Adds profile photo + message-card style.
alter table public.users add column if not exists avatar text check (avatar is null or char_length(avatar) <= 120000);
alter table public.users add column if not exists card_style jsonb check (card_style is null or char_length(card_style::text) <= 300000);

create or replace function public.my_profile() returns json
language sql security definer set search_path = public, pg_catalog as $$
  select coalesce((select json_build_object('username', username, 'has_pin', pin_hash is not null, 'avatar', avatar, 'card', card_style)
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

revoke all on function public.set_avatar(text), public.set_card_style(jsonb), public.my_profile() from public, anon;
grant execute on function public.set_avatar(text), public.set_card_style(jsonb), public.my_profile() to authenticated;
