// ── Spending safeguards ────────────────────────────────────────────────────
// To kill ALL Claude calls immediately: set CLAUDE_ENABLED = "false"
// in Cloudflare Workers → Settings → Variables. No redeploy needed.
const MAX_INPUT_CHARS  = 24000;   // ~6,000 tokens — hard cap on prompt length
const MAX_OUTPUT_TOKENS_TEXT   = 1500;  // article generation cap
const MAX_OUTPUT_TOKENS_VISION = 800;   // box score scan cap
const MAX_IMAGE_BYTES  = 1_000_000; // reject images over ~1MB base64

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/.netlify/functions/claude" && request.method === "POST") {
      try {
        // ── Kill switch ──────────────────────────────────────────────────
        if (env.CLAUDE_ENABLED === "false") {
          return json({ error: "Claude API is currently disabled by the commissioner. Try again later." }, 503);
        }

        const body = await request.json();
        let { prompt, max_tokens, image } = body;

        const apiKey = env.VITE_ANTHROPIC_KEY || env.ANTHROPIC_KEY || env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return json({ error: "API key not configured. Add VITE_ANTHROPIC_KEY in Cloudflare Workers settings." }, 500);
        }

        // ── Image size guard ─────────────────────────────────────────────
        if (image) {
          const imageBytes = (image.data || "").length;
          if (imageBytes > MAX_IMAGE_BYTES) {
            return json({ error: `Image too large (${Math.round(imageBytes/1000)}KB). Max is ${MAX_IMAGE_BYTES/1000}KB. Try a smaller screenshot.` }, 413);
          }
        }

        // ── Prompt length guard ──────────────────────────────────────────
        if (prompt && prompt.length > MAX_INPUT_CHARS) {
          console.warn(`[worker] Prompt truncated from ${prompt.length} to ${MAX_INPUT_CHARS} chars`);
          prompt = prompt.slice(0, MAX_INPUT_CHARS) + "\n\n[Prompt truncated to stay within limits]";
        }

        // ── Output token cap ─────────────────────────────────────────────
        const tokenCap = image ? MAX_OUTPUT_TOKENS_VISION : MAX_OUTPUT_TOKENS_TEXT;
        const safeMaxTokens = Math.min(max_tokens || tokenCap, tokenCap);

        const messages = image
          ? [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
              { type: "text", text: prompt }
            ]}]
          : [{ role: "user", content: prompt }];

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: safeMaxTokens,
            messages,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return json({ error: err?.error?.message || `API error ${response.status}` }, response.status);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "No content returned.";

        // Log usage so it shows in Cloudflare logs
        const usage = data.usage || {};
        console.log(`[Claude] input=${usage.input_tokens} output=${usage.output_tokens} model=claude-sonnet-4-6 type=${image?"vision":"text"}`);

        return json({ text });

      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Serve static assets for everything else
    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
