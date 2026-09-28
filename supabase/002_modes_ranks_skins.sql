-- Tug of Math update 2: game modes, ranked stars, coins and skins.
-- Run once, after schema.sql: SQL Editor -> New query -> paste this file -> Run.
-- It keeps every player and result that already exists. Safe to run again.

-- 1. Player columns: coins (everyone starts with 100), rank and equipped skin
alter table public.profiles
  add column if not exists coins         int  not null default 100 check (coins >= 0),
  add column if not exists rank_stars    int  not null default 0 check (rank_stars between 0 and 1249),
  add column if not exists best_stars    int  not null default 0,
  add column if not exists ranked_played int  not null default 0,
  add column if not exists ranked_wins   int  not null default 0,
  add column if not exists skin          text not null default 'classic';
create index if not exists profiles_rank_idx on public.profiles (rank_stars desc);

-- 2. Results: new modes, team size, and what the round paid out
alter table public.game_results drop constraint if exists game_results_mode_check;
alter table public.game_results add constraint game_results_mode_check
  check (mode in ('cpu', 'online', 'classic', 'ranked', 'custom'));
alter table public.game_results
  add column if not exists team_size   int not null default 1 check (team_size between 1 and 5),
  add column if not exists coins       int not null default 0,
  add column if not exists stars_delta int not null default 0;

-- 3. Skins: the shop catalogue and what each player owns
create table if not exists public.skins (
  id        text primary key,
  name      text not null,
  price     int  not null check (price >= 0),
  min_stars int  not null default 0,        -- best rank needed to buy it (see ranks in catalog.js)
  sort      int  not null default 0
);
insert into public.skins (id, name, price, min_stars, sort) values
  ('classic', 'Classic',        0,   0,  0),
  ('cap',     'Sporty Cap',   100,   0,  1),
  ('shades',  'Cool Shades',  200,   0,  2),
  ('cat',     'Cat Ears',     250,   0,  3),
  ('pirate',  'Pirate',       400,   0,  4),
  ('ninja',   'Ninja',        500,   0,  5),
  ('viking',  'Viking',       600,   0,  6),
  ('wizard',  'Wizard',       800,   0,  7),
  ('astro',   'Astronaut',   1000,   0,  8),
  ('robot',   'Robot',       1200,   0,  9),
  ('crown',   'Royal Crown', 1500, 100, 10),   -- Gold I
  ('halo',    'Diamond Halo',2000, 200, 11),   -- Diamond I
  ('legend',  'Legend Flame',2500, 250, 12)    -- Legend
on conflict (id) do update
  set name = excluded.name, price = excluded.price, min_stars = excluded.min_stars, sort = excluded.sort;

create table if not exists public.owned_skins (
  player_id uuid not null references public.profiles (id) on delete cascade,
  skin_id   text not null references public.skins (id),
  bought_at timestamptz not null default now(),
  primary key (player_id, skin_id)
);

alter table public.skins       enable row level security;
alter table public.owned_skins enable row level security;
drop policy if exists "Skins are public" on public.skins;
create policy "Skins are public" on public.skins
  for select to anon, authenticated using (true);
drop policy if exists "Players see own skins" on public.owned_skins;
create policy "Players see own skins" on public.owned_skins
  for select to authenticated using ((select auth.uid()) = player_id);
revoke insert, update, delete on public.skins, public.owned_skins from anon, authenticated;
grant select on public.skins to anon, authenticated;
grant select on public.owned_skins to authenticated;

