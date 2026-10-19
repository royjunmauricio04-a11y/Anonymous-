-- Safety upgrade: PART 3 of 4
-- Paste ALL of this, press Run, wait for Success, then do PART 4. Safe to run again.

-- Block the sender of a private message. The receiver never learns who it was.
create or replace function public.block_sender(p_message_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.messages where id = p_message_id and delivery_type = 'direct' and recipient_auth_id = auth.uid()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select sender_auth_id into s from public.message_senders where message_id = p_message_id;
  if s is null then return json_build_object('ok', false, 'error', 'older_message'); end if;
  insert into public.blocks (recipient_auth_id, blocked_auth_id) values (auth.uid(), s) on conflict do nothing;
  return json_build_object('ok', true);
end $$;

create or replace function public.block_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.blocks where recipient_auth_id = auth.uid()
$$;

create or replace function public.unblock_all() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'login_required' using errcode = '42501'; end if;
  delete from public.blocks where recipient_auth_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- Every link open is now also logged with its time (the total counter still works as before).
create or replace function public.record_link_view(p_username text)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer; uid uuid;
begin
  if p_username is null or char_length(btrim(p_username)) < 3 then return 0; end if;
  update public.users set link_views = coalesce(link_views, 0) + 1
   where lower(username) = lower(btrim(p_username))
  returning link_views, id into n, uid;
  if uid is not null then insert into public.link_view_log (owner_id) values (uid); end if;
  return coalesce(n, 0);
end $$;

create or replace function public.my_recent_views() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(q.at order by q.at desc), '[]'::json) from (
    select l.at from public.link_view_log l
     where l.owner_id = (select u.id from public.users u where u.auth_id = auth.uid() limit 1)
     order by l.at desc limit 30) q
$$;

-- The admin report list now says if a reported message was private.
create or replace function public.admin_reports(p_status text default 'open') returns json
language plpgsql security definer set search_path = public as $$
declare out json;
begin
  perform public.assert_admin();
  select coalesce(json_agg(t), '[]'::json) into out from (
    select r.id, r.message_id, r.reason, r.note, r.status, r.created_at, m.delivery_type,
           m.to_name, left(m.body, 400) as body, m.song, m.artist,
           (select count(*) from public.reports r2 where r2.message_id = r.message_id) as report_count
      from public.reports r left join public.messages m on m.id = r.message_id
     where p_status = 'all' or r.status = p_status
     order by r.created_at desc limit 100) t;
  return out;
end $$;

revoke all on function public.report_message(uuid, text, text), public.block_sender(uuid), public.block_count(),
  public.unblock_all(), public.my_recent_views() from public, anon;

grant execute on function public.report_message(uuid, text, text), public.block_sender(uuid), public.block_count(),
  public.unblock_all(), public.my_recent_views() to authenticated;

revoke all on function public.admin_reports(text) from public, anon;
