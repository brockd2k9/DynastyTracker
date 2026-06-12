export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle the Claude API proxy
    if (url.pathname === "/.netlify/functions/claude" && request.method === "POST") {
      try {
        const body = await request.json();
        const { prompt, max_tokens = 1200, image } = body;

        const messages = image
          ? [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }, { type: "text", text: prompt }] }]
          : [{ role: "user", content: prompt }];

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.VITE_ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens,
            messages,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          return new Response(JSON.stringify({ error: err?.error?.message || `API error ${response.status}` }), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "No content returned.";
        return new Response(JSON.stringify({ text }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Serve static assets for everything else
    return env.ASSETS.fetch(request);
  },
};
