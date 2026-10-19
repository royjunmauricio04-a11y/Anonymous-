-- Safety upgrade: PART 2 of 4
-- Paste ALL of this, press Run, wait for Success, then do PART 3. Safe to run again.

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
