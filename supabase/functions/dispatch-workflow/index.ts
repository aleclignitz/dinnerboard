// Supabase Edge Function: lets a signed-in board user start an allow-listed
// GitHub Actions workflow without exposing a GitHub token to the browser.
//
// Secrets (supabase secrets set ...):
//   GH_DISPATCH_TOKEN  fine-grained PAT, this repo only, "Actions: Read and write"
//   GH_REPO            e.g. "your-user/dinnerboard"
//   GH_REF             optional branch, default "main"
// Deploy with --no-verify-jwt; the user's session token is verified below.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED: Record<string, string> = { "seed-recipes": "seed-recipes.yml", "grocery-list": "grocery-list.yml" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in first" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return json(401, { error: "Invalid session" });

  let workflow = "";
  try { workflow = (await req.json()).workflow; } catch { /* fall through */ }
  const file = ALLOWED[workflow];
  if (!file) return json(400, { error: "Unknown workflow" });

  const repo = Deno.env.get("GH_REPO");
  const ghToken = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!repo || !ghToken) return json(500, { error: "Function is not configured (GH_REPO / GH_DISPATCH_TOKEN)" });

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dinnerboard-dispatch"
    },
    body: JSON.stringify({ ref: Deno.env.get("GH_REF") || "main" })
  });
  if (res.status !== 204) return json(502, { error: `GitHub returned ${res.status}` });
  return json(200, { ok: true });
});
