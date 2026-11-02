-- =====================================================================
-- Anonymous: REPLY UPGRADE — anonymous replies to Inbox senders
-- Run ONCE in Supabase > SQL Editor (after setup.sql + safety-upgrade.sql).
-- It is safe to run again.
--
-- What it adds: the owner of a private Inbox message can reply with a song.
-- The reply lands in the SENDER'S Inbox. The sender never learns anything
-- new (they chose who to message), and the recipient still never learns
-- who the sender was. Blocks and rate limits still apply.
-- =====================================================================

create or replace function public.send_reply(
  p_parent_id uuid, p_body text, p_song text, p_artist text,
  p_art text default null, p_preview text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare s uuid; rec_name text; new_id uuid;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_body,''))) < 1 or char_length(p_body) > 5000 then raise exception 'invalid_message'; end if;
  if char_length(btrim(coalesce(p_song,''))) < 1 or char_length(p_song) > 200 then raise exception 'invalid_song'; end if;
  if char_length(btrim(coalesce(p_artist,''))) < 1 or char_length(p_artist) > 200 then raise exception 'invalid_artist'; end if;
  if exists (select 1 from public.blocked_words w
              where lower(p_body) like '%' || lower(w.word) || '%') then
    raise exception 'blocked_content' using errcode = '22023';
  end if;
  if (select count(*) from public.send_log where auth_id = auth.uid() and at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- only the recipient of the private message may reply, and only when the
  -- hidden sender code exists (messages from before safety-upgrade.sql cannot be replied to)
  select ms.sender_auth_id into s
    from public.message_senders ms
   where ms.message_id = p_parent_id
     and exists (select 1 from public.messages m
                  where m.id = p_parent_id
                    and m.delivery_type = 'direct'
                    and m.recipient_auth_id = auth.uid());
  if s is null then raise exception 'reply_not_available' using errcode = 'P0002'; end if;

  -- if that sender blocked this account, the reply politely fails
  if exists (select 1 from public.blocks where recipient_auth_id = s and blocked_auth_id = auth.uid()) then
    raise exception 'blocked_sender' using errcode = 'P0001';
  end if;

  select username into rec_name from public.users where auth_id = auth.uid() limit 1;

  insert into public.messages (to_name, to_key, delivery_type, recipient_auth_id, body, song, artist, art, preview, parent_id)
  values ('@' || coalesce(rec_name, 'someone'), 'reply:' || p_parent_id::text, 'direct', s,
          btrim(p_body), btrim(p_song), btrim(p_artist), p_art, p_preview, p_parent_id)
  returning id into new_id;

  insert into public.send_log (auth_id) values (auth.uid());
  return new_id;
end $$;

revoke all on function public.send_reply(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.send_reply(uuid, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
