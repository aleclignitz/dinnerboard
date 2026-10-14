import { createClient } from "@supabase/supabase-js";

// Secret key (starts "sb_secret_"), not the publishable key - this bypasses
// Row Level Security, so it must only ever run server-side (GitHub Actions).
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getDoc(supabase, path) {
  const { data, error } = await supabase.from("documents").select("data").eq("path", path).maybeSingle();
  if (error) throw error;
  return data ? data.data : undefined;
}

// Collection reads assume shallow paths ("col/id"), matching the board's data model.
export async function getCollection(supabase, col) {
  const prefix = col + "/";
  const { data, error } = await supabase.from("documents").select("path,data").like("path", prefix + "%");
  if (error) throw error;
  return (data || [])
    .filter((r) => r.path.slice(prefix.length).indexOf("/") === -1)
    .map((r) => ({ id: r.path.slice(prefix.length), ...r.data }));
}

export async function setDoc(supabase, path, data) {
  const { error } = await supabase.from("documents").upsert({ path, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteDoc(supabase, path) {
  const { error } = await supabase.from("documents").delete().eq("path", path);
  if (error) throw error;
}
