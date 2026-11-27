-- =====================================================================
--  AGE OF CROWNS: the corps are Line Infantry, Storm Troopers, Heavy Infantry and Snipers
--  Run in Supabase -> SQL Editor. Safe to run more than once.
--  Soldiers in any corps that no longer exists return to the Line Infantry, keeping their rank.
-- =====================================================================
alter table public.military_members drop constraint if exists military_members_corps_check;
update public.military_members set corps = 'line' where corps not in ('line','sniper','storm','heavy');
alter table public.military_members add constraint military_members_corps_check
  check (corps in ('line','sniper','storm','heavy'));
