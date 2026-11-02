-- =====================================================================
-- Anonymous: BOT UPGRADE — bring the friendly feed bots to life
-- Run ONCE in Supabase > SQL Editor (after setup.sql). Safe to run again.
--
-- What it does:
--   1. Adds new cute bot lines to the bot_pool (more variety).
--   2. Switches the bots ON (bot_enabled = 'true') at a friendly pace:
--      one bot post every 90 minutes. Change it anytime in admin.html.
--   3. If Browse has no bot posts yet, posts a first batch and spreads
--      it over the last two days, so the feed looks alive at once.
--
-- The bots only post PUBLIC notes on Browse (never to an Inbox), they
-- are always labeled with a BOT badge, they never count in Trending,
-- and you can pause, post, or delete them anytime in admin.html.
-- =====================================================================

-- 1) more cute lines for the pool (each one is added only if it is not there yet)
insert into public.bot_pool (to_name, body, song, artist, art)
select v.to_name, v.body, v.song, v.artist, v.art from (values
 ('puyat club','uwian na. kanta muna bago matulog — goodnight, internet friend.','Raining in Manila','Lola Amour','#35506E'),
 ('crush mo yan (oo, ikaw)','wag kang magpaka-mysterious, kausapin mo na. eto muna: kanta para sa confidence mo.','Pantropiko','BINI','#E5734B'),
 ('sarili ko','self-care check: uminom ka na ba ng tubig? eto ang kanta habang nagre-refresh ka.','Dilaw','Maki','#D9A441'),
 ('sa mga sabaw','2am thoughts edition. ito ang pampakalma, libre lang.','Iris','Goo Goo Dolls','#3D5A80'),
 ('sana all','wala pang jowa? same. kanta muna tayong dalawa, parang may kasama ka na.','Someone You Loved','Lewis Capaldi','#4A4E69'),
 ('ikaw, oo ikaw','hindi accident na napadpad ka dito. sign ito na magpahinga ka na.','Yellow','Coldplay','#D9B441'),
 ('mga overthinkers','meeting tayo lahat, 3am, kasama ang mga what-ifs. ito ang official anthem natin.','Tadhana','Up Dharma Down','#3B5A6B'),
 ('lss warning','isang play lang ''to, di mo na makakalimutan. sorry in advance.','Ere','Juan Karlos','#7A3E5C'),
 ('sa laging nasasabawan','cheers sa mga "sana sinabi ko na". next time talaga, promise.','Pagsamo','Arthur Nery','#4A6FA5'),
 ('sa puso mong pagod','hindi ka nag-iisa tonight. kanta ito para sa''yo, galing sa friendly bot na nagmamalasakit.','Mahika','Adie, Janine Berdin','#4C7A6A'),
 ('future you','time capsule: kung nababasa mo ito, sana naging maayos na lahat.','Photograph','Ed Sheeran','#5E6B73'),
 ('introvert party','magkasama tayo pero tahimik. walang small talk, kanta lang.','Mundo','IV Of Spades','#B5453F')
) as v(to_name, body, song, artist, art)
where not exists (select 1 from public.bot_pool p where p.body = v.body);

-- 2) switch the bots on at a friendly pace
update public.settings set value = 'true' where key = 'bot_enabled';
update public.settings set value = '90' where key = 'bot_interval_min';

-- 3) first batch: 8 posts spread over the last 48 hours (only if none exist yet)
do $seed$
declare i int;
begin
  if not exists (select 1 from public.messages where is_bot) then
    for i in 1..8 loop perform public.bot_post(); end loop;
    update public.messages
       set created_at = now() - (random() * interval '48 hours')
     where is_bot and created_at > now() - interval '10 minutes';
  end if;
end $seed$;
