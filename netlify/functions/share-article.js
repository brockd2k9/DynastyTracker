// Serves the /a/:id share-preview landing page (via a netlify.toml redirect that maps
// /a/:id -> /.netlify/functions/share-article?id=:id). GroupMe/Discord/iMessage etc. fetch the
// raw URL server-side and read <meta property="og:..."> tags before any JS runs, so this has to
// render server-side rather than in the React app. Real visitors get bounced into the app via
// both a meta-refresh and a JS redirect. Mirrors the /a/:id handler in worker.js.
import { fetchArticleById, articleHeadline, escapeHtml, siteOrigin } from "./lib/shareHelpers.js";

export const handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: "Missing article id" };

  const article = await fetchArticleById(id);
  if (!article) return { statusCode: 404, body: "Article not found" };

  const origin = siteOrigin(event);
  const headline = escapeHtml(articleHeadline(article.text));
  const lines = (article.text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const desc = escapeHtml(lines[1] || `${article.label || "Dynasty Central"} · ${article.reporter || ""}`);
  const imageUrl = article.imageUrl ? `${origin}/a/${id}/image` : `${origin}/jackedupdynastywhite.png`;
  const pageUrl = `${origin}/a/${id}`;
  const appUrl = `${origin}/?article=${encodeURIComponent(id)}`;

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

  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=UTF-8" }, body: html };
};
