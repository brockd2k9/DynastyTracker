// ── Spending safeguards ────────────────────────────────────────────────────
// To kill ALL Claude calls immediately: set CLAUDE_ENABLED = "false"
// in Cloudflare Workers → Settings → Variables. No redeploy needed.
const MAX_INPUT_CHARS  = 24000;   // ~6,000 tokens — hard cap on prompt length
const MAX_OUTPUT_TOKENS_TEXT   = 1500;  // article generation cap
const MAX_OUTPUT_TOKENS_VISION = 800;   // box score scan cap
const MAX_IMAGE_BYTES  = 2_000_000; // reject images over ~2MB base64

// ── Article sharing (GroupMe/Discord/iMessage link unfurling) ──────────────
// These apps fetch the raw URL server-side and read <meta property="og:..">
// tags before any JS runs, so the share target has to be rendered here, not
// in the React app. /a/:id serves that landing page (thumbnail + headline,
// then redirects real visitors into the app); /a/:id/image decodes the
// article's stored base64 image into a real fetchable URL, since og:image
// needs an actual URL — a data: URI won't unfurl in any of these apps.
const SUPA_URL = "https://uyaqmdljwwslskoqxvpn.supabase.co";
const SUPA_KEY = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";

async function fetchArticleById(id) {
  const r = await fetch(`${SUPA_URL}/rest/v1/dynasty_state?id=eq.main&select=articles`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  const articles = rows?.[0]?.articles || [];
  return articles.find(a => String(a.id) === String(id)) || null;
}

function articleHeadline(text) {
  return (text||"").split("\n").map(l=>l.trim()).find(l=>l.length>0) || (text||"").slice(0,80) || "";
}

function escapeHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const shareMatch = url.pathname.match(/^\/a\/([^/]+)$/);
    if (shareMatch && request.method === "GET") {
      const article = await fetchArticleById(shareMatch[1]);
      if (!article) return new Response("Article not found", { status: 404 });
      const headline = escapeHtml(articleHeadline(article.text));
      const lines = (article.text||"").split("\n").map(l=>l.trim()).filter(Boolean);
      const desc = escapeHtml(lines[1] || `${article.label||"Dynasty Central"} · ${article.reporter||""}`);
      const imageUrl = article.imageUrl ? `${url.origin}/a/${shareMatch[1]}/image` : `${url.origin}/jackedupdynastywhite.png`;
      const pageUrl = `${url.origin}/a/${shareMatch[1]}`;
      const appUrl = `${url.origin}/?article=${encodeURIComponent(shareMatch[1])}`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${headline}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta property="og:title" content="${headline}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:type" content="article">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${imageUrl}">
<meta http-equiv="refresh" content="0; url=${appUrl}">
</head><body>
<script>location.replace(${JSON.stringify(appUrl)});</script>
<p>Redirecting to <a href="${appUrl}">${headline}</a>…</p>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    const imgMatch = url.pathname.match(/^\/a\/([^/]+)\/image$/);
    if (imgMatch && request.method === "GET") {
      const article = await fetchArticleById(imgMatch[1]);
      const dataUri = article?.imageUrl || "";
      const parsed = dataUri.match(/^data:([^;]+);base64,(.*)$/s);
      if (!parsed) return new Response("Not found", { status: 404 });
      const bytes = Uint8Array.from(atob(parsed[2]), c => c.charCodeAt(0));
      return new Response(bytes, { headers: { "Content-Type": parsed[1], "Cache-Control": "public, max-age=31536000, immutable" } });
    }

    // /redzone shares the RedZone tab specifically. No per-item data (unlike
    // articles) so this is just a fixed OG landing page that redirects into
    // the app with ?tab=Redzone.
    if (url.pathname === "/redzone" && request.method === "GET") {
      const title = "Dynasty RedZone — Watch Live Now";
      const desc = "Live coach broadcasts from the dynasty league — jump in and watch.";
      const imageUrl = `${url.origin}/redzone-tv.png`;
      const pageUrl = `${url.origin}/redzone`;
      const appUrl = `${url.origin}/?tab=Redzone`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${imageUrl}">
<meta http-equiv="refresh" content="0; url=${appUrl}">
</head><body>
<script>location.replace(${JSON.stringify(appUrl)});</script>
<p>Redirecting to <a href="${appUrl}">${title}</a>…</p>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (url.pathname === "/.netlify/functions/claude" && request.method === "POST") {
      try {
        // ── Kill switch ──────────────────────────────────────────────────
        if (env.CLAUDE_ENABLED === "false") {
          return json({ error: "Claude API is currently disabled by the commissioner. Try again later." }, 503);
        }

        const body = await request.json();
        let { prompt, max_tokens, image, images } = body;
        const imageList = (images && images.length) ? images : (image ? [image] : []);

        const apiKey = env.VITE_ANTHROPIC_KEY || env.ANTHROPIC_KEY || env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return json({ error: "API key not configured. Add VITE_ANTHROPIC_KEY in Cloudflare Workers settings." }, 500);
        }

        // ── Image size guard (checks every image when there's more than one) ──
        for (const img of imageList) {
          const imageBytes = (img.data || "").length;
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
        const tokenCap = imageList.length ? MAX_OUTPUT_TOKENS_VISION : MAX_OUTPUT_TOKENS_TEXT;
        const safeMaxTokens = Math.min(max_tokens || tokenCap, tokenCap);

        const messages = imageList.length
          ? [{ role: "user", content: [
              ...imageList.map(img => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
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
        console.log(`[Claude] input=${usage.input_tokens} output=${usage.output_tokens} model=claude-sonnet-4-6 type=${imageList.length?`vision(${imageList.length})`:"text"}`);

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
