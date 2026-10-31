-- FIX: posts do not load because anon / logged-in accounts lost read access to public.messages.
-- Run once in Supabase > SQL Editor. Safe to re-run. Row level security still hides other people's direct messages.
grant usage on schema public to anon, authenticated;
grant select on public.messages to anon, authenticated;
