-- =====================================================================
--  AGE OF CROWNS: the new corps
--  Run in Supabase -> SQL Editor. Safe to run more than once.
--  Keeps Line Infantry, Storm Troopers and Heavy Infantry. The Ironmask and
--  Officer corps are retired: their soldiers return to the Line Infantry
--  (keeping their rank). Adds Trench Raiders, Gas Sentinels, Flame Pioneers,
--  Frost Rangers, Sky Corps and Royal Cuirassiers, which admins assign.
-- =====================================================================
alter table public.military_members drop constraint if exists military_members_corps_check;
update public.military_members set corps = 'line' where corps in ('ironmask', 'officer');
alter table public.military_members add constraint military_members_corps_check
  check (corps in ('line','storm','heavy','raider','gas','flamer','ranger','aviator','cuirassier'));