-- 4. Save a round: stats, coins and ranked stars in one call.
--    Ranks: 50 stars per tier (Bronze, Silver, Gold, Platinum, Diamond; 10 per division I-V),
--    Legend from 250 stars up to 250 + 999. A loss costs a star, but never drops a tier
--    and never costs anything in Bronze.
drop function if exists public.submit_result(text, text, text, int, text, text, int, int, int, int, numeric);
create or replace function public.submit_result(
  p_mode text, p_team_size int, p_op text, p_diff text, p_round_secs int, p_cpu_level text,
  p_outcome text, p_correct int, p_wrong int, p_best_streak int,
  p_fastest_ms int, p_elapsed_secs numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  prof  public.profiles;
  earned int := 0;
  delta  int := 0;
  floor_stars int;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.game_results
             where player_id = uid and created_at > now() - interval '5 seconds') then
    raise exception 'Too many results, slow down';
  end if;
  if p_best_streak > p_correct or p_correct + p_wrong > p_elapsed_secs * 4 + 5 then
    raise exception 'Implausible result';
  end if;

  select * into prof from public.profiles where id = uid for update;
  if not found then raise exception 'Profile missing'; end if;

  if p_mode <> 'custom' then
    earned := 10 + 2 * least(p_correct, 60)
              + case p_outcome when 'win' then 20 when 'draw' then 5 else 0 end;
    if p_mode = 'ranked' then earned := round(earned * 1.5); end if;
  end if;

  if p_mode = 'ranked' then
    floor_stars := case when prof.rank_stars >= 250 then 250 else (prof.rank_stars / 50) * 50 end;
    if p_outcome = 'win' and prof.rank_stars < 1249 then
      delta := 1;
    elsif p_outcome = 'loss' and prof.rank_stars > floor_stars and prof.rank_stars >= 50 then
      delta := -1;
    end if;
  end if;

  insert into public.game_results
    (player_id, mode, team_size, op, diff, round_secs, cpu_level, outcome, correct, wrong,
     best_streak, fastest_ms, elapsed_secs, coins, stars_delta)
  values
    (uid, p_mode, p_team_size, p_op, p_diff, p_round_secs, p_cpu_level, p_outcome, p_correct, p_wrong,
     p_best_streak, p_fastest_ms, p_elapsed_secs, earned, delta);

  update public.profiles set
    games_played  = games_played + 1,
    wins          = wins   + (p_outcome = 'win')::int,
    losses        = losses + (p_outcome = 'loss')::int,
    draws         = draws  + (p_outcome = 'draw')::int,
    total_correct = total_correct + p_correct,
    best_streak   = greatest(best_streak, p_best_streak),
    fastest_ms    = least(fastest_ms, p_fastest_ms),
    coins         = coins + earned,
    rank_stars    = rank_stars + delta,
    best_stars    = greatest(best_stars, rank_stars + delta),
    ranked_played = ranked_played + (p_mode = 'ranked')::int,
    ranked_wins   = ranked_wins + (p_mode = 'ranked' and p_outcome = 'win')::int
  where id = uid;

  return jsonb_build_object(
    'coins', earned, 'coins_total', prof.coins + earned,
    'stars_before', prof.rank_stars, 'stars_after', prof.rank_stars + delta);
end;
$$;
revoke execute on function public.submit_result(text, int, text, text, int, text, text, int, int, int, int, numeric) from public, anon;
grant execute on function public.submit_result(text, int, text, text, int, text, text, int, int, int, int, numeric) to authenticated;

-- 5. Shop: buy a skin with coins, and wear one you own
create or replace function public.buy_skin(p_skin text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  s    public.skins;
  prof public.profiles;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into s from public.skins where id = p_skin;
  if not found then raise exception 'No such skin'; end if;
  if s.price = 0 or exists (select 1 from public.owned_skins where player_id = uid and skin_id = p_skin) then
    raise exception 'You already own this skin';
  end if;
  select * into prof from public.profiles where id = uid for update;
  if prof.best_stars < s.min_stars then raise exception 'Reach a higher rank to unlock this skin'; end if;
  if prof.coins < s.price then raise exception 'Not enough coins'; end if;
  update public.profiles set coins = coins - s.price where id = uid;
  insert into public.owned_skins (player_id, skin_id) values (uid, p_skin);
  return prof.coins - s.price;
end;
$$;

create or replace function public.equip_skin(p_skin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_skin <> 'classic' and not exists
     (select 1 from public.owned_skins where player_id = uid and skin_id = p_skin) then
    raise exception 'You do not own this skin';
  end if;
  update public.profiles set skin = p_skin where id = uid;
end;
$$;

revoke execute on function public.buy_skin(text), public.equip_skin(text) from public, anon;
grant execute on function public.buy_skin(text), public.equip_skin(text) to authenticated;
