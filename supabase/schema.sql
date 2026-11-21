-- =====================================================================
--  AGE OF CROWNS — Supabase schema, security rules and seed data
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  It is safe to run more than once.
--
--  Who writes what:
--   • The browser (publishable key + the player's login) can only READ,
--     and only what Row Level Security allows below. It cannot write any
--     game table directly.
--   • The multiplayer server (secret key, kept on the server) does every
--     write after checking the rules: gold, items, trades, property,
--     offices, elections, votes, armies, chat.
-- =====================================================================

-- ---------- accounts ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  is_admin    boolean not null default false,
  banned      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- every new Supabase account gets a profile row automatically
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- accounts created before this script ran
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- ---------- kingdoms ----------
create table if not exists public.kingdoms (
  id          smallint primary key check (id between 0 and 3),
  name        text not null,
  treasury    bigint not null default 0 check (treasury >= 0),
  tax_rate    numeric(4,3) not null default 0.050 check (tax_rate between 0 and 0.200),
  updated_at  timestamptz not null default now()
);
insert into public.kingdoms (id, name) values
  (0,'Frosthold'),(1,'Pinehallow'),(2,'Verdantia'),(3,'Tidecrest')
on conflict (id) do nothing;

-- ---------- characters (one per account) ----------
create table if not exists public.characters (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 24),
  kingdom       smallint not null references public.kingdoms(id),
  look          jsonb not null default '{}'::jsonb,       -- appearance
  gold          bigint not null default 40 check (gold >= 0),
  wallet_seq    integer not null default 0,               -- bumps when the server changes gold/items
  items         jsonb not null default '{}'::jsonb,       -- inventory (tools, weapons, tonics…)
  cargo         jsonb not null default '{}'::jsonb,       -- trade goods carried
  army          smallint not null default -1 check (army between -1 and 3),
  army_rank     smallint not null default 0 check (army_rank between 0 and 8),
  gov_rank      smallint not null default 0,
  pos_x         double precision not null default 0,
  pos_z         double precision not null default 0,
  achievements  jsonb not null default '{}'::jsonb,       -- medals, wonders, records…
  save          jsonb,                                    -- the full game save (jobs, progress, story…)
  kingdom_changed_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);
create unique index if not exists characters_name_unique on public.characters (lower(name));
create index if not exists characters_kingdom_idx on public.characters (kingdom);

-- ---------- government ----------
create table if not exists public.offices (
  kingdom     smallint not null references public.kingdoms(id),
  office      text not null check (office in ('monarch','chancellor','treasurer','marshal','speaker','seat1','seat2','seat3')),
  holder      uuid references public.characters(user_id) on delete set null,
  since       timestamptz not null default now(),
  primary key (kingdom, office)
);
insert into public.offices (kingdom, office, holder)
select k.id, o.office, null
from public.kingdoms k
cross join (values ('monarch'),('chancellor'),('treasurer'),('marshal'),('speaker'),('seat1'),('seat2'),('seat3')) as o(office)
on conflict do nothing;

create table if not exists public.elections (
  id          bigserial primary key,
  kingdom     smallint not null references public.kingdoms(id),
  office      text not null,
  status      text not null default 'open' check (status in ('open','closed')),
  called_by   uuid references public.characters(user_id) on delete set null,
  opens_at    timestamptz not null default now(),
  closes_at   timestamptz not null,
  winner      uuid references public.characters(user_id) on delete set null
);
create index if not exists elections_open_idx on public.elections (kingdom, status);

