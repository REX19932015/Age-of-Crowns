-- =====================================================================
--  AGE OF CROWNS: the Snipers
--  Run in Supabase -> SQL Editor (after corps2.sql). Safe to run more than once.
--  Adds the Snipers to the corps admins can assign.
-- =====================================================================
alter table public.military_members drop constraint if exists military_members_corps_check;
update public.military_members set corps = 'line' where corps in ('ironmask', 'officer');
alter table public.military_members add constraint military_members_corps_check
  check (corps in ('line','sniper','storm','heavy','raider','gas','flamer','ranger','aviator','cuirassier'));
