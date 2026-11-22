-- =====================================================================
--  AGE OF CROWNS: specialised corps and the new rank ladder
--  Run once in Supabase -> SQL Editor after schema.sql and seasons.sql.
--  It is safe to run more than once.
--
--  Ranks are now: 0 Recruit, 1 Private, 2 Lance Corporal, 3 Corporal,
--  4 Sergeant, 5 Staff Sergeant, 6 Warrant Officer (the top rank merit can
--  earn), then 7 Lieutenant, 8 Captain, 9 Major, 10 Colonel, 11 General,
--  which only admins can grant. Existing soldiers keep the rank they had:
--  old Corporal -> Corporal, old Sergeant -> Sergeant, old officers keep
--  their officer rank.
-- =====================================================================

-- corps: which specialised corps a soldier serves in (assigned by admins)
alter table public.military_members add column if not exists corps text not null default 'line';
alter table public.military_members drop constraint if exists military_members_corps_check;
alter table public.military_members add constraint military_members_corps_check check (corps in ('line','storm','ironmask','heavy','officer'));

-- widen the rank checks from 0-8 to 0-11
alter table public.military_members drop constraint if exists military_members_rank_check;
alter table public.military_members add constraint military_members_rank_check check (rank between 0 and 11);
alter table public.characters drop constraint if exists characters_army_rank_check;
alter table public.characters add constraint characters_army_rank_check check (army_rank between 0 and 11);

-- move existing ranks onto the new ladder exactly once (rows made after this already use the new numbers)
alter table public.military_members add column if not exists rank_scale smallint not null default 1;
update public.military_members
   set rank = case rank when 2 then 3 when 3 then 4 when 4 then 7 when 5 then 8 when 6 then 9 when 7 then 10 when 8 then 11 else rank end,
       rank_scale = 2
 where rank_scale = 1;
alter table public.military_members alter column rank_scale set default 2;

alter table public.characters add column if not exists army_rank_scale smallint not null default 1;
update public.characters
   set army_rank = case army_rank when 2 then 3 when 3 then 4 when 4 then 7 when 5 then 8 when 6 then 9 when 7 then 10 when 8 then 11 else army_rank end,
       army_rank_scale = 2
 where army_rank_scale = 1;
alter table public.characters alter column army_rank_scale set default 2;

-- the browser still only reads its own row; every change goes through the server
revoke insert, update, delete on public.military_members from anon, authenticated;
