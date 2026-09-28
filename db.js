/* Tug of Math — player accounts, saved results and the leaderboard (Supabase).
   A player is signed in anonymously the first time a result is saved, so no
   email is needed; the session stays in this browser. The same client also
   carries online play (see net.js). Tables: supabase/schema.sql. */
const DB = (() => {
  const SUPA_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
  const cfg = window.TUG_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const BOARDS = {
    wins:    { col: 'wins', asc: false },
    streak:  { col: 'best_streak', asc: false },
    answers: { col: 'total_correct', asc: false },
    fastest: { col: 'fastest_ms', asc: true },
  };
  const COLS = 'id, display_name, games_played, wins, best_streak, total_correct, fastest_ms';
  let loading = null, signing = null, savedName = null;

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

  // r holds the submit_result() arguments; name is the player's name from the menu
  async function saveResult(r, name) {
    try {
      const user = await signIn();
      const sb = await client();
      if (name && name !== savedName) {
        const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', user.id);
        if (!error) savedName = name;
      }
      const { error } = await sb.rpc('submit_result', r);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('Tug of Math: result not saved.', e && e.message);
      return false;
    }
  }

  // top 20 for one board, plus this browser's own profile when it has one
  async function leaderboard(board) {
    const b = BOARDS[board] || BOARDS.wins;
    const sb = await client();
    let q = sb.from('profiles').select(COLS).gt('games_played', 0);
    if (b.col === 'fastest_ms') q = q.not('fastest_ms', 'is', null);
    const [list, user] = await Promise.all([
      q.order(b.col, { ascending: b.asc, nullsFirst: false })
        .order('games_played', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(20),
      currentUser(),
    ]);
    if (list.error) throw list.error;
    let me = null;
    if (user) {
      const { data } = await sb.from('profiles').select(COLS).eq('id', user.id).maybeSingle();
      me = data || null;
    }
    return { rows: list.data || [], me };
  }

  return { configured, client, saveResult, leaderboard };
})();
