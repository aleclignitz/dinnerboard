// Fill in from Supabase: Settings -> API Keys. Use the publishable key
// (starts "sb_publishable_"), not the secret key - the publishable key is
// safe to expose here; Row Level Security (see sql/schema.sql) is what
// actually restricts access, not secrecy of this key. The legacy "anon"
// key still works but Supabase is deprecating it by end of 2026.
window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  publishableKey: "sb_publishable_..."
};
