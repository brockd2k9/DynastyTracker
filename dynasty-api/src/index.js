const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SCOREBOARD_SYSTEM =
  "You are parsing a College Football 27 video game screenshot. The screenshot may show " +
  "either a live scoreboard or a post-game box score screen. " +
  "The valid team names in this league are provided in the teams array. " +
  "For a scoreboard: team names appear at the top with the score displayed prominently. " +
  "For a box score: team names appear on the left and right sides, a quarter-by-quarter " +
  "score grid appears in the middle, and team stats are listed in rows below — the stat " +
  "category label is in the center column, the left team's value is on the left, and the " +
  "right team's value is on the right. " +
  "Extract and return ONLY valid JSON with no extra text or markdown: " +
  "{ home_team, away_team, home_score, away_score, " +
  "home_stats: { passing_yards, rushing_yards, total_yards, turnovers, interceptions }, " +
  "away_stats: { passing_yards, rushing_yards, total_yards, turnovers, interceptions } }. " +
  "Use 0 for any stat not visible. Match team names to the closest entry in the teams list. " +
  "home_team is the team on the left or listed as home; away_team is on the right or listed as away.";

const SCHEDULE_SYSTEM =
  "You are parsing a College Football 27 video game dynasty schedule screenshot. " +
  "The valid dynasty team names are provided in the teams array. " +
  "Extract every visible week and its matchups. For each week, identify every dynasty team " +
  "and their opponent. If the opponent is another dynasty team, use their exact name from " +
  "the teams list. If the opponent is a non-dynasty CPU-controlled team, write its team name " +
  "prefixed with 'CPU:' — for example 'CPU:Florida State' or 'CPU:Ohio'. Always include the " +
  "real school/team name if it is visible anywhere in the image; only write the bare literal " +
  "'CPU' (no colon, no name) if no opponent name is visible at all for that game. " +
  "If it is a bye week, write 'BYE'. " +
  "Return ONLY valid JSON in exactly this format with no extra text or markdown: " +
  "{\"1\":{\"TeamA\":\"TeamB\",\"TeamB\":\"TeamA\"},\"2\":{\"TeamA\":\"CPU:Florida State\"},\"3\":{\"TeamA\":\"BYE\"}} " +
  "Use only week numbers as keys (integers as strings). Only include weeks and teams " +
  "visible in the image. Match all dynasty team names to the closest entry in the teams list — " +
  "never match a CPU opponent's name to an entry in the teams list.";

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

    const { image, mediaType, teams, type = "scoreboard" } = body;
    if (!image || !mediaType || !Array.isArray(teams)) {
      return json({ error: "Missing required fields: image, mediaType, teams" }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const isSchedule = type === "schedule";
    const systemPrompt = isSchedule ? SCHEDULE_SYSTEM : SCOREBOARD_SYSTEM;
    const teamsText = teams.length > 0 ? `\n\nValid team names: ${teams.join(", ")}` : "";
    const userText = isSchedule
      ? `Parse this schedule screenshot and return JSON.${teamsText}`
      : `Parse this scoreboard screenshot and return JSON.${teamsText}`;
    const maxTokens = isSchedule ? 2000 : 512;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text", text: userText },
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

    // For schedule, extract just the outermost JSON object in case of extra text
    const toparse = isSchedule ? (cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned) : cleaned;

    let parsed;
    try {
      parsed = JSON.parse(toparse);
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
