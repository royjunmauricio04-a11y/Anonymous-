-- Make YOUR account an admin. Run this once, after you created the user in Supabase Auth.
-- 1) Supabase > Authentication > Users > Add user > Create new user (email + password, tick Auto Confirm User).
-- 2) Copy that user's UID (a long id like 3f2a...).
-- 3) Paste it below, replacing the text between the quotes, then Run.
insert into public.admins (user_id)
values ('PASTE-YOUR-USER-UID-HERE')
on conflict (user_id) do nothing;

-- Check it worked (you should see one row):
select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;
