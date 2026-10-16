// Thin wrapper around the Claude Messages API. Check docs.anthropic.com for
// the current model id before relying on this long-term.
export async function askClaude({ system, prompt, maxTokens = 4000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content.map((block) => block.text || "").join("");
}

// Claude sometimes wraps JSON replies in ```/```json fences despite being
// told not to - strip those before parsing instead of failing on them.
export function parseClaudeJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : raw);
}
