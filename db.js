/* Tug of Math — player account, coins, skins, ranks, results and the leaderboard (Supabase).
   Players sign up and sign in with email and password; the session stays in
   the browser until they sign out. Without Supabase or internet the game runs
   with a local guest profile and the online features are switched off.
   The same client also carries online play (see net.js). Tables: supabase/*.sql. */
const DB = (() => {
  const SUPA_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
  const GUEST_KEY = 'tug-of-math-guest';
  const cfg = window.TUG_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  // a password-reset link lands here with #...type=recovery (or #error=... when it has expired)
  const landedHash = location.hash;
  const recovering = /type=recovery/.test(landedHash);
  const fromEmail = /access_token=|type=(signup|recovery|magiclink|invite|email_change)/.test(landedHash);
  const linkError = (/error_description=([^&]+)/.exec(landedHash) || [])[1];
  // Leaderboards come from the `leaderboard` view (supabase/003_leaderboards.sql): one board
  // for Classic games against real players and one for Ranked. Games vs the computer never count.
  const METRICS = {
    wins:    { col: 'wins', asc: false },
    rank:    { col: 'rank_stars', asc: false },
    streak:  { col: 'best_streak', asc: false },
    answers: { col: 'total_correct', asc: false },
    fastest: { col: 'fastest_ms', asc: true },
  };
  const COLS = 'player_id, display_name, games_played, wins, best_streak, total_correct, fastest_ms, rank_stars, skin';
  let loading = null;
  let online = false;
  let profile = null;
  let email = '';
  let owned = new Set(['classic']);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  async function create() {
    if (!configured) throw new Error('Supabase keys are missing from config.js.');
    if (!(window.supabase && window.supabase.createClient)) {
      try { await loadScript(SUPA_SRC); } catch (e) { /* reported below */ }
    }
    if (!(window.supabase && window.supabase.createClient)) throw new Error('Could not load online play. Check the internet connection.');
    return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  function client() {
    if (!loading) loading = create().catch(e => { loading = null; throw e; });
    return loading;
  }
  const fail = (error, fallback) => new Error((error && error.message) || fallback);
  // Supabase's auth messages, in plain words
  function authError(error) {
    const m = (error && error.message) || '';
    if (/invalid login credentials/i.test(m)) return new Error('Wrong email or password.');
    if (/already registered|already been registered|already exists/i.test(m)) return new Error('That email already has an account. Sign in instead.');
    if (/email not confirmed/i.test(m)) return new Error('Confirm your email first (check your inbox), then sign in.');
    if (/signups? not allowed|signup is disabled/i.test(m)) return new Error('New accounts are switched off in Supabase (Authentication → Sign In / Providers → Email).');
    if (/rate limit|too many/i.test(m)) return new Error('Too many tries. Wait a minute and try again.');
    if (/failed to fetch|network/i.test(m)) return new Error('Could not reach the server. Check the internet connection.');
    return new Error(m || 'Something went wrong. Try again.');
  }

  /* ---------- account ---------- */
  function readGuest() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { /* storage blocked */ }
    if (!g || !g.id) g = { id: 'guest' + Math.random().toString(36).slice(2, 10), display_name: 'Player' };
    return { id: g.id, display_name: g.display_name || 'Player', coins: 0, rank_stars: 0, best_stars: 0, skin: 'classic',
      games_played: 0, wins: 0, losses: 0, draws: 0, total_correct: 0, best_streak: 0, fastest_ms: null, ranked_played: 0, ranked_wins: 0,
      boards: { classic: { games: 0, wins: 0 }, ranked: { games: 0, wins: 0 } } };
  }
  function writeGuest() {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify({ id: profile.id, display_name: profile.display_name })); } catch (e) { /* storage blocked */ }
  }
  function goOffline() {
    online = false;
    profile = readGuest();
    owned = new Set(['classic']);
  }
  function cleanUrl() {
    if (fromEmail || linkError) history.replaceState(null, '', location.pathname + location.search);
  }
  /* Resolves to 'in' (signed in, profile loaded), 'out' (needs to sign in),
     'recovery' (came from a reset link: needs a new password) or 'offline'. */
  async function init() {
    let sb;
    try { sb = await client(); } catch (e) { goOffline(); return 'offline'; }
    try {
      const { data } = await sb.auth.getSession();
      let user = data.session && data.session.user;
      if (user && user.is_anonymous) { await sb.auth.signOut({ scope: 'local' }); user = null; }   // from the old no-login version
      cleanUrl();
      if (!user) return 'out';
      await refresh(user);
      online = true;
      return recovering ? 'recovery' : 'in';
    } catch (e) {
      console.warn('Tug of Math: playing offline.', e && e.message);
      goOffline();
      return 'offline';
    }
  }
  async function refresh(user) {
    const sb = await client();
    if (!user) { const { data } = await sb.auth.getUser(); user = data.user; }
    if (!user) throw new Error('Not signed in.');
    email = user.email || '';
    const [p, o, b] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb.from('owned_skins').select('skin_id'),
      sb.from('board_stats').select('board, games_played, wins').eq('player_id', user.id),
    ]);
    if (p.error) throw fail(p.error, 'Could not load your profile.');
    if (!p.data) throw new Error('Your profile is missing. Run supabase/schema.sql.');
    if (!('coins' in p.data)) throw new Error('The database needs supabase/002_modes_ranks_skins.sql.');
    profile = p.data;
    owned = new Set(['classic', ...((o.data || []).map(r => r.skin_id))]);
    // win rates only count games against real players (see supabase/003_leaderboards.sql)
    profile.boards = emptyBoards();
    if (!b.error) {
      for (const r of b.data || []) if (profile.boards[r.board]) profile.boards[r.board] = { games: r.games_played, wins: r.wins };
    } else {
      profile.boards.ranked = { games: profile.ranked_played || 0, wins: profile.ranked_wins || 0 };
    }
    return profile;
  }
  function emptyBoards() { return { classic: { games: 0, wins: 0 }, ranked: { games: 0, wins: 0 } }; }
  async function signUp(name, mail, password) {
    const sb = await client();
    const { data, error } = await sb.auth.signUp({ email: mail, password, options: { data: { display_name: name }, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw authError(error);
    if (!data.session) return 'confirm';       // "Confirm email" is on in Supabase
    await refresh(data.user);
    online = true;
    await setName(name);
    return 'in';
  }
  async function signIn(mail, password) {
    const sb = await client();
    const { data, error } = await sb.auth.signInWithPassword({ email: mail, password });
    if (error) throw authError(error);
    await refresh(data.user);
    online = true;
  }
  async function signOut() {
    const sb = await client();
    await sb.auth.signOut();
    online = false; profile = null; email = ''; owned = new Set(['classic']);
  }
  async function resetPassword(mail) {
    const sb = await client();
    const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname });
    if (error) throw authError(error);
  }
  async function updatePassword(password) {
    const sb = await client();
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw authError(error);
  }
  async function setName(name) {
    if (!name || !profile || name === profile.display_name) return;
    profile.display_name = name;
    if (!online) { writeGuest(); return; }
    const sb = await client();
    const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', profile.id);
    if (error) throw fail(error, 'Could not save your name.');
  }

  /* ---------- results ---------- */
  // r holds the submit_result() arguments; resolves to { coins, coins_total, stars_before, stars_after } or null
  async function saveResult(r) {
    if (!online) return null;
    try {
      const sb = await client();
      let { data, error } = await sb.rpc('submit_result', r);
      if (error && 'p_real_opponents' in r && /submit_result|schema cache|function/i.test(error.message || '')) {
        // database not updated to 003_leaderboards.sql yet: save without the new field
        const { p_real_opponents, ...old } = r;
        ({ data, error } = await sb.rpc('submit_result', old));
      }
      if (error) throw error;
      profile.coins = data.coins_total;
      profile.rank_stars = data.stars_after;
      profile.best_stars = Math.max(profile.best_stars || 0, data.stars_after);
      profile.games_played++;
      if (r.p_outcome === 'win') profile.wins++;
      if (r.p_mode === 'ranked') { profile.ranked_played++; if (r.p_outcome === 'win') profile.ranked_wins++; }
      // same rule as submit_result(): Ranked, or Classic with at least one real opponent
      const board = r.p_mode === 'ranked' ? 'ranked' : r.p_mode === 'classic' && r.p_real_opponents > 0 ? 'classic' : null;
      if (board && profile.boards) { profile.boards[board].games++; if (r.p_outcome === 'win') profile.boards[board].wins++; }
      profile.total_correct += r.p_correct;
      profile.best_streak = Math.max(profile.best_streak, r.p_best_streak);
      return data;
    } catch (e) {
      console.warn('Tug of Math: result not saved.', e && e.message);
      return null;
    }
  }

  /* ---------- shop ---------- */
  async function buySkin(id) {
    const sb = await client();
    const { data, error } = await sb.rpc('buy_skin', { p_skin: id });
    if (error) throw fail(error, 'Could not buy that skin.');
    profile.coins = data;
    owned.add(id);
  }
  async function equipSkin(id) {
    if (!online) { if (id !== 'classic') throw new Error('The shop needs an internet connection.'); return; }
    const sb = await client();
    const { error } = await sb.rpc('equip_skin', { p_skin: id });
    if (error) throw fail(error, 'Could not wear that skin.');
    profile.skin = id;
  }

  /* ---------- leaderboard + history ---------- */
  // board: 'classic' | 'ranked'; metric: a METRICS key (rank only makes sense on 'ranked')
  async function leaderboard(board, metric) {
    const m = METRICS[metric] || METRICS.wins;
    const sb = await client();
    let q = sb.from('leaderboard').select(COLS).eq('board', board === 'ranked' ? 'ranked' : 'classic');
    if (m.col === 'fastest_ms') q = q.not('fastest_ms', 'is', null);
    const { data, error } = await q
      .order(m.col, { ascending: m.asc, nullsFirst: false })
      .order('games_played', { ascending: true })
      .order('display_name', { ascending: true })
      .limit(20);
    if (error) {
      if (/leaderboard|relation|schema cache/i.test(error.message || '')) {
        throw new Error('The leaderboard needs a database update: run supabase/003_leaderboards.sql in Supabase.');
      }
      throw fail(error, 'Could not load the leaderboard.');
    }
    return (data || []).map(r => ({ ...r, id: r.player_id }));
  }
  async function history() {
    const sb = await client();
    const { data, error } = await sb.from('game_results')
      .select('mode, team_size, op, diff, outcome, correct, wrong, best_streak, coins, stars_delta, created_at')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw fail(error, 'Could not load your games.');
    return data || [];
  }

  return {
    configured, client, init, refresh, signUp, signIn, signOut, resetPassword, updatePassword, setName,
    saveResult, buySkin, equipSkin, leaderboard, history,
    get online() { return online; },
    get email() { return email; },
    get linkError() { return linkError ? decodeURIComponent(linkError.split('+').join(' ')) : ''; },
    get profile() { return profile; },
    owns: id => owned.has(id),
  };
})();
