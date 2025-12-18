/* assets/config.js
   Local (non-committed) overrides for Cyber Solutions LLC Schedule Manager.
   This file is ignored by git via .gitignore.

   If you later enable Supabase, set:
     USE_CLOUD: true,
     SUPABASE_URL: "...",
     SUPABASE_ANON_KEY: "..."
*/

// eslint-disable-next-line no-unused-vars
window.APP_CONFIG = {
  ...(window.APP_CONFIG || {}),
  USE_CLOUD: false,
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};

