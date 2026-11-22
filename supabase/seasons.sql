-- =====================================================================
--  AGE OF CROWNS: SEASONS MIGRATION
--  Run this AFTER schema.sql, in Supabase → SQL Editor. Safe to run again.
--  Adds: season progress (XP, premium track, story, challenges, holiday finds),
--  battle pass claims (one row per claimed reward, so nothing can be claimed twice),
--  owned cosmetics, equipped cosmetics and realm-wide community goals.
--  Browsers can only READ their own rows. All writes come from the multiplayer server.
-- =====================================================================

create table if not exists public.season_progress (
  user_id    uuid not null references public.characters(user_id) on delete cascade,
  season_id  text not null,
  xp         integer not null default 0 check (xp >= 0),
  premium    boolean not null default false,
  story      jsonb not null default '{}'::jsonb,
  stats      jsonb not null default '{}'::jsonb,
  chal       jsonb not null default '[]'::jsonb,
  hunt       jsonb not null default '{}'::jsonb,
  fund       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

-- one row per claimed battle pass reward; the primary key makes double-claiming impossible
create table if not exists public.season_claims (
  user_id    uuid not null references public.characters(user_id) on delete cascade,
  season_id  text not null,
  tier       integer not null check (tier >= 0 and tier <= 150),   -- tier 0 / track 'story' = campaign completion reward; 101-150 are bonus tiers
  track      text not null check (track in ('free','premium','story')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, season_id, tier, track)
);

-- every cosmetic a player owns, from any season, battle pass, story or holiday
create table if not exists public.unlocks (
  user_id    uuid not null references public.characters(user_id) on delete cascade,
  item_id    text not null,
  source     text not null default 'pass',
  season_id  text,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- realm-wide goals (for example the Concord Relief Fund)
create table if not exists public.season_community (
  season_id  text not null,
  goal       text not null,
  progress   bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season_id, goal)
);

-- what each character is wearing from the wardrobe
alter table public.characters add column if not exists equipped jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- security (RLS): read your own rows only
alter table public.season_progress  enable row level security;
-- bonus tiers 101-150 (safe to run again on a database made with the older 100-tier limit)
alter table public.season_claims drop constraint if exists season_claims_tier_check;
alter table public.season_claims add constraint season_claims_tier_check check (tier >= 0 and tier <= 150);

alter table public.season_claims    enable row level security;
alter table public.unlocks          enable row level security;
alter table public.season_community enable row level security;

drop policy if exists "own season progress" on public.season_progress;
create policy "own season progress" on public.season_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists "own season claims" on public.season_claims;
create policy "own season claims" on public.season_claims for select to authenticated using (user_id = auth.uid());
drop policy if exists "own unlocks" on public.unlocks;
create policy "own unlocks" on public.unlocks for select to authenticated using (user_id = auth.uid());
drop policy if exists "community goals are public" on public.season_community;
create policy "community goals are public" on public.season_community for select to authenticated using (true);

revoke insert, update, delete on public.season_progress, public.season_claims, public.unlocks, public.season_community from anon, authenticated;
revoke all on public.season_progress, public.season_claims, public.unlocks, public.season_community from anon;
grant select on public.season_progress, public.season_claims, public.unlocks, public.season_community to authenticated;

-- the multiplayer server (secret / service_role key) needs full access
grant all on public.season_progress, public.season_claims, public.unlocks, public.season_community to service_role;
