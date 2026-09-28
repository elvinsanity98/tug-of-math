/* Tug of Math — player account, coins, skins, ranks, results and the leaderboard (Supabase).
   A player gets an anonymous account on first visit (no email needed); the
   session stays in this browser. Without Supabase or internet the game runs
   with a local guest profile and the online features are switched off.
   The same client also carries online play (see net.js). Tables: supabase/*.sql. */
const DB = (() => {
  const SUPA_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
  const GUEST_KEY = 'tug-of-math-guest';
  const cfg = window.TUG_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const BOARDS = {
    wins:    { col: 'wins', asc: false },
    rank:    { col: 'rank_stars', asc: false, where: ['ranked_played', 0] },
    streak:  { col: 'best_streak', asc: false },
    answers: { col: 'total_correct', asc: false },
    fastest: { col: 'fastest_ms', asc: true },
  };
  const COLS = 'id, display_name, games_played, wins, best_streak, total_correct, fastest_ms, rank_stars, skin';
  let loading = null, signing = null;
  let online = false;
  let profile = null;
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
  async function currentUser() {
    const sb = await client();
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }
  function signIn() {
    if (!signing) {
      signing = (async () => {
        const user = await currentUser();
        if (user) return user;
        const { data, error } = await (await client()).auth.signInAnonymously();
        if (error) throw error;
        return data.user;
      })().catch(e => { signing = null; throw e; });
    }
    return signing;
  }
  const fail = (error, fallback) => new Error((error && error.message) || fallback);

  /* ---------- profile ---------- */
  function readGuest() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { /* storage blocked */ }
    if (!g || !g.id) g = { id: 'guest' + Math.random().toString(36).slice(2, 10), display_name: 'Player' };
    return { id: g.id, display_name: g.display_name || 'Player', coins: 0, rank_stars: 0, best_stars: 0, skin: 'classic',
      games_played: 0, wins: 0, losses: 0, draws: 0, total_correct: 0, best_streak: 0, fastest_ms: null, ranked_played: 0, ranked_wins: 0 };
  }
  function writeGuest() {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify({ id: profile.id, display_name: profile.display_name })); } catch (e) { /* storage blocked */ }
  }
  // sign in and load the profile; falls back to a guest when Supabase is unreachable
  async function init() {
    try {
      await signIn();
      await refresh();
      online = true;
    } catch (e) {
      console.warn('Tug of Math: playing offline.', e && e.message);
      online = false;
      profile = readGuest();
      owned = new Set(['classic']);
    }
    return profile;
  }
  async function refresh() {
    const user = await signIn();
    const sb = await client();
    const [p, o] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb.from('owned_skins').select('skin_id'),
    ]);
    if (p.error) throw fail(p.error, 'Could not load your profile.');
    if (!p.data) throw new Error('Your profile is missing. Run supabase/schema.sql.');
    if (!('coins' in p.data)) throw new Error('The database needs supabase/002_modes_ranks_skins.sql.');
    profile = p.data;
    owned = new Set(['classic', ...((o.data || []).map(r => r.skin_id))]);
    return profile;
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
      const { data, error } = await sb.rpc('submit_result', r);
      if (error) throw error;
      profile.coins = data.coins_total;
      profile.rank_stars = data.stars_after;
      profile.best_stars = Math.max(profile.best_stars || 0, data.stars_after);
      profile.games_played++;
      if (r.p_outcome === 'win') profile.wins++;
      if (r.p_mode === 'ranked') { profile.ranked_played++; if (r.p_outcome === 'win') profile.ranked_wins++; }
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
  async function leaderboard(board) {
    const b = BOARDS[board] || BOARDS.wins;
    const sb = await client();
    let q = sb.from('profiles').select(COLS).gt(b.where ? b.where[0] : 'games_played', b.where ? b.where[1] : 0);
    if (b.col === 'fastest_ms') q = q.not('fastest_ms', 'is', null);
    const { data, error } = await q
      .order(b.col, { ascending: b.asc, nullsFirst: false })
      .order('games_played', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20);
    if (error) throw fail(error, 'Could not load the leaderboard.');
    return data || [];
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
    configured, client, init, refresh, setName, saveResult, buySkin, equipSkin, leaderboard, history,
    get online() { return online; },
    get profile() { return profile; },
    owns: id => owned.has(id),
  };
})();
