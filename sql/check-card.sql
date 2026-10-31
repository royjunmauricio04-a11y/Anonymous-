-- check-card.sql: run in Supabase > SQL Editor. Read-only. It shows ONE table: each row is a check, the result says OK or what to run.
-- Use it to find out why a card design is not visible to other accounts.
select 'posts can point to a shared design (messages.card_id)' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'card_id')
            then 'OK' else 'MISSING: run card-share-upgrade.sql' end as result
union all
select 'function get_cards exists',
       case when to_regprocedure('public.get_cards(uuid[])') is not null then 'OK' else 'MISSING: run card-share-upgrade.sql' end
union all
select 'send_message can attach a design (p_use_card)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'send_message' and 'p_use_card' = any (p.proargnames))
            then 'OK' else 'MISSING: run profile-upgrade.sql, then card-share-upgrade.sql' end
union all
select 'number of send_message copies (must be 1)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_message')
union all
select 'people who saved a card design in Profile',
       (select count(*)::text from public.users where card_style is not null)
union all
select 'of the 10 newest public posts, how many carry a design',
       (select count(*)::text from (select to_jsonb(x) as j from public.messages x where x.delivery_type = 'public' order by x.created_at desc limit 10) t
         where t.j ->> 'card_id' is not null or t.j ->> 'card' is not null);
