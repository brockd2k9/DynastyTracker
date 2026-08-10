// Shared helpers for the /a/:id and /redzone share-preview functions. Mirrors the equivalent
// logic in worker.js (the Cloudflare Worker deployment) so both hosts unfurl links identically —
// keep the two in sync if this changes.
const SUPA_URL = "https://uyaqmdljwwslskoqxvpn.supabase.co";
const SUPA_KEY = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";

export async function fetchArticleById(id) {
  const r = await fetch(`${SUPA_URL}/rest/v1/dynasty_state?id=eq.main&select=articles`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  const articles = rows?.[0]?.articles || [];
  return articles.find(a => String(a.id) === String(id)) || null;
}

export function articleHeadline(text) {
  return (text || "").split("\n").map(l => l.trim()).find(l => l.length > 0) || (text || "").slice(0, 80) || "";
}

export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function siteOrigin(event) {
  const host = event.headers?.host || event.headers?.Host || "jackedupdynasty.com";
  return `https://${host}`;
}
