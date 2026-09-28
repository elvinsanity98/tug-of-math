-- Tug of Math database: players, results and leaderboard.
-- Run once in Supabase: SQL Editor -> New query -> paste this file -> Run.
-- Needs "Allow anonymous sign-ins" on (Authentication -> Sign In / Providers).

-- Profiles: one row per player, created automatically on sign-up
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Player' check (char_length(display_name) between 1 and 14),
  games_played  int  not null default 0,
  wins          int  not null default 0,
  losses        int  not null default 0,
  draws         int  not null default 0,
  total_correct int  not null default 0,
  best_streak   int  not null default 0,
  fastest_ms    int,
  created_at    timestamptz not null default now()
);

-- One row per finished round
create table public.game_results (
  id            bigint generated always as identity primary key,
  player_id     uuid not null references public.profiles (id) on delete cascade,
  mode          text not null check (mode in ('cpu', 'online')),
  op            text not null check (op in ('add', 'sub', 'mul', 'div', 'mix')),
  diff          text not null check (diff in ('easy', 'medium', 'hard')),
  round_secs    int  not null check (round_secs in (0, 60, 90)),
  cpu_level     text check (cpu_level in ('easy', 'medium', 'hard')),
  outcome       text not null check (outcome in ('win', 'loss', 'draw')),
  correct       int  not null check (correct between 0 and 1000),
  wrong         int  not null check (wrong between 0 and 1000),
  best_streak   int  not null check (best_streak between 0 and 1000),
  fastest_ms    int  check (fastest_ms > 0),
  elapsed_secs  numeric(8,2) not null check (elapsed_secs >= 0),
  created_at    timestamptz not null default now()
);
create index game_results_player_idx on public.game_results (player_id, created_at desc);
create index profiles_wins_idx on public.profiles (wins desc);

-- Auto-create a profile for every new user (anonymous or email)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.profiles     enable row level security;
alter table public.game_results enable row level security;

create policy "Profiles are public" on public.profiles
  for select to anon, authenticated using (true);
create policy "Players rename themselves" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Players read own results" on public.game_results
  for select to authenticated using ((select auth.uid()) = player_id);

-- Players can only change their name; stats change only through submit_result()
revoke insert, update, delete on public.profiles     from anon, authenticated;
revoke insert, update, delete on public.game_results from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.game_results to authenticated;

-- Save a round and update the player's totals in one call
create or replace function public.submit_result(
  p_mode text, p_op text, p_diff text, p_round_secs int, p_cpu_level text,
  p_outcome text, p_correct int, p_wrong int, p_best_streak int,
  p_fastest_ms int, p_elapsed_secs numeric
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  -- basic spam/cheat guards (the game runs in the browser, so not bulletproof)
  if exists (select 1 from public.game_results
             where player_id = uid and created_at > now() - interval '5 seconds') then
    raise exception 'Too many results, slow down';
  end if;
  if p_best_streak > p_correct or p_correct + p_wrong > p_elapsed_secs * 4 + 5 then
    raise exception 'Implausible result';
  end if;

  insert into public.game_results
    (player_id, mode, op, diff, round_secs, cpu_level, outcome, correct, wrong, best_streak, fastest_ms, elapsed_secs)
  values
    (uid, p_mode, p_op, p_diff, p_round_secs, p_cpu_level, p_outcome, p_correct, p_wrong, p_best_streak, p_fastest_ms, p_elapsed_secs);

  update public.profiles set
    games_played  = games_played + 1,
    wins          = wins   + (p_outcome = 'win')::int,
    losses        = losses + (p_outcome = 'loss')::int,
    draws         = draws  + (p_outcome = 'draw')::int,
    total_correct = total_correct + p_correct,
    best_streak   = greatest(best_streak, p_best_streak),
    fastest_ms    = least(fastest_ms, p_fastest_ms)
  where id = uid;
end;
$$;
revoke execute on function public.submit_result from public, anon;
grant execute on function public.submit_result to authenticated;
