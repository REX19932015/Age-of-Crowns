/* =====================================================================
   AGE OF CROWNS: ONLINE SETTINGS  (the only file you need to edit)
   =====================================================================
   1. SUPABASE_URL              Supabase → Project Settings → API → Project URL
   2. SUPABASE_PUBLISHABLE_KEY  Supabase → Project Settings → API Keys → Publishable key
                                (starts with sb_publishable_…; an older "anon" key also works)
   3. SERVER_URL                Where your multiplayer server runs, e.g. wss://age-of-crowns.onrender.com
                                Use wss:// when the game is served over https, ws://localhost:8080 for local testing.

   NEVER put the secret / service_role key here. It belongs only in server/.env.
   Leave any value empty to play offline exactly as before.
   ===================================================================== */
window.AOC_CONFIG = {
  SUPABASE_URL: '',              // e.g. 'https://abcdefghijklmno.supabase.co'
  SUPABASE_PUBLISHABLE_KEY: '',  // e.g. 'sb_publishable_xxxxxxxxxxxxxxxxxxxx'
  SERVER_URL: '',                // e.g. 'wss://age-of-crowns.onrender.com'
};
