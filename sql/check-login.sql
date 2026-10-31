-- CHECK: why do posts not load for a logged-in account?
-- Run this whole thing once in Supabase > SQL Editor. It only READS, it changes nothing.
-- Every row should say OK. Copy any row that does not say OK and send it to me.

select 'anon can read messages' as what,
  case when has_table_privilege('anon', 'public.messages', 'select') then 'OK'
       else 'PROBLEM. Run: grant select on public.messages to anon, authenticated;' end as result
union all
select 'logged-in accounts can read messages',
  case when has_table_privilege('authenticated', 'public.messages', 'select') then 'OK'
       else 'PROBLEM. Run: grant select on public.messages to anon, authenticated;' end
union all
select 'messages.card_id exists (card designs)',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'card_id') then 'OK'
       else 'MISSING. Run card-share-upgrade.sql (the app still works without it, but designs are not shared)' end
union all
select 'logged-in accounts can read messages.card_id',
  case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'card_id') then 'skipped (column missing)'
       when has_column_privilege('authenticated', 'public.messages', 'card_id', 'select') then 'OK'
       else 'PROBLEM. Run: grant select on public.messages to anon, authenticated;' end
union all
select 'row level security is on for messages',
  case when (select relrowsecurity from pg_class where oid = 'public.messages'::regclass) then 'OK' else 'PROBLEM. Run: alter table public.messages enable row level security;' end
union all
select 'a public-posts read policy exists for logged-in accounts',
  case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and cmd in ('SELECT', 'ALL')
                      and ('authenticated' = any(roles) or 'public' = any(roles))) then 'OK'
       else 'PROBLEM. Run setup.sql part about "public posts or own direct messages"' end
union all
select 'function ' || f.sig || ' for ' || f.role,
  case when to_regprocedure('public.' || f.sig) is null then 'MISSING. Run setup.sql / card-share-upgrade.sql'
       when has_function_privilege(f.role, to_regprocedure('public.' || f.sig), 'execute') then 'OK'
       else 'PROBLEM. Run: grant execute on function public.' || f.sig || ' to anon, authenticated;' end
from (values
  ('reaction_counts(uuid[])', 'anon'), ('reaction_counts(uuid[])', 'authenticated'),
  ('get_cards(uuid[])', 'anon'), ('get_cards(uuid[])', 'authenticated'),
  ('public_cards(text[])', 'anon'), ('public_cards(text[])', 'authenticated'),
  ('my_profile()', 'authenticated'), ('toggle_reaction(uuid, text)', 'authenticated')
) as f(sig, role)
union all
select 'public posts in the database', (select count(*)::text from public.messages where delivery_type = 'public')
union all
select 'policies on messages', coalesce((select string_agg(policyname || ' [' || array_to_string(roles, ',') || ']', '; ') from pg_policies where schemaname = 'public' and tablename = 'messages'), 'none');
