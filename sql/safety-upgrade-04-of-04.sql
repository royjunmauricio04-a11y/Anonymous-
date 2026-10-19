-- Safety upgrade: PART 4 of 4
-- Paste ALL of this, press Run, wait for Success, then do sql/safety-check.sql. Safe to run again.

grant execute on function public.admin_reports(text) to authenticated;

-- Privacy: the view log is kept for 60 days only.
do $$ begin perform cron.unschedule('anonymous-viewlog-cleanup'); exception when others then null; end $$;

select cron.schedule('anonymous-viewlog-cleanup', '30 3 * * *',
  $q$delete from public.link_view_log where at < now() - interval '60 days'$q$);

notify pgrst, 'reload schema';
