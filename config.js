/* Online play settings.
   Fill both values to play over the internet through Supabase (room codes + Quick match).
   Leave them empty and the game falls back to PeerJS for internet play.

   Where to find them: Supabase dashboard → your project → Project Settings → API
     supabaseUrl      = "Project URL"          e.g. https://abcdxyz.supabase.co
     supabaseAnonKey  = "anon" / "publishable" key (safe to be public)

   NEVER put the service_role / secret key here. This file is public on the web. */
window.TUG_CONFIG = {
  supabaseUrl: 'https://irtnucbqbkddvrqbiaru.supabase.co',
  supabaseAnonKey: 'sb_publishable_jZsZg8jId_AwSA1LMliBvg_kpGwxNwS',
};
