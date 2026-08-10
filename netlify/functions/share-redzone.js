// Serves the /redzone share-preview landing page. No per-item data (unlike articles), so this
// is just a fixed OG landing page that redirects real visitors into the app with ?tab=Redzone.
// Mirrors the /redzone handler in worker.js.
import { siteOrigin } from "./lib/shareHelpers.js";

export const handler = async (event) => {
  const origin = siteOrigin(event);
  const title = "Dynasty RedZone — Watch Live Now";
  const desc = "Live coach broadcasts from the dynasty league — jump in and watch.";
  const imageUrl = `${origin}/redzone-tv.png`;
  const pageUrl = `${origin}/redzone`;
  const appUrl = `${origin}/?tab=Redzone`;

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

  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=UTF-8" }, body: html };
};
