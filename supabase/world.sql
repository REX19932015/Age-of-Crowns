-- =====================================================================
--  AGE OF CROWNS: SHARED WORLD MIGRATION
--  Run this in Supabase → SQL Editor. Safe to run again.
--  One row holds the whole shared realm: the calendar, relations, wars,
--  alliances, treaties, treasuries, rulers, occupied and burnt towns, forts,
--  the news and every army company. Only the multiplayer server writes it.
-- =====================================================================
create table if not exists public.world_state (
  id         integer primary key check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.world_state enable row level security;
-- no policies: browsers cannot read or write this table; the server uses its service key.
grant select, insert, update, delete on public.world_state to service_role;
notify pgrst, 'reload schema';
