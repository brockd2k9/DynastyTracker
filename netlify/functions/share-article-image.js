// Serves /a/:id/image — decodes the article's stored base64 image into a real fetchable URL,
// since og:image needs an actual URL and a data: URI won't unfurl in link previews. Mirrors the
// /a/:id/image handler in worker.js.
import { fetchArticleById } from "./lib/shareHelpers.js";

export const handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: "Missing article id" };

  const article = await fetchArticleById(id);
  const dataUri = article?.imageUrl || "";
  const parsed = dataUri.match(/^data:([^;]+);base64,(.*)$/s);
  if (!parsed) return { statusCode: 404, body: "Not found" };

  return {
    statusCode: 200,
    headers: { "Content-Type": parsed[1], "Cache-Control": "public, max-age=31536000, immutable" },
    body: parsed[2],
    isBase64Encoded: true,
  };
};
