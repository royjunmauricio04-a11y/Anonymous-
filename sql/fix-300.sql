-- fix-300.sql
-- Fixes "Database error (300)" when posting. Run once in Supabase > SQL Editor. Safe to run again.
--
-- Cause: two copies of send_message exist (8 and 9 arguments). PostgREST cannot choose between them
-- and answers HTTP 300. We keep only the 9-argument one (it already accepts the same 8 values).

drop function if exists public.send_message(text,text,text,text,text,text,text,text);

-- Check: this must return exactly ONE row.
select p.oid::regprocedure as send_message_versions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'send_message';

-- Same check for every other function: any name listed here has more than one copy.
select p.proname as function_name, count(*) as copies
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 group by p.proname having count(*) > 1;

notify pgrst, 'reload schema';
