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
  if (json.stop_reason === "max_tokens") {
    console.warn("Claude reply was cut off by max_tokens - response is likely truncated/incomplete.");
  }
  return json.content.map((block) => block.text || "").join("");
}

// Claude sometimes wraps JSON replies in ```/```json fences despite being
// told not to - strip those before parsing instead of failing on them.
// A closing fence may be missing if the reply got cut off by max_tokens.
export function parseClaudeJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const opened = raw.match(/```(?:json)?\s*([\s\S]*)/i);
  const text = opened ? opened[1] : raw;
  try {
    return JSON.parse(text);
  } catch (err) {
    return repairTruncatedJson(text);
  }
}

// Best-effort recovery for a reply cut off mid-element by max_tokens: walk
// the text tracking string/nesting state, find the last point where a value
// was fully complete, truncate there, and close any still-open brackets -
// using the bracket stack as it stood AT that point, not at end of text.
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false;
  let escape = false;
  let lastSafeIndex = -1;
  let lastSafeStack = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') {
        inString = false;
        lastSafeIndex = i;
        lastSafeStack = stack.slice();
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      lastSafeIndex = i;
      lastSafeStack = stack.slice();
    } else if (ch === ",") {
      lastSafeIndex = i - 1;
      lastSafeStack = stack.slice();
    }
  }
  if (lastSafeIndex < 0 || !lastSafeStack || lastSafeStack.length === 0) {
    throw new Error("Could not repair truncated JSON reply");
  }
  let truncated = text.slice(0, lastSafeIndex + 1);
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    truncated += lastSafeStack[i] === "{" ? "}" : "]";
  }
  return JSON.parse(truncated);
}
