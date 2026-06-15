const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/parse-screenshot") {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { image, mediaType, teams } = body;
    if (!image || !mediaType || !Array.isArray(teams)) {
      return json({ error: "Missing required fields: image, mediaType, teams" }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const systemPrompt =
      "You are parsing a College Football 27 video game scoreboard screenshot. " +
      "The valid team names in this league are provided in the teams array. " +
      "Extract and return ONLY valid JSON: { home_team, away_team, home_score, away_score, " +
      "home_stats: { passing_yards, rushing_yards, total_yards, turnovers }, " +
      "away_stats: { passing_yards, rushing_yards, total_yards, turnovers } }. " +
      "Match team names to the closest name from the provided teams list.";

    const teamsText = teams.length > 0
      ? `\n\nValid team names: ${teams.join(", ")}`
      : "";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              {
                type: "text",
                text: `Parse this scoreboard screenshot and return JSON.${teamsText}`,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return json({ error: "Anthropic API error", detail: err }, 502);
    }

    const anthropicData = await anthropicRes.json();
    const rawText = anthropicData.content?.[0]?.text ?? "";

    // Strip markdown code fences if present
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "Failed to parse model response as JSON", raw: rawText }, 502);
    }

    return json(parsed, 200);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
