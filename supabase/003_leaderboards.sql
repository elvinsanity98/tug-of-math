-- Tug of Math update 3: separate Classic and Ranked leaderboards.
-- Games against the computer never count: not "Vs computer", not Custom rooms,
-- and not Classic quick matches that ended up with computer players only.
-- Run once, after 002: SQL Editor -> New query -> paste this file -> Run. Safe to run again.

-- 1. Remember how many real (human) opponents each game had
alter table public.game_results
  add column if not exists real_opponents int check (real_opponents between 0 and 5);

-- 2. Leaderboard totals, one row per player per board
create table if not exists public.board_stats (
  player_id     uuid not null references public.profiles (id) on delete cascade,
  board         text not null check (board in ('classic', 'ranked')),
  games_played  int  not null default 0,
  wins          int  not null default 0,
  total_correct int  not null default 0,
  best_streak   int  not null default 0,
  fastest_ms    int,
  primary key (player_id, board)
);
create index if not exists board_stats_wins_idx    on public.board_stats (board, wins desc);
create index if not exists board_stats_correct_idx on public.board_stats (board, total_correct desc);

alter table public.board_stats enable row level security;
drop policy if exists "Board stats are public" on public.board_stats;
create policy "Board stats are public" on public.board_stats
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.board_stats from anon, authenticated;
grant select on public.board_stats to anon, authenticated;

-- What the Leaderboard page reads: board totals plus name, rank and skin
create or replace view public.leaderboard
with (security_invoker = on) as
select b.board, b.player_id, p.display_name, p.rank_stars, p.skin,
       b.games_played, b.wins, b.total_correct, b.best_streak, b.fastest_ms
from public.board_stats b
join public.profiles p on p.id = b.player_id;
grant select on public.leaderboard to anon, authenticated;

-- 3. Fill the Ranked board from past ranked games (those were always against real players).
--    Older Classic games never recorded whether the opponents were real, so Classic starts fresh.
insert into public.board_stats (player_id, board, games_played, wins, total_correct, best_streak, fastest_ms)
select player_id, 'ranked', count(*), count(*) filter (where outcome = 'win'),
       sum(correct), max(best_streak), min(fastest_ms)
from public.game_results
where mode = 'ranked'
group by player_id
on conflict (player_id, board) do nothing;

-- 4. Save a round. Same as update 2, plus p_real_opponents and the board totals.
drop function if exists public.submit_result(text, int, text, text, int, text, text, int, int, int, int, numeric);
create or replace function public.submit_result(
  p_mode text, p_team_size int, p_op text, p_diff text, p_round_secs int, p_cpu_level text,
  p_outcome text, p_correct int, p_wrong int, p_best_streak int,
  p_fastest_ms int, p_elapsed_secs numeric, p_real_opponents int default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  prof  public.profiles;
  earned int := 0;
  delta  int := 0;
  floor_stars int;
  v_board text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.game_results
             where player_id = uid and created_at > now() - interval '5 seconds') then
    raise exception 'Too many results, slow down';
  end if;
  if p_best_streak > p_correct or p_correct + p_wrong > p_elapsed_secs * 4 + 5 then
    raise exception 'Implausible result';
  end if;
  if p_real_opponents is not null and (p_real_opponents < 0 or p_real_opponents > 5) then
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
     best_streak, fastest_ms, elapsed_secs, coins, stars_delta, real_opponents)
  values
    (uid, p_mode, p_team_size, p_op, p_diff, p_round_secs, p_cpu_level, p_outcome, p_correct, p_wrong,
     p_best_streak, p_fastest_ms, p_elapsed_secs, earned, delta, p_real_opponents);

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

  -- Leaderboards: Ranked games, and Classic games with at least one real opponent
  v_board := case
    when p_mode = 'ranked' then 'ranked'
    when p_mode = 'classic' and coalesce(p_real_opponents, 0) > 0 then 'classic'
  end;
  if v_board is not null then
    insert into public.board_stats as b
      (player_id, board, games_played, wins, total_correct, best_streak, fastest_ms)
    values
      (uid, v_board, 1, (p_outcome = 'win')::int, p_correct, p_best_streak, p_fastest_ms)
    on conflict (player_id, board) do update set
      games_played  = b.games_played + 1,
      wins          = b.wins + excluded.wins,
      total_correct = b.total_correct + excluded.total_correct,
      best_streak   = greatest(b.best_streak, excluded.best_streak),
      fastest_ms    = least(b.fastest_ms, excluded.fastest_ms);
  end if;

  return jsonb_build_object(
    'coins', earned, 'coins_total', prof.coins + earned,
    'stars_before', prof.rank_stars, 'stars_after', prof.rank_stars + delta);
end;
$$;
revoke execute on function public.submit_result(text, int, text, text, int, text, text, int, int, int, int, numeric, int) from public, anon;
grant execute on function public.submit_result(text, int, text, text, int, text, text, int, int, int, int, numeric, int) to authenticated;
