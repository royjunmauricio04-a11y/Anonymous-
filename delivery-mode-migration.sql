-- Run once in Supabase SQL Editor to enable public posts and direct personal-link messages.
alter table public.messages add column if not exists delivery_type text not null default 'direct' check (delivery_type in ('direct','public'));
create index if not exists messages_delivery_type_created on public.messages (delivery_type, created_at desc);
notify pgrst, 'reload schema';
