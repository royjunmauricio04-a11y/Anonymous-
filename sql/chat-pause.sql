-- chat-pause.sql
-- Run this ONCE in Supabase > SQL Editor. Safe to run again.
-- Adds the "Pause Support Buddy" switch (Maintenance Center > Controls).
-- When paused, the AI chat stops answering, but people can still send their concern to you (admin tickets).

insert into public.settings (key, value) values ('chat_paused', 'false') on conflict (key) do nothing;

drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select to anon, authenticated
  using (key in ('maintenance', 'maintenance_note', 'announcement', 'chat_paused'));

create or replace function public.admin_set(k text, v text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if k not in ('bot_enabled', 'bot_interval_min', 'maintenance', 'maintenance_note', 'announcement', 'chat_paused') then raise exception 'unknown setting'; end if;
  if k in ('bot_enabled', 'maintenance', 'chat_paused') and v not in ('true', 'false') then raise exception 'must be true or false'; end if;
  if k = 'bot_interval_min' then
    if v !~ '^[0-9]{1,4}$' then raise exception 'minutes must be a number'; end if;
    v := greatest(1, least(v::int, 1440))::text;
  end if;
  insert into public.settings (key, value) values (k, left(v, 200))
  on conflict (key) do update set value = excluded.value;
  return true;
end $$;