create table if not exists public.election_candidates (
  election_id bigint not null references public.elections(id) on delete cascade,
  user_id     uuid not null references public.characters(user_id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (election_id, user_id)
);

create table if not exists public.election_votes (
  election_id  bigint not null references public.elections(id) on delete cascade,
  voter_id     uuid not null references public.characters(user_id) on delete cascade,
  candidate_id uuid not null references public.characters(user_id) on delete cascade,
  cast_at      timestamptz not null default now(),
  primary key (election_id, voter_id)                      -- one vote per account
);

create table if not exists public.motions (
  id          bigserial primary key,
  kingdom     smallint not null references public.kingdoms(id),
  proposer    uuid references public.characters(user_id) on delete set null,
  title       text not null check (char_length(title) between 3 and 140),
  kind        text not null check (kind in ('decree','grant','tax')),
  amount      bigint check (amount is null or amount > 0),
  target      uuid references public.characters(user_id) on delete set null,
  tax_rate    numeric(4,3) check (tax_rate is null or tax_rate between 0 and 0.200),
  status      text not null default 'open' check (status in ('open','passed','failed')),
  created_at  timestamptz not null default now(),
  closes_at   timestamptz not null
);
create index if not exists motions_open_idx on public.motions (kingdom, status);

create table if not exists public.motion_votes (
  motion_id  bigint not null references public.motions(id) on delete cascade,
  voter_id   uuid not null references public.characters(user_id) on delete cascade,
  yes        boolean not null,
  cast_at    timestamptz not null default now(),
  primary key (motion_id, voter_id)
);

-- ---------- military ----------
create table if not exists public.regiments (
  id          bigserial primary key,
  kingdom     smallint not null references public.kingdoms(id),
  name        text not null check (char_length(name) between 3 and 40),
  commander   uuid references public.characters(user_id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists regiments_name_unique on public.regiments (lower(name));

create table if not exists public.military_members (
  user_id        uuid primary key references public.characters(user_id) on delete cascade,
  army           smallint not null references public.kingdoms(id),
  rank           smallint not null default 0 check (rank between 0 and 8),
  regiment_id    bigint references public.regiments(id) on delete set null,
  regiment_role  text not null default 'member' check (regiment_role in ('member','officer','commander')),
  joined_at      timestamptz not null default now()
);
create index if not exists military_army_idx on public.military_members (army);

-- ---------- property ----------
create table if not exists public.properties (
  id           text primary key,                 -- 'h:<x>,<z>' for houses, 'e:<town>' style for estates
  kind         text not null check (kind in ('house','estate')),
  town         integer not null,
  kingdom      smallint,
  owner        uuid not null references public.characters(user_id) on delete cascade,
  price        bigint not null check (price >= 0),
  acquired_at  timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties (owner);

-- ---------- trade and money ----------
create table if not exists public.trades (
  id            bigserial primary key,
  player_a      uuid not null references public.characters(user_id) on delete cascade,
  player_b      uuid not null references public.characters(user_id) on delete cascade,
  offer_a       jsonb not null,
  offer_b       jsonb not null,
  tax_paid      bigint not null default 0,
  completed_at  timestamptz not null default now()
);
create index if not exists trades_a_idx on public.trades (player_a);
create index if not exists trades_b_idx on public.trades (player_b);

create table if not exists public.ledger (
  id          bigserial primary key,
  user_id     uuid not null references public.characters(user_id) on delete cascade,
  delta       bigint not null,
  reason      text not null,
  ref         text,
  created_at  timestamptz not null default now()
);
create index if not exists ledger_user_idx on public.ledger (user_id, created_at desc);

-- ---------- chat ----------
create table if not exists public.chat_messages (
  id           bigserial primary key,
  channel      text not null,                    -- 'global' | 'kingdom:<k>' | 'army:<k>'
  sender       uuid references public.characters(user_id) on delete set null,
  sender_name  text not null,
  body         text not null check (char_length(body) between 1 and 240),
  created_at   timestamptz not null default now()
);
create index if not exists chat_channel_idx on public.chat_messages (channel, created_at desc);

create table if not exists public.private_messages (
  id           bigserial primary key,
  sender       uuid references public.characters(user_id) on delete set null,
  sender_name  text not null,
  recipient    uuid not null references public.characters(user_id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 240),
  created_at   timestamptz not null default now(),
  delivered    boolean not null default false
);
create index if not exists pm_recipient_idx on public.private_messages (recipient, delivered);

-- ---------- shared world events ----------
create table if not exists public.world_events (
  id          bigserial primary key,
  kind        text not null,
  title       text not null,
  town        integer,
  x           double precision not null,
  z           double precision not null,
  reward      integer not null default 0,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  status      text not null default 'live' check (status in ('live','done'))
);

create table if not exists public.event_participants (
  event_id   bigint not null references public.world_events(id) on delete cascade,
  user_id    uuid not null references public.characters(user_id) on delete cascade,
  rewarded   boolean not null default false,
  primary key (event_id, user_id)
);

-- =====================================================================
--  ROW LEVEL SECURITY
--  Every table has RLS on. There are NO insert/update/delete policies for
--  browser users, so the browser can never write. The server's secret key
--  bypasses RLS and performs the validated writes.
-- =====================================================================

-- helpers used by policies (security definer so they can look up the caller's own rows)
create or replace function public.my_kingdom() returns smallint
language sql stable security definer set search_path = public as $$
  select kingdom from public.characters where user_id = auth.uid()
$$;
create or replace function public.my_army() returns smallint
language sql stable security definer set search_path = public as $$
  select army from public.military_members where user_id = auth.uid()
$$;

alter table public.profiles            enable row level security;
alter table public.kingdoms            enable row level security;
alter table public.characters          enable row level security;
alter table public.offices             enable row level security;
alter table public.elections           enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_votes      enable row level security;
alter table public.motions             enable row level security;
alter table public.motion_votes        enable row level security;
alter table public.regiments           enable row level security;
alter table public.military_members    enable row level security;
alter table public.properties          enable row level security;
alter table public.trades              enable row level security;
alter table public.ledger              enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.private_messages    enable row level security;
alter table public.world_events        enable row level security;
alter table public.event_participants  enable row level security;

-- private: only your own rows
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "own character" on public.characters;
create policy "own character" on public.characters for select to authenticated using (user_id = auth.uid());

drop policy if exists "own ledger" on public.ledger;
create policy "own ledger" on public.ledger for select to authenticated using (user_id = auth.uid());

drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades for select to authenticated using (player_a = auth.uid() or player_b = auth.uid());

drop policy if exists "own private messages" on public.private_messages;
create policy "own private messages" on public.private_messages for select to authenticated using (sender = auth.uid() or recipient = auth.uid());

drop policy if exists "own ballot" on public.election_votes;      -- secret ballot: you see only your own vote
create policy "own ballot" on public.election_votes for select to authenticated using (voter_id = auth.uid());

-- chat history: global for everyone signed in, kingdom/army channels only for members
drop policy if exists "chat visible to members" on public.chat_messages;
create policy "chat visible to members" on public.chat_messages for select to authenticated using (
  channel = 'global'
  or channel = 'kingdom:' || public.my_kingdom()::text
  or channel = 'army:' || public.my_army()::text
);

-- public record of the realm (read-only for signed-in players)
drop policy if exists "realm is public" on public.kingdoms;
create policy "realm is public" on public.kingdoms for select to authenticated using (true);
drop policy if exists "offices are public" on public.offices;
create policy "offices are public" on public.offices for select to authenticated using (true);
drop policy if exists "elections are public" on public.elections;
create policy "elections are public" on public.elections for select to authenticated using (true);
drop policy if exists "candidates are public" on public.election_candidates;
create policy "candidates are public" on public.election_candidates for select to authenticated using (true);
drop policy if exists "motions are public" on public.motions;
create policy "motions are public" on public.motions for select to authenticated using (true);
drop policy if exists "motion votes are public" on public.motion_votes;
create policy "motion votes are public" on public.motion_votes for select to authenticated using (true);
drop policy if exists "regiments are public" on public.regiments;
create policy "regiments are public" on public.regiments for select to authenticated using (true);
drop policy if exists "army rolls are public" on public.military_members;
create policy "army rolls are public" on public.military_members for select to authenticated using (true);
drop policy if exists "property register is public" on public.properties;
create policy "property register is public" on public.properties for select to authenticated using (true);
drop policy if exists "events are public" on public.world_events;
create policy "events are public" on public.world_events for select to authenticated using (true);
drop policy if exists "event rolls are public" on public.event_participants;
create policy "event rolls are public" on public.event_participants for select to authenticated using (true);

-- belt and braces: browser roles get read access only
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- =====================================================================
--  Make yourself a server admin (can /announce, /kick, /mute, start events):
--    update public.profiles set is_admin = true
--    where id = (select id from auth.users where email = 'you@example.com');
-- =====================================================================
