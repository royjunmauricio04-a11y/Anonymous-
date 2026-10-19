-- Safety upgrade CHECK (run this last)
-- You should see: new_tables = 3, new_functions = 4, send_message_versions = 1
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('message_senders','blocks','link_view_log')) as new_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('block_sender','block_count','unblock_all','my_recent_views')) as new_functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_message') as send_message_versions;
