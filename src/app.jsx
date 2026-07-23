
import { useState, useEffect, useRef, useCallback, useContext, createContext, Fragment } from "react";

const NavCtx = createContext(null);
function Name({children, userId, userName, style={}}) {
  const nav = useContext(NavCtx);
  if (!nav) return <span style={style}>{children}</span>;
  return <span onClick={e=>{e.stopPropagation();nav(userId, userName);}} style={{cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:2,...style}} title={`View ${children}'s profile`}>{children}</span>;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

// ── Supabase config ───────────────────────────────────────────────────────
const SUPA_URL = "https://uyaqmdljwwslskoqxvpn.supabase.co";
const SUPA_KEY = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";
const SUPA_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPA_KEY,
  "Authorization": `Bearer ${SUPA_KEY}`,
};

async function dbLoad() {
  const r = await fetch(`${SUPA_URL}/rest/v1/dynasty_state?id=eq.main&select=*`, {headers: SUPA_HEADERS});
  const d = await r.json();
  return d[0] || null;
}

async function dbSave(data) {
  await fetch(`${SUPA_URL}/rest/v1/dynasty_state?id=eq.main`, {
    method: "PATCH",
    headers: {...SUPA_HEADERS, "Prefer": "return=minimal"},
    body: JSON.stringify({...data, updated_at: new Date().toISOString()}),
  });
}

// Add schedule column to Supabase if needed (run once)
async function ensureScheduleColumn() {
  // The schedule is stored as JSONB in dynasty_state
  // No migration needed - Supabase JSONB handles new keys automatically
}

const CONF_STAND_PTS = [50,43,36,30,24,18,14,10,7,5,3,1];
const RECRUITING_PTS = [15,10,7,5,3,0,0,0,0,0,0,0];
const DEFAULT_PTS_CONFIG = {
  win:15, top25Bonus:5, top10Bonus:10,
  confStand:[50,43,36,30,24,18,14,10,7,5,3,1],
  confChampApp:10, confChampWin:15,
  bowlApp:5, bowlWin:10,
  playoffApp:15, playoffWin:10, playoffSemiWin:15, playoffR3Win:20, nattyWin:25,
  recruiting:[15,10,7,5,3],
  dynastyTop5:[15,10,7,5,3],
  prestigeGain:10, prestigeMax:10, heisman:15,
};
const FIXED_CATS = [
  {key:"regular",label:"🏈 Regular Season",items:[{label:"Win",k:"win"},{label:"Top 25 Bonus",k:"top25Bonus"},{label:"Top 10 Bonus",k:"top10Bonus"}]},
  {key:"confStand",label:"📊 Conference Standings",arrayKey:"confStand",posLabel:i=>`${i+1}${i===0?"st":i===1?"nd":i===2?"rd":"th"} place`},
  {key:"confChamp",label:"🏆 Conference Championship",items:[{label:"Appear",k:"confChampApp"},{label:"Win",k:"confChampWin"}]},
  {key:"bowlPlayoff",label:"🥣 Bowl & Playoff",items:[{label:"Bowl App",k:"bowlApp"},{label:"Bowl Win",k:"bowlWin"},{label:"Playoff App",k:"playoffApp"},{label:"Playoff Win",k:"playoffWin"},{label:"Semi Win",k:"playoffSemiWin"},{label:"R3 Win",k:"playoffR3Win"},{label:"Natty Win",k:"nattyWin"}]},
  {key:"recruiting",label:"🎓 Recruiting",arrayKey:"recruiting",posLabel:i=>`#${i+1} Recruiting`},
  {key:"dynastyTop5",label:"🏅 Dynasty Top 5",arrayKey:"dynastyTop5",posLabel:i=>`#${i+1} in Dynasty`},
  {key:"awards",label:"⭐ Awards",items:[{label:"Prestige Gain",k:"prestigeGain"},{label:"Max Prestige",k:"prestigeMax"},{label:"Heisman",k:"heisman"}]},
];
const START_YEAR = 2024;
const PASS = "RatedRKO99";
const MODEL = "claude-sonnet-4-6";
const WORKER_PROXY = "/.netlify/functions/claude";

// sonnet-4-6 pricing: $3/MTok input, $15/MTok output
const COST_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;
const MAX_SESSION_CALLS = 20;
const TOKEN_LIMIT = 8000;
const CALL_COOLDOWN_MS = 3000;

let _claudeInFlight = false;
let _sessionCallCount = 0;
let _lastCallFinishedAt = 0;

function _estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function _logCost(label, inputTokens, outputTokens) {
  const inputCents = inputTokens * COST_PER_INPUT_TOKEN * 100;
  const outputCents = outputTokens * COST_PER_OUTPUT_TOKEN * 100;
  console.log(
    `[Claude API] ${label} | model: ${MODEL} | input: ~${inputTokens} tokens ($${inputCents.toFixed(4)}¢) | output: ~${outputTokens} tokens ($${outputCents.toFixed(4)}¢) | total: ~$${(inputCents+outputCents).toFixed(4)}¢ | session calls: ${_sessionCallCount}/${MAX_SESSION_CALLS}`
  );
}

function _checkSafeguards(promptText) {
  if (_sessionCallCount >= MAX_SESSION_CALLS) {
    throw new Error("API call limit reached for this session — refresh to continue");
  }
  const now = Date.now();
  const elapsed = now - _lastCallFinishedAt;
  if (_lastCallFinishedAt > 0 && elapsed < CALL_COOLDOWN_MS) {
    throw new Error(`Please wait ${Math.ceil((CALL_COOLDOWN_MS - elapsed) / 1000)}s before making another request`);
  }
  const estimated = _estimateTokens(promptText);
  if (estimated > TOKEN_LIMIT) {
    console.warn(`[Claude API] Prompt estimated at ${estimated} tokens — truncating to ${TOKEN_LIMIT}`);
    return promptText.slice(0, TOKEN_LIMIT * 4) + "\n\n[Context truncated for token limit]";
  }
  return promptText;
}

function genId() {
  return Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
}

const INITIAL_ENTRY = (userName, teamName, userId="") => ({
  userId: userId || genId(),
  userName, teamName, wins:0, losses:0, confWins:0, confLosses:0,
  gamePts:0, rankedBonusPts:0, confStandPts:0,
  confChampPts:0, bowlPts:0, recruitingPts:0,
  prestigePts:0, heismanPts:0, weekLog:[],
  h2h:{},
});

const FRESH_PSI = (entries) => ({
  confStandings: entries.map((e,i)=>({teamName:e.teamName,rank:i+1})),
  confChampGame: {teamA:"",teamB:"",winner:""},
  bowlGames: [],
  playoffR1: [],
  playoffR2: [],
  playoffR3: [],
  nattyGame: {teamA:"",teamB:"",winner:""},
  recruiting: entries.map((e,i)=>({teamName:e.teamName,rank:i+1})),
  dynastyTop5: entries.map((e,i)=>({teamName:e.teamName,rank:i+1})),
  heisman:"",
  prestigeGains:[],
  maxPrestige:[],
});

// schedule shape: { week: { teamName: "Opponent" | "CPU" | "CPU:<name>" | "BYE" } }
// e.g. { 1: { Troy: "Georgia Southern", "Georgia Southern": "Troy", Toledo: "CPU:Ohio", UNLV: "BYE" } }

// A CPU opponent is either the bare literal "CPU" (no name captured) or "CPU:<name>" (name parsed/entered).
function isCPUOpp(v) { return v==="CPU" || (typeof v==="string" && v.startsWith("CPU:")); }
// Raw parsed/typed CPU team name, or "" if none was captured.
function cpuOppName(v) { return (typeof v==="string" && v.startsWith("CPU:")) ? v.slice(4) : ""; }
// Display text for any opponent value: dynasty team name, "BYE", "<name> (CPU)", or plain "CPU".
function formatOpp(v) {
  if (v==="BYE") return "BYE";
  if (isCPUOpp(v)) { const name=cpuOppName(v); return name ? `${name} (CPU)` : "CPU"; }
  return v || "";
}

// Extract the first balanced {...} object from text, ignoring braces inside quoted strings.
// More robust than a greedy regex when the model adds stray commentary containing "}" characters.
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

// ── Team name matching for schedule scans ────────────────────────────────
// The vision model reliably transcribes team names but is unreliable at judging
// "is this abbreviation the same school as my roster entry" (e.g. "Washington State"
// in-game vs "Washington St" on the roster) — so that decision is made here in plain,
// testable JS instead of leaving it to model judgment.
function normalizeTeamWords(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/['‘’ʼʻ`´]/g, "") // strip apostrophe variants (e.g. Hawai'i)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bstate\b/g, "st")
    .split(/\s+/)
    .filter(Boolean);
}
function teamWordsMatch(a, b) {
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
}
function teamWordCoverage(rawWords, rosterWords) {
  if (!rawWords.length || !rosterWords.length) return 0;
  let ri = 0, matched = 0;
  for (const rw of rosterWords) {
    let found = false;
    for (let i = ri; i < rawWords.length; i++) {
      if (teamWordsMatch(rw, rawWords[i])) { ri = i + 1; found = true; matched++; break; }
    }
    if (!found) return 0;
  }
  return matched / rosterWords.length;
}
// Returns the matching roster team name, or null if rawName doesn't correspond to any dynasty team
// (i.e. it's a non-dynasty CPU opponent). Requires full word coverage in either direction.
function matchDynastyTeam(rawName, teamNames) {
  const rawWords = normalizeTeamWords(rawName);
  let best = null, bestScore = 0;
  for (const t of teamNames) {
    const rosterWords = normalizeTeamWords(t);
    const score = Math.max(teamWordCoverage(rawWords, rosterWords), teamWordCoverage(rosterWords, rawWords));
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 1.0 ? best : null;
}

function calcTotal(t) {
  if (t.historicalTotal !== undefined) return t.historicalTotal;
  return (t.gamePts||0)+(t.rankedBonusPts||0)+(t.confStandPts||0)+(t.confChampPts||0)+(t.bowlPts||0)+(t.recruitingPts||0)+(t.prestigePts||0)+(t.heismanPts||0);
}

// Numeric input that allows free backspace/delete without React fighting the cursor
function NumField({value, onChange, width=52, style={}, fontSize=12, bold=true}) {
  const [str, setStr] = useState(String(value??0));
  const focused = useRef(false);
  useEffect(()=>{if(!focused.current)setStr(String(value??0));},[value]);
  const ff2="'Helvetica Neue',Arial,sans-serif";
  return <input type="text" inputMode="numeric" pattern="[0-9]*"
    value={str}
    onFocus={e=>{focused.current=true;setStr(String(value??0));e.target.select();}}
    onChange={e=>{const v=e.target.value;if(/^\d*$/.test(v)){setStr(v);onChange(v===''?0:parseInt(v,10));}}}
    onBlur={e=>{focused.current=false;const n=parseInt(e.target.value,10);const safe=isNaN(n)?0:n;setStr(String(safe));onChange(safe);}}
    style={{width,padding:"3px 5px",border:"1px solid #ddd",borderRadius:2,fontSize,fontWeight:bold?700:400,textAlign:"center",fontFamily:ff2,...style}}/>;
}

function cleanArticle(text) {
  return text
    .replace(/#{1,6}\s*/g, "")        // remove # headings
    .replace(/\*\*([^*]+)\*\*/g, "$1") // remove **bold**
    .replace(/\*([^*]+)\*/g, "$1")     // remove *italic*
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1") // remove __underline__
    .replace(/^\s*[-•]\s+/gm, "")     // remove bullet dashes
    .replace(/^\s*\d+\.\s+/gm, "")    // remove numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // remove [links](url)
    .replace(/`[^`]+`/g, (m)=>m.slice(1,-1)) // remove backtick code
    .replace(/\n{3,}/g, "\n\n")        // collapse excess blank lines
    .replace(/—/g, "-")                // em dash to hyphen
    .replace(/–/g, "-")                // en dash to hyphen
    .replace(/[""]/g, '"')             // smart quotes to straight
    .replace(/['']/g, "'")             // smart apostrophes to straight
    .trim();
}

function articleHeadline(text) {
  return (text||"").split("\n").map(l=>l.trim()).find(l=>l.length>0) || text?.slice(0,80) || "";
}

// Everything after the headline line, for display once the headline is pulled out into its own element.
function articleBodyWithoutHeadline(text) {
  const lines = (text||"").split("\n");
  const idx = lines.findIndex(l=>l.trim().length>0);
  if (idx===-1) return "";
  return lines.slice(idx+1).join("\n").replace(/^\n+/,"");
}

async function callClaudeVision(imageBase64, mediaType, prompt) {
  if (_claudeInFlight) { console.warn("[callClaudeVision] Call already in flight — skipped"); return ""; }
  const safePrompt = _checkSafeguards(prompt);
  _claudeInFlight = true;
  _sessionCallCount++;
  try {
    const r = await fetch(WORKER_PROXY, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({prompt:safePrompt, max_tokens:1024, image:{data:imageBase64, media_type:mediaType}}),
    });
    if (!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.error||`API error ${r.status}`);}
    const data = await r.json();
    const outputText = data.text||"";
    _logCost("Vision/scorecard scan", _estimateTokens(safePrompt) + 300, _estimateTokens(outputText));
    return outputText;
  } finally {
    _claudeInFlight = false;
    _lastCallFinishedAt = Date.now();
  }
}

// Same as callClaudeVision but for box scores split across two screenshots (e.g. one screen per
// team) — sends every image in the same request so the model can combine them into one box score.
async function callClaudeVisionMulti(images, prompt) {
  if (_claudeInFlight) { console.warn("[callClaudeVisionMulti] Call already in flight — skipped"); return ""; }
  const safePrompt = _checkSafeguards(prompt);
  _claudeInFlight = true;
  _sessionCallCount++;
  try {
    const r = await fetch(WORKER_PROXY, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({prompt:safePrompt, max_tokens:1400, images:images.map(img=>({data:img.data, media_type:img.mediaType}))}),
    });
    if (!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.error||`API error ${r.status}`);}
    const data = await r.json();
    const outputText = data.text||"";
    _logCost("Vision/scorecard scan (multi-image)", _estimateTokens(safePrompt) + 300*images.length, _estimateTokens(outputText));
    return outputText;
  } finally {
    _claudeInFlight = false;
    _lastCallFinishedAt = Date.now();
  }
}

async function callClaude(prompt) {
  if (_claudeInFlight) { console.warn("[callClaude] Call already in flight — skipped"); return ""; }
  const safePrompt = _checkSafeguards(prompt);
  _claudeInFlight = true;
  _sessionCallCount++;
  try {
    const timeoutId = { ref: null };
    const timeout = new Promise((_,reject)=>{ timeoutId.ref = setTimeout(()=>reject(new Error("Request timed out after 45s")),45000); });
    const req = fetch(WORKER_PROXY, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({prompt:safePrompt, max_tokens:4096}),
    });
    const r = await Promise.race([req, timeout]);
    clearTimeout(timeoutId.ref);
    if (!r.ok) {const err=await r.json().catch(()=>({}));throw new Error(err?.error||`API error ${r.status}`);}
    const d = await r.json();
    const outputText = d.text || "No content returned.";
    _logCost("Article/text generation", _estimateTokens(safePrompt), _estimateTokens(outputText));
    return outputText;
  } finally {
    _claudeInFlight = false;
    _lastCallFinishedAt = Date.now();
  }
}

// Matches callClaude's CALL_COOLDOWN_MS (3000ms) — anything chained right after a callClaude
// resolves needs to wait this long before calling it again, or _checkSafeguards throws.
const sleep = ms => new Promise(res=>setTimeout(res,ms));
// Deliberate gap between the week recap/standings post and the Game of the Week post, so the
// two don't land in GroupMe back-to-back — well clear of CALL_COOLDOWN_MS on its own.
const GOTW_STAGGER_MS = 30000;

async function postToGroupMe(text) {
  const r = await fetch("/api/groupme-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error || `GroupMe post failed (${r.status})`); }
}

const ff = "'Helvetica Neue',Arial,sans-serif";
const RED = "#cc0000";

// ── Game Archive helpers ──────────────────────────────────────────────────────

const EMPTY_BOX_TEAM = () => ({
  name:"", userId:"", score:0,
  passing:{comp:0,att:0,pct:0,yds:0,tds:0,int:0},
  rushing:{att:0,yds:0,ypc:0,tds:0},
  defense:{totalYdsAllowed:0,passYdsAllowed:0,rushYdsAllowed:0},
  specialTeams:{fgMade:0,fgAtt:0,krTds:0,prTds:0,prYds:0,krYds:0,punts:0,puntYds:0},
  misc:{firstDowns:0,totalPlays:0,totalYds:0,turnovers:0,fumblesLost:0,thirdDownConv:0,thirdDownAtt:0,fourthDownConv:0,fourthDownAtt:0,twoPtConv:0,twoPtAtt:0,redZoneTD:0,redZoneFG:0,redZonePct:0,penalties:0,penaltyYds:0,timeOfPossession:""},
  quarters:[],
});

// One team's half of the box score JSON schema asked of the vision scan — shared by both the
// conference-matchup and CPU-game upload prompts so they can't drift out of sync with each other.
const BOX_SCORE_TEAM_SCHEMA = `{"name":"","score":0,"quarters":[0,0,0,0],"passing":{"comp":0,"att":0,"pct":0.0,"yds":0,"tds":0,"int":0},"rushing":{"att":0,"yds":0,"ypc":0.0,"tds":0},"specialTeams":{"fgMade":0,"fgAtt":0,"krTds":0,"prTds":0,"prYds":0,"krYds":0,"punts":0,"puntYds":0},"misc":{"firstDowns":0,"totalPlays":0,"totalYds":0,"turnovers":0,"fumblesLost":0,"thirdDownConv":0,"thirdDownAtt":0,"fourthDownConv":0,"fourthDownAtt":0,"twoPtConv":0,"twoPtAtt":0,"redZoneTD":0,"redZoneFG":0,"redZonePct":0,"penalties":0,"penaltyYds":0,"timeOfPossession":""}}`;

// Asking one Claude call to hold BOTH teams' stats in its head at once turned out to have a
// distinct failure mode from row-transposition: it would read an entire column correctly and
// self-consistently, then attach the WRONG team's name to that (otherwise perfectly formed)
// block — a full swap that passes any same-team internal-consistency check, since the numbers
// really are internally consistent, just filed under the other team's name. The fix is to never
// let the model hold both teams at once: each call extracts ONLY one side, so there's no second
// team's identity for it to cross-wire with.
function buildBoxScoreSidePrompt(side, multiImage) {
  const other = side==="LEFT"?"RIGHT":"LEFT";
  return `${multiImage?"These are two video game box score screenshots that together show":"This is a video game box score screenshot that shows"} the full box score for one college football game, with two teams' stats side by side as two columns (or two stacked panels) — one on the ${side}, one on the ${other}.

Extract ONLY the ${side}-side (or ${side==="LEFT"?"top":"bottom"}-panel) team. Ignore the ${other} side completely — do not let anything about it end up in your answer.

Before answering, work through it step by step in plain text:
1. Read the team name directly off the logo/header on the ${side} side — don't infer it from anything else, and don't let the other side's name cross your mind here.
2. Go stat row by stat row and read off ONLY the ${side} side's number for each row, top to bottom.
3. Self-check before finalizing: this team's passing yards + rushing yards should land close to its own "Total Yards" stat, its passing attempts + rushing attempts should land close to its own "Total Plays" stat, and its quarters should sum to its own final score.

Then output ONLY the final JSON for this one team, wrapped in <answer></answer> tags with nothing else inside them (use 0 for any stat you can't find). Read the team's name exactly as shown in the image (school name/logo label) into the "name" field — get this right, it's used to match the team. quarters is that team's score in each quarter shown in the quarter-by-quarter scoring line, in order (add a 5th element only if there was an overtime period) — the quarters must sum to the final score. totalYds is the box score's own "Total Yards" stat (may differ slightly from passing+rushing yards). timeOfPossession as a "MM:SS" string. redZoneTD/redZoneFG/redZonePct come from the "Red Zone TD-FG-%" line in that order:
<answer>${BOX_SCORE_TEAM_SCHEMA}</answer>`;
}

// The vision scan is now asked to reason step-by-step before its final JSON (helps catch the
// model transposing a stat row between the two teams), so the response isn't pure JSON anymore
// — pull out just the <answer> tag's contents. Falls back to the whole response for safety if
// the model ever drops the tags, since the old prompt's plain-JSON responses still need to parse.
function extractBoxScoreJson(text) {
  const tagged = text.match(/<answer>([\s\S]*?)<\/answer>/i);
  return (tagged ? tagged[1] : text).replace(/```json?|```/g,"").trim();
}

// Box score screenshots (phone/console captures) usually run well above the ~1568px-long-edge
// point where Claude's vision pricing caps out — Anthropic downsizes anything larger before
// tokenizing it, so sending the original resolution just burns bandwidth without buying any
// extra accuracy. Shrinking client-side to something a bit BELOW that cap, before the (now 2x,
// since the LEFT/RIGHT split) vision calls, cuts real input-token cost — box score text is large
// UI type, not fine print, so it stays legible well under full resolution.
function downscaleImage(file, maxDim=1024, quality=0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width*scale);
        height = Math.round(height*scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve({ data: canvas.toDataURL("image/jpeg", quality).split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

// Scans the LEFT and RIGHT teams in two separate sequential calls instead of one combined
// call — the combined-call approach kept occasionally producing a fully self-consistent stat
// block filed under the wrong team's name, which no amount of "double check your work"
// prompting fully prevented, since the model still had both teams' identities in play at once
// to potentially cross. Splitting the calls means neither one ever holds the other team's
// identity, so there's nothing left for it to cross-wire. The two calls have to be spaced out
// to respect callClaudeVisionMulti's cooldown safeguard.
async function scanBoxScoreBothSides(images) {
  const leftText = await callClaudeVisionMulti(images, buildBoxScoreSidePrompt("LEFT", images.length>1));
  const leftTeam = JSON.parse(extractBoxScoreJson(leftText));
  await new Promise(res=>setTimeout(res, CALL_COOLDOWN_MS + 250));
  const rightText = await callClaudeVisionMulti(images, buildBoxScoreSidePrompt("RIGHT", images.length>1));
  const rightTeam = JSON.parse(extractBoxScoreJson(rightText));
  return { team1: leftTeam, team2: rightTeam };
}

// Stats derived by simple arithmetic from the raw box-score fields rather than asked of the
// vision model directly — fewer fields for it to misread, and these are guaranteed consistent
// with the raw numbers it does report.
function boxScoreDerived(t) {
  const passing = t.passing||{}, rushing = t.rushing||{}, misc = t.misc||{}, st = t.specialTeams||{};
  const offYds = (passing.yds||0) + (rushing.yds||0);
  const totalYds = misc.totalYds || offYds;
  const totalPlays = misc.totalPlays||0;
  const ypp = totalPlays>0 ? (totalYds/totalPlays).toFixed(1) : "-";
  const ypa = (passing.att||0)>0 ? (passing.yds/passing.att).toFixed(1) : "-";
  const puntAvg = (st.punts||0)>0 ? (st.puntYds/st.punts).toFixed(1) : "-";
  return {offYds,totalYds,ypp,ypa,puntAvg};
}

// Two-team quarter-by-quarter score table, laid out like the in-game box score's own
// scoring summary: one column per quarter (plus OT if it went there), a Final column,
// one row per team.
function QuarterScoreTable({team1,team2,name1,name2,dark}) {
  const q1=team1?.quarters||[], q2=team2?.quarters||[];
  const n=Math.max(q1.length,q2.length);
  if(!n) return null;
  const ink=dark?"#fff":"#111", sub=dark?"#888":"#888", grid=dark?"#333":"#e1e0d9";
  const labels=Array.from({length:n},(_,i)=>i<4?`Q${i+1}`:"OT");
  const cell={padding:"4px 8px",textAlign:"center",fontSize:11,fontWeight:700,color:ink};
  const head={...cell,fontSize:9,color:sub,textTransform:"uppercase",fontWeight:700,letterSpacing:0.3};
  return (
    <div style={{padding:"10px 12px",background:dark?"#1a1a1a":"#fafafa",borderRadius:2,marginBottom:8,overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",margin:"0 auto"}}>
        <thead>
          <tr>
            <th style={{...head,textAlign:"left",paddingRight:16}}>Team</th>
            {labels.map(lbl=><th key={lbl} style={{...head,minWidth:34}}>{lbl}</th>)}
            <th style={{...head,minWidth:44,borderLeft:`1px solid ${grid}`}}>Final</th>
          </tr>
        </thead>
        <tbody>
          {[{name:name1,q:q1,score:team1.score},{name:name2,q:q2,score:team2.score}].map((row,i)=>(
            <tr key={i} style={{borderTop:`1px solid ${grid}`}}>
              <td style={{...cell,textAlign:"left",fontWeight:800,whiteSpace:"nowrap",paddingRight:16}}>{row.name}</td>
              {labels.map((lbl,qi)=><td key={lbl} style={cell}>{row.q[qi]||0}</td>)}
              <td style={{...cell,borderLeft:`1px solid ${grid}`,fontWeight:900}}>{row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Full side-by-side stat comparison for one archived game — shared by the Schedule tab's
// box score card and the Enter Results archived-stats previews so all three stay in sync.
function BoxScoreDetail({team1,team2,dark}) {
  if(!team1||!team2) return null;
  const d1=boxScoreDerived(team1), d2=boxScoreDerived(team2);
  const m1=team1.misc||{}, m2=team2.misc||{}, st1=team1.specialTeams||{}, st2=team2.specialTeams||{};
  const ink=dark?"#ccc":"#555", label=dark?"#888":"#888", head=dark?"#fff":"#333";
  const rows=[
    ["First Downs", m1.firstDowns, m2.firstDowns],
    ["Total Plays", m1.totalPlays, m2.totalPlays],
    ["Total Yards", d1.totalYds, d2.totalYds],
    ["Yards / Play", d1.ypp, d2.ypp],
    ["Offensive Yards", d1.offYds, d2.offYds],
    ["Passing", `${team1.passing.comp}/${team1.passing.att} ${team1.passing.tds}TD ${team1.passing.int}INT`, `${team2.passing.comp}/${team2.passing.att} ${team2.passing.tds}TD ${team2.passing.int}INT`],
    ["Passing Yards", team1.passing.yds, team2.passing.yds],
    ["Yards / Pass", d1.ypa, d2.ypa],
    ["Rushing", `${team1.rushing.att} Rushes ${team1.rushing.yds} Yards ${team1.rushing.tds} TD`, `${team2.rushing.att} Rushes ${team2.rushing.yds} Yards ${team2.rushing.tds} TD`],
    ["Rushing Yards", team1.rushing.yds, team2.rushing.yds],
    ["3rd Down Conv.", `${m1.thirdDownConv}/${m1.thirdDownAtt}`, `${m2.thirdDownConv}/${m2.thirdDownAtt}`],
    ["4th Down Conv.", `${m1.fourthDownConv}/${m1.fourthDownAtt}`, `${m2.fourthDownConv}/${m2.fourthDownAtt}`],
    ["Red Zone TD-FG-%", `${m1.redZoneTD}-${m1.redZoneFG}-${m1.redZonePct}%`, `${m2.redZoneTD}-${m2.redZoneFG}-${m2.redZonePct}%`],
    ["Turnovers", m1.turnovers, m2.turnovers],
    ["Interceptions", team1.passing.int, team2.passing.int],
    ["KR Yards", st1.krYds, st2.krYds],
    ["PR Yards", st1.prYds, st2.prYds],
    ["Punting Avg", d1.puntAvg, d2.puntAvg],
    ["Penalties-Yards", `${m1.penalties}-${m1.penaltyYds}`, `${m2.penalties}-${m2.penaltyYds}`],
    ["Time of Poss.", m1.timeOfPossession||"-", m2.timeOfPossession||"-"],
  ];
  return (
    <div>
      <QuarterScoreTable team1={team1} team2={team2} name1={team1.name} name2={team2.name} dark={dark}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,padding:"6px 2px 4px",borderBottom:`2px solid ${dark?"#333":"#ddd"}`,alignItems:"center"}}>
        <div style={{textAlign:"right",fontSize:11,color:head,fontWeight:900,textTransform:"uppercase",letterSpacing:0.3}}>{team1.name}</div>
        <div style={{minWidth:96}}/>
        <div style={{textAlign:"left",fontSize:11,color:head,fontWeight:900,textTransform:"uppercase",letterSpacing:0.3}}>{team2.name}</div>
      </div>
      <div>
        {rows.map(([lbl,v1,v2])=>(
          <div key={lbl} style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,padding:"4px 2px",borderBottom:`1px solid ${dark?"#2a2a2a":"#f0f0f0"}`,alignItems:"center"}}>
            <div style={{textAlign:"right",fontSize:11,color:ink,fontWeight:600}}>{v1}</div>
            <div style={{fontSize:9,color:label,textTransform:"uppercase",fontWeight:700,textAlign:"center",minWidth:96,letterSpacing:0.3}}>{lbl}</div>
            <div style={{textAlign:"left",fontSize:11,color:ink,fontWeight:600}}>{v2}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Lax 0..1 name-similarity score for picking between exactly two known candidates — unlike
// matchDynastyTeam (which requires full word coverage before trusting a match at all, since it
// also has to decide "is this a dynasty team or a CPU opponent"), this only ever has to rank
// t1Name vs t2Name against each other, so a partial match is still useful signal.
function teamNameSimilarity(rawName, teamName) {
  const rawWords = normalizeTeamWords(rawName), rosterWords = normalizeTeamWords(teamName);
  return Math.max(teamWordCoverage(rawWords, rosterWords), teamWordCoverage(rosterWords, rawWords));
}

// The vision scan reads team names straight off the screenshot, but its "team1"/"team2" JSON
// keys just reflect left-to-right position in the image — nothing ties that to which schedule
// slot (t1Name vs t2Name) is which, so trusting position silently swapped both teams' entire
// stat lines. Match by name instead (falling back to position only when neither assignment has
// any name signal at all), and compute yards-allowed ourselves from the opponent's own reported
// yards rather than asking the model to do that cross-reference in its head, which is where it
// kept erring.
function reconcileBoxScoreTeams(json, t1Name, t2Name) {
  const raw1 = json.team1 || {}, raw2 = json.team2 || {};
  const name1 = raw1.name||"", name2 = raw2.name||"";
  // Score both possible assignments and keep whichever the names agree with more — requiring
  // a perfect match on BOTH sides (the old behavior) meant one misread/abbreviated/mascot-style
  // name was enough to silently fall back to trusting position, which is exactly the bug this
  // function exists to prevent.
  const simNormal  = teamNameSimilarity(name1, t1Name) + teamNameSimilarity(name2, t2Name);
  const simSwapped = teamNameSimilarity(name1, t2Name) + teamNameSimilarity(name2, t1Name);
  const swapped = simSwapped > simNormal;
  const team1 = swapped ? raw2 : raw1;
  const team2 = swapped ? raw1 : raw2;
  const ydsAllowed = opp => ({
    totalYdsAllowed: (opp.passing?.yds||0) + (opp.rushing?.yds||0),
    passYdsAllowed: opp.passing?.yds||0,
    rushYdsAllowed: opp.rushing?.yds||0,
  });
  team1.defense = ydsAllowed(team2);
  team2.defense = ydsAllowed(team1);
  return { team1, team2 };
}

function recomputePlayerStatsFromArchive(archive, existingPlayerStats, changedYear) {
  const yearGames = (archive||[]).filter(g=>String(g.year)===String(changedYear));
  const byUser = {};
  for (const g of yearGames) {
    for (const [team, opp] of [[g.team1,g.team2],[g.team2,g.team1]]) {
      if (!team.userId) continue;
      if (!byUser[team.userId]) byUser[team.userId] = [];
      byUser[team.userId].push({team, opp});
    }
  }
  const updated = {...existingPlayerStats};
  for (const [userId, games] of Object.entries(byUser)) {
    const s = games.reduce((acc,{team,opp})=>({
      passing:{att:acc.passing.att+team.passing.att,comp:acc.passing.comp+team.passing.comp,yds:acc.passing.yds+team.passing.yds,tds:acc.passing.tds+team.passing.tds,int:acc.passing.int+team.passing.int},
      rushing:{att:acc.rushing.att+team.rushing.att,yds:acc.rushing.yds+team.rushing.yds,tds:acc.rushing.tds+team.rushing.tds,fum:0},
      receiving:{rec:0,yds:0,tds:0},
      defense:{int:0,fum:0,sacks:0,tds:0},
      specialTeams:{fgAtt:acc.specialTeams.fgAtt+team.specialTeams.fgAtt,fgMade:acc.specialTeams.fgMade+team.specialTeams.fgMade,punts:0,puntYds:0,puntsIn20:0},
      team:{
        games:acc.team.games+1,
        offPts:acc.team.offPts+(team.score||0),
        defPts:acc.team.defPts+(opp.score||0),
        offYds:acc.team.offYds+(team.misc?.totalYds||0),
        defYds:acc.team.defYds+(team.defense?.totalYdsAllowed||0),
        giveaways:acc.team.giveaways+(team.misc?.turnovers||0),
        takeaways:acc.team.takeaways+(opp.misc?.turnovers||0),
        thirdConv:acc.team.thirdConv+(team.misc?.thirdDownConv||0),
        thirdAtt:acc.team.thirdAtt+(team.misc?.thirdDownAtt||0),
        fourthConv:acc.team.fourthConv+(team.misc?.fourthDownConv||0),
        fourthAtt:acc.team.fourthAtt+(team.misc?.fourthDownAtt||0),
        twoPtConv:acc.team.twoPtConv+(team.misc?.twoPtConv||0),
        twoPtAtt:acc.team.twoPtAtt+(team.misc?.twoPtAtt||0),
        offRedZonePctSum:acc.team.offRedZonePctSum+(team.misc?.redZonePct||0),
        defRedZonePctSum:acc.team.defRedZonePctSum+(opp.misc?.redZonePct||0),
      },
    }), {passing:{att:0,comp:0,yds:0,tds:0,int:0},rushing:{att:0,yds:0,tds:0,fum:0},receiving:{rec:0,yds:0,tds:0},defense:{int:0,fum:0,sacks:0,tds:0},specialTeams:{fgAtt:0,fgMade:0,punts:0,puntYds:0,puntsIn20:0},team:{games:0,offPts:0,defPts:0,offYds:0,defYds:0,giveaways:0,takeaways:0,thirdConv:0,thirdAtt:0,fourthConv:0,fourthAtt:0,twoPtConv:0,twoPtAtt:0,offRedZonePctSum:0,defRedZonePctSum:0}});
    // Red zone % has no attempts count in the box score, only a per-game rate — average the
    // per-game rates into a single season figure rather than storing the running sum.
    s.team.offRedZonePct=s.team.games>0?Math.round((s.team.offRedZonePctSum/s.team.games)*10)/10:0;
    s.team.defRedZonePct=s.team.games>0?Math.round((s.team.defRedZonePctSum/s.team.games)*10)/10:0;
    delete s.team.offRedZonePctSum;
    delete s.team.defRedZonePctSum;
    updated[userId] = {...(existingPlayerStats[userId]||{}), [String(changedYear)]: s};
  }
  return updated;
}

function pickWeeklyAwards(games) {
  if (!games.length) return {gotw:null,blowout:null,offMvp:null,defMvp:null};
  let gotw=null, gotwMargin=Infinity, blowout=null, blowoutMargin=-1;
  let offMvp=null, offMvpYds=-1, defMvp=null, defMvpYdsAllowed=Infinity;
  for (const g of games) {
    const margin = Math.abs(g.team1.score - g.team2.score);
    if (margin < gotwMargin) { gotwMargin=margin; gotw={game:g,margin}; }
    if (margin > blowoutMargin) { blowoutMargin=margin; blowout={game:g,margin}; }
    for (const t of [g.team1,g.team2]) {
      const offYds = t.passing.yds + t.rushing.yds;
      if (offYds > offMvpYds) { offMvpYds=offYds; offMvp={team:t,game:g,yds:offYds}; }
      if (t.defense.totalYdsAllowed < defMvpYdsAllowed) { defMvpYdsAllowed=t.defense.totalYdsAllowed; defMvp={team:t,game:g,ydsAllowed:t.defense.totalYdsAllowed}; }
    }
  }
  return {gotw, blowout, offMvp, defMvp};
}

function buildRecapPrompt(games, awards, leagueName, week, season, year, reporter) {
  const w = g => g.team1.score > g.team2.score ? g.team1 : g.team2;
  const l = g => g.team1.score > g.team2.score ? g.team2 : g.team1;
  const statLine = t => { const d=boxScoreDerived(t); return `${t.passing.comp}/${t.passing.att} (${t.passing.pct}%) ${t.passing.yds} pass yds (${d.ypa} YPA) ${t.passing.tds}TD/${t.passing.int}INT | ${t.rushing.att} rush, ${t.rushing.yds} yds (${t.rushing.ypc} YPC), ${t.rushing.tds} TD | ${d.totalYds} total yds, ${d.ypp} YPP | Def: ${t.defense.totalYdsAllowed} total yds allowed (${t.defense.passYdsAllowed} pass / ${t.defense.rushYdsAllowed} rush) | FG ${t.specialTeams.fgMade}/${t.specialTeams.fgAtt}${t.specialTeams.krTds>0?` | ${t.specialTeams.krTds} KR TD`:''}${t.specialTeams.prTds>0?` | ${t.specialTeams.prTds} PR TD`:''}${t.specialTeams.punts>0?` | punting ${d.puntAvg} avg`:''}${t.quarters?.length?` | by quarter: ${t.quarters.join('-')}`:''}${t.misc?` | ${t.misc.firstDowns} first downs, ${t.misc.turnovers} turnovers (${t.misc.fumblesLost}F/${t.passing.int}I), 3rd down ${t.misc.thirdDownConv}/${t.misc.thirdDownAtt}, 4th down ${t.misc.fourthDownConv}/${t.misc.fourthDownAtt}, red zone ${t.misc.redZoneTD}TD-${t.misc.redZoneFG}FG-${t.misc.redZonePct}%, ${t.misc.penalties}-${t.misc.penaltyYds} penalties, TOP ${t.misc.timeOfPossession||'-'}`:''}`; };
  const gameLines = games.map(g=>`${w(g).name} ${w(g).score}, ${l(g).name} ${l(g).score}\n  ${g.team1.name}: ${statLine(g.team1)}\n  ${g.team2.name}: ${statLine(g.team2)}`).join("\n\n");
  const awardLines = [
    awards.gotw ? `GAME OF THE WEEK: ${w(awards.gotw.game).name} def. ${l(awards.gotw.game).name} ${w(awards.gotw.game).score}-${l(awards.gotw.game).score} (margin: ${awards.gotw.margin})` : "",
    awards.blowout && awards.blowout.margin > (awards.gotw?.margin||0) ? `BLOWOUT OF THE WEEK: ${w(awards.blowout.game).name} def. ${l(awards.blowout.game).name} ${w(awards.blowout.game).score}-${l(awards.blowout.game).score} (margin: ${awards.blowout.margin})` : "",
    awards.offMvp ? `TOP OFFENSE: ${awards.offMvp.team.name} — ${awards.offMvp.yds} total yards (${awards.offMvp.team.passing.yds} pass / ${awards.offMvp.team.rushing.yds} rush)` : "",
    awards.defMvp ? `TOP DEFENSE: ${awards.defMvp.team.name} — only ${awards.defMvp.ydsAllowed} yards allowed` : "",
  ].filter(Boolean).join("\n");
  return `You are ${reporter.name}, ${reporter.title} for Dynasty Central covering the "${leagueName}" dynasty. Your writing style is ${reporter.style}\n\nWrite a dramatic weekly recap for Season ${season} Week ${week} (${year}).\n\nWEEK ${week} RESULTS:\n${gameLines}\n\nWEEK ${week} AWARDS:\n${awardLines}\n\nWrite a 400-500 word recap that:\n- Opens with a punchy headline and lede capturing the week's biggest story\n- Covers each game with flavor and context, not just scores\n- Highlights the award winners with specific stat call-outs\n- Ends with dynasty standings implications and what to watch next week\n- Signs off with your name and title\n\nWrite in your distinct voice. No markdown formatting.`;
}

// ── Auto weekly content (news / review / preview) generated on week-advance ─
const PERSONALITY_CAMEO_NOTE = `\n\nOPTIONAL COLOR (rare — most articles should skip this entirely): if it truly fits, you may include one brief moment where a coach or player shows up on a sports talk show, podcast, or radio hit for a soundbite or reaction. Invent a plausible show/hosts each time and vary it — never reuse the same fictional show twice in a row. Do not force it in; the vast majority of articles should have zero mention of a talk-show appearance.`;

function autoBibleContext(setup) {
  const profiles=(setup?.leagueBible?.profiles||[]).filter(p=>p.bio?.trim());
  const storylines=(setup?.leagueBible?.storylines||"").trim();
  const chronicle=(setup?.leagueBible?.chronicle||[]).slice(0,20);
  if(!profiles.length&&!storylines&&!chronicle.length)return "";
  let ctx="";
  if(profiles.length){ctx+=`\n\nLEAGUE PERSONALITIES — use these character details to add color, storylines, and personality to your writing. Reference them naturally and with humor where appropriate:\n${profiles.map(p=>`${p.name}: ${p.bio}`).join("\n")}`;}
  if(storylines){ctx+=`\n\nLEAGUE STORYLINES — weave these season narratives into your writing naturally:\n${storylines}`;}
  if(chronicle.length){ctx+=`\n\nLEAGUE CHRONICLE — recent story developments (most recent first). Build on these threads:\n${chronicle.map(e=>`S${e.season} Wk${e.week} (${e.date}): ${e.summary}`).join("\n")}`;}
  return ctx;
}

function autoStandingsText(sorted, leader) {
  return sorted.map((t,i)=>{const tot=calcTotal(t);const coach=t.userName&&t.userName!==t.teamName?`${t.userName}/${t.teamName}`:`${t.teamName}`;return `${i+1}. ${coach} — ${t.wins}W ${t.losses}L — ${tot} pts${i===0?" [LEADER]":` (-${leader-tot})`}`;}).join("\n");
}

function autoWeekMatchupsText(schedule, wk, sorted) {
  if(!schedule[wk]) return "Schedule not available";
  const teamToCoach = Object.fromEntries(sorted.filter(t=>t.userName&&t.userName!==t.teamName).map(t=>[t.teamName,t.userName]));
  const fmt=(team,opp)=>{
    const c1=teamToCoach[team]; const c2=teamToCoach[opp];
    const t1=c1?`${c1} (${team})`:team; const t2=c2?`${c2} (${opp})`:opp;
    if(opp==="BYE")return `${t1}: BYE`;
    if(isCPUOpp(opp))return `${t1} vs ${formatOpp(opp)} (non-conf)`;
    return `${t1} vs ${t2}`;
  };
  const seen=new Set();const games=[];
  Object.entries(schedule[wk]).forEach(([team,opp])=>{const key=[team,opp].sort().join("vs");if(!seen.has(key)){seen.add(key);games.push(fmt(team,opp));}});
  return games.join("\n");
}

function autoByline(reporter, leagueName, year, history, sorted, setup) {
  const leagueAge = history.length > 0 ? `This is year ${year} of the league (its ${year===2024?"1st":year===2025?"2nd":year===2026?"3rd":year===2027?"4th":year===2028?"5th":(year-2023)+"th"} year of existence, founded in 2024). ` : "";
  const pastChamps = history.length > 0 ? `Past dynasty champions: ${[...history].reverse().slice(0,5).map(s=>`${s.year} S${s.seasonNum||"?"}: ${s.champion}`).join(", ")}. ` : "";
  const rosterContext = sorted.some(t=>t.userName&&t.userName!==t.teamName) ? `\n\nCOACH ROSTER — these coaches and their programs are the same entity, never separate. Vary how you refer to them throughout the piece — mix and match naturally: "Big Johnson's Texas State," "Texas State under Big Johnson," "Big Johnson and the Bobcats," "the Big Johnson era at Texas State," just "Big Johnson," just "Texas State," etc. Never introduce them the same way twice. Never list coaches and teams as if they're different people/things:\n${sorted.filter(t=>t.userName&&t.userName!==t.teamName).map(t=>`${t.userName} → ${t.teamName}`).join("\n")}` : "";
  return `You are ${reporter.name}, ${reporter.title} for Dynasty Central covering the "${leagueName}" dynasty. Your writing style is ${reporter.style}\n\n${leagueAge}${pastChamps}This is NOT the inaugural season — the league has history and established rivalries.${rosterContext}${autoBibleContext(setup)}\n\nAlways sign your articles with your name and title at the end.\n\n`;
}

function buildAutoNewsPrompt({reporter, leagueName, season, completedWeek, year, history, sorted, leader, setup, cameoNote}) {
  const byline = autoByline(reporter, leagueName, year, history, sorted, setup);
  const standingsText = autoStandingsText(sorted, leader);
  return `${byline}Write a Week ${completedWeek} NEWS roundup for the "${leagueName}" dynasty, Season ${season} — a step back from the box score to cover the storylines: standings shakeups, hot and cold streaks, teams rising or fading from contention, and anything brewing between rivals.\n\nCurrent standings after Week ${completedWeek}:\n${standingsText}\n\nTarget length: 650-800 words. Open with the week's defining storyline, then move through 2-4 more angles worth watching. This is NOT a game-by-game recap and NOT a preview of next week — focus on what these results mean for the dynasty race and the people/programs involved. Write in your distinct voice.${cameoNote||""}`;
}

function buildAutoWeekReviewFallbackPrompt({reporter, leagueName, season, completedWeek, year, history, sorted, leader, setup, schedule, cameoNote}) {
  const byline = autoByline(reporter, leagueName, year, history, sorted, setup);
  const standingsText = autoStandingsText(sorted, leader);
  const matchups = autoWeekMatchupsText(schedule, completedWeek, sorted);
  const confGames = buildGamesList(schedule, completedWeek).filter(g=>g.opp!=="BYE"&&!isCPUOpp(g.opp));
  const gotw = pickGOTW(confGames, sorted);
  const gotwLine = gotw ? `\n\nGAME OF THE WEEK (spotlight this as the marquee matchup — dramatize the result and make up a final score consistent with the standings/records above): ${gotw.team1} (#${gotw.rank1} in dynasty points) vs ${gotw.team2} (#${gotw.rank2} in dynasty points)` : "";
  return `${byline}Write a dramatic Week ${completedWeek} REVIEW for Season ${season} of the "${leagueName}" dynasty.\n\nStandings after this week:\n${standingsText}\n\nThis week's matchups:\n${matchups}${gotwLine}\n\nTarget length: 650-800 words. Recap the week's actual games — make up exciting final scores and details consistent with the results above, lead with the Game of the Week, highlight upsets and dominant performances, and close with dynasty standings implications and what to watch next week. Write in your distinct voice.${cameoNote||""}`;
}

function buildAutoWeekPreviewPrompt({reporter, leagueName, season, newWeek, year, history, sorted, leader, setup, schedule, cameoNote}) {
  const byline = autoByline(reporter, leagueName, year, history, sorted, setup);
  const standingsText = autoStandingsText(sorted, leader);
  const matchups = autoWeekMatchupsText(schedule, newWeek, sorted);
  const confGames = buildGamesList(schedule, newWeek).filter(g=>g.opp!=="BYE"&&!isCPUOpp(g.opp));
  const gotw = pickGOTW(confGames, sorted);
  const gotwLine = gotw ? `\n\nGAME OF THE WEEK (the marquee matchup this week — give it a dedicated, extra-detailed section, but still preview every other game too): ${gotw.team1} (#${gotw.rank1} in dynasty points) vs ${gotw.team2} (#${gotw.rank2} in dynasty points)` : "";
  return `${byline}Write a Week ${newWeek} PREVIEW for the "${leagueName}" dynasty, Season ${season}.\n\nCurrent standings:\n${standingsText}\n\nTHIS WEEK'S ACTUAL MATCHUPS (preview every one of them, even briefly):\n${matchups}${gotwLine}\n\nTarget length: 650-800 words. Preview each scheduled matchup — storylines, stakes, and who has the edge — giving the Game of the Week the most space. Reference the real games only, never invent different matchups. Write in your distinct voice.${cameoNote||""}`;
}

function SL({children}) {
  return <div style={{fontSize:11,fontWeight:800,letterSpacing:2,textTransform:"uppercase",color:"#555",borderLeft:`3px solid ${RED}`,paddingLeft:8,marginBottom:14,fontFamily:ff}}>{children}</div>;
}
function Card({children,style={},...rest}) {
  return <div style={{background:"#fff",border:"1px solid #ddd",borderRadius:2,...style}} {...rest}>{children}</div>;
}
function CardHead({children,bg="#111"}) {
  return <div style={{background:bg,padding:"8px 14px"}}><div style={{fontSize:11,fontWeight:800,color:"#fff",letterSpacing:1,textTransform:"uppercase"}}>{children}</div></div>;
}

// ── Week Matchups + Game of the Week Card ────────────────────────────────
function buildGamesList(schedule, week) {
  const seen = new Set(); const list = [];
  Object.entries(schedule[week]||{}).forEach(([team,opp])=>{
    const key = [team,opp].sort().join("|");
    if(!seen.has(key)){seen.add(key);list.push({team,opp});}
  });
  return list;
}

function pickGOTW(confGames, sorted) {
  if(confGames.length===0) return null;
  const rankMap = {};
  sorted.forEach((t,i)=>{ rankMap[t.teamName]=i+1; });
  return confGames.reduce((best, game) => {
    const r1=rankMap[game.team]||99, r2=rankMap[game.opp]||99;
    const score=Math.abs(r1-r2)+Math.min(r1,r2)*0.5;
    const cur=best||{score:999};
    return score<cur.score ? {team1:game.team,team2:game.opp,rank1:r1,rank2:r2,score} : best;
  }, null);
}

// Career win% for this coach across past seasons in history, or null if there's no history to draw on.
function careerWinPct(entry, history) {
  if (!history || !history.length) return null;
  let wins=0, losses=0;
  history.forEach(s=>{
    const match = (s.finalStandings||[]).find(t=>(entry.userId&&t.userId===entry.userId)||(t.userName===entry.userName));
    if (match) { wins += match.wins||0; losses += match.losses||0; }
  });
  const games = wins+losses;
  return games ? wins/games : null;
}

// Rough win-probability estimate from record + dynasty points — no AI call, just arithmetic
// off data already on hand, so it's instant and free to show for any matchup. Once a team has
// more than 3 games logged this year, this-season form is the signal; before that the in-season
// sample is too small to mean anything, so it falls back to career win% from past seasons instead.
function estimateWinProb(teamEntry, oppEntry, history, trendA=null, trendB=null) {
  const gamesA = (teamEntry.wins||0)+(teamEntry.losses||0), gamesB = (oppEntry.wins||0)+(oppEntry.losses||0);
  const winPctFor = (entry, games) => {
    if (games > 3) return entry.wins/games;
    const career = careerWinPct(entry, history);
    return career!=null ? career : (games ? entry.wins/games : 0.5);
  };
  const winPctA = winPctFor(teamEntry, gamesA), winPctB = winPctFor(oppEntry, gamesB);
  const ptsA = calcTotal(teamEntry), ptsB = calcTotal(oppEntry);
  const ptsEdge = (ptsA-ptsB)/Math.max(ptsA,ptsB,1);
  let prob = 0.5 + (winPctA-winPctB)*0.3 + ptsEdge*0.25;
  // Blend in actual scored-game point differential when both teams have logged box scores this
  // season — the strongest signal available, and often the ONLY real signal early on, since
  // win/loss records stay blank until a week is Submitted even after box scores are scanned.
  // Without this, a lopsided already-played game (e.g. a 42-21 blowout) still priced as a near
  // coin-flip because the standings hadn't caught up yet.
  if (trendA && trendB) {
    const marginA = (parseFloat(trendA.ppgFor)-parseFloat(trendA.ppgAgainst)) - (parseFloat(trendB.ppgFor)-parseFloat(trendB.ppgAgainst));
    const trendEdge = Math.max(-0.4, Math.min(0.4, marginA/40));
    const trendWeight = Math.min(1, (trendA.games+trendB.games)/4);
    prob = prob*(1-trendWeight) + (0.5+trendEdge)*trendWeight;
  }
  return Math.min(0.93, Math.max(0.07, prob));
}
// Converts a fair win probability into a book-style American moneyline. Bakes in a standard
// ~4.76% hold (the same vig that makes a real coin-flip game price as -110/-110, not -100/-100)
// rather than quoting the fair number straight — a sportsbook without a hold isn't a sportsbook.
function probToAmericanOdds(p) {
  const implied = Math.min(0.98, Math.max(0.02, p*1.0476));
  return implied>=0.5 ? Math.round(-100*implied/(1-implied)) : Math.round(100*(1-implied)/implied);
}
function fmtOdds(n) { return n>0?`+${n}`:`${n}`; }

// Point spread for teamEntry, in standard betting notation (negative = teamEntry favored by
// that many, positive = teamEntry an underdog getting that many). Prefers real scored-game
// margins (same trend data the moneyline blends in) since that's the strongest signal on hand;
// falls back to win% + dynasty-points edge when neither team has box scores logged yet. Clamped
// to 3.5–30.5 either way — a real book never quotes a true pick'em as a flat 0, and a dynasty
// blowout shouldn't produce an implausible 50+ point line.
function estimateSpread(teamEntry, oppEntry, trendA=null, trendB=null) {
  let margin; // positive = teamEntry the stronger/favored side
  if (trendA && trendB) {
    const marginA = parseFloat(trendA.ppgFor)-parseFloat(trendA.ppgAgainst);
    const marginB = parseFloat(trendB.ppgFor)-parseFloat(trendB.ppgAgainst);
    margin = (marginA-marginB)/2;
  } else {
    const gamesA=(teamEntry.wins||0)+(teamEntry.losses||0), gamesB=(oppEntry.wins||0)+(oppEntry.losses||0);
    const winPctA = gamesA?teamEntry.wins/gamesA:0.5, winPctB = gamesB?oppEntry.wins/gamesB:0.5;
    const ptsA = calcTotal(teamEntry), ptsB = calcTotal(oppEntry);
    const ptsEdge = (ptsA-ptsB)/Math.max(ptsA,ptsB,1);
    margin = (winPctA-winPctB)*16 + ptsEdge*10;
  }
  const mag = Math.floor(Math.max(3.5,Math.min(30.5,Math.abs(margin))))+0.5;
  return margin>=0 ? -mag : mag;
}
// Combined-score total (Over/Under). Blends each team's own scoring average with the other
// team's points-allowed average when both have logged box scores this season; falls back to a
// generic league-average total (24 pts/team) for whichever side has no data yet.
function estimateTotal(trendA=null, trendB=null) {
  const LEAGUE_AVG = 24;
  const projFor = (mine,theirs) => {
    if (mine && theirs) return (parseFloat(mine.ppgFor)+parseFloat(theirs.ppgAgainst))/2;
    if (mine) return parseFloat(mine.ppgFor);
    if (theirs) return parseFloat(theirs.ppgAgainst);
    return LEAGUE_AVG;
  };
  const total = projFor(trendA,trendB) + projFor(trendB,trendA);
  return Math.floor(total)+0.5;
}

// Per-team scoring average from uploaded box scores for the given year, or null if none logged yet.
function teamScoringTrend(gameArchive, year, teamName) {
  let forPts=0, againstPts=0, games=0;
  (gameArchive||[]).filter(g=>g.year===Number(year)).forEach(g=>{
    [[g.team1,g.team2],[g.team2,g.team1]].forEach(([t,opp])=>{
      if(t?.name===teamName){ forPts+=t.score||0; againstPts+=opp?.score||0; games++; }
    });
  });
  return games ? {ppgFor:(forPts/games).toFixed(1), ppgAgainst:(againstPts/games).toFixed(1), games} : null;
}

// Finds the commissioner-uploaded box score for a specific week's matchup, if one has been
// submitted yet — the same signal ScheduleTab.getGameResult uses to flip a schedule row from
// "upcoming" to "final". Used to switch a matchup preview to a result view once a box score
// exists, instead of leaving the pre-game odds/spread showing (and silently drifting as the
// just-played game's score feeds back into the season trend averages).
function findArchivedGame(gameArchive, year, week, team1, team2) {
  return (gameArchive||[]).find(g=>g.year===Number(year)&&g.week===Number(week)&&
    ((g.team1?.name===team1&&g.team2?.name===team2)||(g.team1?.name===team2&&g.team2?.name===team1))
  ) || null;
}

// Final-score result view for a matchup that already has an uploaded box score — swaps in for
// MatchupPreview's betting odds once a game is no longer a preview.
function MatchupResult({archivedGame, logoFor}) {
  const [showStats, setShowStats] = useState(false);
  const {team1: mine, team2: opp} = archivedGame;
  const wMine = mine.score > opp.score, wOpp = opp.score > mine.score;
  return (
    <div style={{background:"#111",padding:0}}>
      <div style={{display:"flex",alignItems:"stretch",background:"#1a1a1a"}}>
        <div style={{flex:1,padding:"12px 14px",textAlign:"right"}}>
          {logoFor(mine.name)&&<img src={logoFor(mine.name)} alt="" style={{height:24,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:4}} onError={e=>{e.target.style.display="none";}}/>}
          <div style={{fontSize:13,fontWeight:wMine?900:600,color:wMine?"#fff":"#888"}}>{mine.name}</div>
          <div style={{fontSize:24,fontWeight:900,color:wMine?"#fff":"#888",lineHeight:1.1}}>{mine.score}</div>
        </div>
        <div style={{padding:"12px 8px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1}}>Final</div>
        </div>
        <div style={{flex:1,padding:"12px 14px",textAlign:"left"}}>
          {logoFor(opp.name)&&<img src={logoFor(opp.name)} alt="" style={{height:24,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:4}} onError={e=>{e.target.style.display="none";}}/>}
          <div style={{fontSize:13,fontWeight:wOpp?900:600,color:wOpp?"#fff":"#888"}}>{opp.name}</div>
          <div style={{fontSize:24,fontWeight:900,color:wOpp?"#fff":"#888",lineHeight:1.1}}>{opp.score}</div>
        </div>
      </div>
      <button onClick={()=>setShowStats(s=>!s)} style={{width:"100%",background:"transparent",border:"none",borderTop:"1px solid #333",padding:"8px 14px",cursor:"pointer",fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",letterSpacing:1,fontFamily:"'Helvetica Neue',Arial,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
        {showStats?"Hide Box Score":"Show Box Score"} {showStats?"▲":"▼"}
      </button>
      {showStats&&<div style={{padding:12,fontSize:11}}>
        <BoxScoreDetail team1={mine} team2={opp} dark/>
      </div>}
    </div>
  );
}

// Same betting-line info shown on the Game of the Week card (Moneyline/Key Stat/Spread/O-U),
// packaged for reuse on any matchup — including CPU games, where there's no dynasty entry for
// the opponent, so a neutral placeholder record stands in (estimateWinProb/estimateSpread then
// lean entirely on scored-game trend data when it's available). Once a box score has been
// uploaded for this exact week's matchup, this switches to MatchupResult instead of showing
// pre-game odds.
function MatchupPreview({team1, team2, sorted, gameArchive, year, week, history, logoFor}) {
  const archivedGame = findArchivedGame(gameArchive, year, week, team1, team2);
  if (archivedGame) return <MatchupResult archivedGame={archivedGame} logoFor={logoFor}/>;

  const NEUTRAL = {wins:0,losses:0,gamePts:0,rankedBonusPts:0,h2h:{}};
  const entry1 = sorted.find(t=>t.teamName===team1);
  const entry2 = sorted.find(t=>t.teamName===team2);
  const rank1 = entry1 ? sorted.findIndex(t=>t.teamName===team1)+1 : null;
  const rank2 = entry2 ? sorted.findIndex(t=>t.teamName===team2)+1 : null;
  const e1 = entry1||NEUTRAL, e2 = entry2||NEUTRAL;
  const trend1 = teamScoringTrend(gameArchive, year, team1);
  const trend2 = teamScoringTrend(gameArchive, year, team2);
  const prob1 = estimateWinProb(e1, e2, history, trend1, trend2);
  const odds1 = probToAmericanOdds(prob1), odds2 = probToAmericanOdds(1-prob1);
  const spread1 = estimateSpread(e1, e2, trend1, trend2);
  const total = estimateTotal(trend1, trend2);
  const h2h = entry1?.h2h?.[team2];
  return (
    <div style={{padding:"12px 14px",background:"#fafbff"}}>
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:10}}>
        <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
          {logoFor(team1)&&<img src={logoFor(team1)} alt="" style={{height:28,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:4}} onError={e=>{e.target.style.display="none";}}/>}
          <div style={{fontSize:14,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{team1}</div>
          {rank1&&<div style={{fontSize:10,color:"#888",marginTop:2}}>#{rank1} in Dynasty</div>}
          <div style={{fontSize:11,color:"#555",marginTop:2}}>{e1.wins}W-{e1.losses}L</div>
        </div>
        <div style={{padding:"0 10px",flexShrink:0}}>
          <div style={{fontSize:11,fontWeight:900,color:"#1a3a6b",letterSpacing:1}}>VS</div>
        </div>
        <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
          {logoFor(team2)&&<img src={logoFor(team2)} alt="" style={{height:28,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:4}} onError={e=>{e.target.style.display="none";}}/>}
          <div style={{fontSize:14,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{team2}</div>
          {rank2&&<div style={{fontSize:10,color:"#888",marginTop:2}}>#{rank2} in Dynasty</div>}
          <div style={{fontSize:11,color:"#555",marginTop:2}}>{e2.wins}W-{e2.losses}L</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Moneyline</div>
          <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team1}</span><span style={{flexShrink:0}}>{fmtOdds(odds1)}</span></div>
          <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6,marginTop:2}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team2}</span><span style={{flexShrink:0}}>{fmtOdds(odds2)}</span></div>
        </div>
        <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Key Stat</div>
          {(trend1||trend2) ? (<>
            {trend1&&<div style={{fontSize:11,fontWeight:700,color:"#111"}}>{team1}: {trend1.ppgFor} PPG</div>}
            {trend2&&<div style={{fontSize:11,fontWeight:700,color:"#111",marginTop:2}}>{team2}: {trend2.ppgFor} PPG</div>}
          </>) : h2h ? (
            <div style={{fontSize:11,fontWeight:700,color:"#111"}}>{team1} is {h2h.wins}-{h2h.losses} all-time vs {team2}</div>
          ) : (
            <div style={{fontSize:11,color:"#999",fontStyle:"italic"}}>No history yet</div>
          )}
        </div>
        <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Spread</div>
          <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team1}</span><span style={{flexShrink:0}}>{spread1>0?`+${spread1}`:spread1}</span></div>
          <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6,marginTop:2}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team2}</span><span style={{flexShrink:0}}>{-spread1>0?`+${-spread1}`:-spread1}</span></div>
        </div>
        <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Over/Under</div>
          <div style={{fontSize:12,fontWeight:700,color:"#111"}}>O/U {total}</div>
        </div>
      </div>
    </div>
  );
}

function WeekMatchupsCard({schedule,week,sorted,leagueName,season,setActiveArticle,articles,setArticles,commUnlocked,setupRows,gameArchive,year,history,setTab}) {
  const [generating,setGenerating] = useState(false);
  const [expandedMatchup,setExpandedMatchup] = useState({});

  const games = buildGamesList(schedule, week);
  const confGames = games.filter(g => g.opp !== "BYE" && !isCPUOpp(g.opp));
  const gameOfWeek = pickGOTW(confGames, sorted);
  const logoFor = teamName => {
    const entry = sorted.find(t=>t.teamName===teamName);
    if(!entry) return null;
    return getPlayerImages(setupRows, entry.userId, entry.userName).teamLogo;
  };

  const gotwT1Entry = gameOfWeek && sorted.find(t=>t.teamName===gameOfWeek.team1);
  const gotwT2Entry = gameOfWeek && sorted.find(t=>t.teamName===gameOfWeek.team2);
  const gotwTrend1 = gameOfWeek && teamScoringTrend(gameArchive, year, gameOfWeek.team1);
  const gotwTrend2 = gameOfWeek && teamScoringTrend(gameArchive, year, gameOfWeek.team2);
  const gotwProb1 = (gotwT1Entry&&gotwT2Entry) ? estimateWinProb(gotwT1Entry,gotwT2Entry,history,gotwTrend1,gotwTrend2) : 0.5;
  const gotwOdds1 = probToAmericanOdds(gotwProb1);
  const gotwOdds2 = probToAmericanOdds(1-gotwProb1);
  const gotwSpread1 = (gotwT1Entry&&gotwT2Entry) ? estimateSpread(gotwT1Entry,gotwT2Entry,gotwTrend1,gotwTrend2) : 3.5;
  const gotwTotal = gameOfWeek ? estimateTotal(gotwTrend1,gotwTrend2) : null;
  const gotwH2H = gotwT1Entry?.h2h?.[gameOfWeek?.team2];
  const gotwArchived = gameOfWeek && findArchivedGame(gameArchive, year, week, gameOfWeek.team1, gameOfWeek.team2);

  const generateGOTWPreview = async () => {
    if(!gameOfWeek) return;
    if(!window.confirm(`Generate Game of the Week preview?\n${gameOfWeek.team1} vs ${gameOfWeek.team2}\n\nThis will use the Claude API.`)) return;
    setGenerating(true);
    const t1 = sorted.find(t=>t.teamName===gameOfWeek.team1);
    const t2 = sorted.find(t=>t.teamName===gameOfWeek.team2);
    const standingsText = sorted.map((t,i)=>{const tot=calcTotal(t);return `${i+1}. ${t.teamName} — ${t.wins}W-${t.losses}L — ${tot}pts`;}).join("\n");
    const prompt = "You are a college football analyst covering the \""+leagueName+"\" online dynasty. Write a 350-word GAME OF THE WEEK preview for Season "+season+" Week "+week+".\n\n"+
      "GAME OF THE WEEK: "+gameOfWeek.team1+" (#"+gameOfWeek.rank1+" in dynasty points, "+(t1?.wins||0)+"W-"+(t1?.losses||0)+"L) vs "+gameOfWeek.team2+" (#"+gameOfWeek.rank2+" in dynasty points, "+(t2?.wins||0)+"W-"+(t2?.losses||0)+"L)\n\n"+
      "Current dynasty standings:\n"+standingsText+"\n\n"+
      "Write a compelling preview with:\n- A dramatic headline\n- Why this game matters for the dynasty standings\n- Each team's strengths and recent form\n- A score prediction\n- A \"Key to the Game\" section\n\n"+
      "Write like ESPN College GameDay. Make it feel like must-watch television.";

    try {
      const text = cleanArticle(await callClaude(prompt));
      const article = {
        id: Date.now(),
        type: "gotw",
        label: "🏆 Game of the Week",
        week, season, text,
        reporter: "Dynasty Central",
        reporterColor: "#1a3a6b",
        reporterAvatar: "GW",
        gotw: gameOfWeek,
      };
      setActiveArticle(article);
      const newArticles = [article,...(articles||[])].slice(0,30);
      setArticles(newArticles);
      // Save to Supabase
      const SU = "https://uyaqmdljwwslskoqxvpn.supabase.co";
      const SK = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";
      fetch(`${SU}/rest/v1/dynasty_state?id=eq.main`,{method:"PATCH",headers:{"Content-Type":"application/json","apikey":SK,"Authorization":`Bearer ${SK}`,"Prefer":"return=minimal"},body:JSON.stringify({articles:newArticles,updated_at:new Date().toISOString()})});
    } catch(e) {
      alert("Error generating preview: "+e.message);
    }
    setGenerating(false);
  };

  // Find existing GOTW article for this week
  const existingGOTW = (articles||[]).find(a=>a.type==="gotw" && a.week===week && a.season===season);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>

      {/* Game of the Week */}
      {gameOfWeek&&(
        <Card style={{overflow:"hidden",border:`2px solid #1a3a6b`}}>
          <div style={{background:"#1a3a6b",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{fontSize:16}}>🏆</div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.7)",letterSpacing:2,textTransform:"uppercase"}}>Game of the Week</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.5)"}}>Season {season} · Week {week}</div>
              </div>
            </div>
            {existingGOTW
              ? <button onClick={()=>setActiveArticle(existingGOTW)} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Helvetica Neue',Arial,sans-serif",textTransform:"uppercase"}}>Read Preview →</button>
              : commUnlocked?<button onClick={generateGOTWPreview} disabled={generating} style={{background:generating?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",color:"#fff",borderRadius:2,padding:"5px 12px",cursor:generating?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"'Helvetica Neue',Arial,sans-serif",textTransform:"uppercase"}}>{generating?"Writing...":"Generate Preview"}</button>:null
            }
          </div>
          <div style={{padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:0,width:"100%",boxSizing:"border-box"}}>
              <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
                {logoFor(gameOfWeek.team1)&&<img src={logoFor(gameOfWeek.team1)} alt="" style={{height:36,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:6}} onError={e=>{e.target.style.display="none";}}/>}
                <div style={{fontSize:18,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{gameOfWeek.team1}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank1} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team1)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team1)?.losses||0}L</div>
              </div>
              <div style={{padding:"0 12px",textAlign:"center",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:900,color:"#1a3a6b",letterSpacing:2}}>VS</div>
                <div style={{fontSize:10,color:"#aaa",marginTop:4,fontWeight:600}}>Conf</div>
              </div>
              <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
                {logoFor(gameOfWeek.team2)&&<img src={logoFor(gameOfWeek.team2)} alt="" style={{height:36,width:"auto",maxWidth:"100%",objectFit:"contain",marginBottom:6}} onError={e=>{e.target.style.display="none";}}/>}
                <div style={{fontSize:18,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{gameOfWeek.team2}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank2} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team2)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team2)?.losses||0}L</div>
              </div>
            </div>
            {gotwArchived ? (
              <div style={{marginTop:12,marginLeft:-16,marginRight:-16,marginBottom:-14}}>
                <MatchupResult archivedGame={gotwArchived} logoFor={logoFor}/>
              </div>
            ) : (<>
              <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Moneyline</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gameOfWeek.team1}</span><span style={{flexShrink:0}}>{fmtOdds(gotwOdds1)}</span></div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6,marginTop:2}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gameOfWeek.team2}</span><span style={{flexShrink:0}}>{fmtOdds(gotwOdds2)}</span></div>
                </div>
                <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Key Stat</div>
                  {(gotwTrend1||gotwTrend2) ? (<>
                    {gotwTrend1&&<div style={{fontSize:11,fontWeight:700,color:"#111"}}>{gameOfWeek.team1}: {gotwTrend1.ppgFor} PPG</div>}
                    {gotwTrend2&&<div style={{fontSize:11,fontWeight:700,color:"#111",marginTop:2}}>{gameOfWeek.team2}: {gotwTrend2.ppgFor} PPG</div>}
                  </>) : gotwH2H ? (
                    <div style={{fontSize:11,fontWeight:700,color:"#111"}}>{gameOfWeek.team1} is {gotwH2H.wins}-{gotwH2H.losses} all-time vs {gameOfWeek.team2}</div>
                  ) : (
                    <div style={{fontSize:11,color:"#999",fontStyle:"italic"}}>No history yet</div>
                  )}
                </div>
                <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Spread</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gameOfWeek.team1}</span><span style={{flexShrink:0}}>{gotwSpread1>0?`+${gotwSpread1}`:gotwSpread1}</span></div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111",display:"flex",justifyContent:"space-between",gap:6,marginTop:2}}><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gameOfWeek.team2}</span><span style={{flexShrink:0}}>{-gotwSpread1>0?`+${-gotwSpread1}`:-gotwSpread1}</span></div>
                </div>
                <div style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Over/Under</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111"}}>O/U {gotwTotal}</div>
                </div>
              </div>
              {setTab&&<button onClick={()=>setTab("Redzone")} style={{marginTop:12,width:"100%",background:"#111",color:"#fff",border:"none",borderRadius:2,padding:"10px 14px",cursor:"pointer",fontFamily:"'Helvetica Neue',Arial,sans-serif",fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>📺 Watch on RedZone</button>}
            </>)}
            {existingGOTW&&<div style={{marginTop:12,padding:"10px 14px",background:"#f0f4ff",borderRadius:2,border:"1px solid #c5d0e8",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}} onClick={()=>setActiveArticle(existingGOTW)}>
              <span style={{fontSize:13,fontWeight:700,color:"#1a3a6b"}}>{articleHeadline(existingGOTW.text)}</span>
              <span style={{fontSize:12,color:"#1a3a6b",fontWeight:700,flexShrink:0}}>Read →</span>
            </div>}
          </div>
        </Card>
      )}

      {/* All matchups */}
      <Card style={{overflow:"hidden"}}>
        <CardHead bg="#333">Week {week} Matchups</CardHead>
        <div style={{padding:"4px 14px 8px"}}>
          {games.map(({team,opp},i)=>{
            const isGOTW = gameOfWeek&&((team===gameOfWeek.team1&&opp===gameOfWeek.team2)||(team===gameOfWeek.team2&&opp===gameOfWeek.team1));
            const isBye = opp==="BYE";
            const opp2 = isCPUOpp(opp) ? (cpuOppName(opp)||"CPU") : opp;
            const isOpen = expandedMatchup[i];
            return(
              <div key={i} style={{borderBottom:"1px solid #f0f0f0"}}>
                <div onClick={isBye?undefined:()=>setExpandedMatchup(p=>({...p,[i]:!p[i]}))} style={{display:"flex",alignItems:"center",padding:"9px 0",background:isGOTW?"#f8f9ff":"transparent",gap:4,cursor:isBye?"default":"pointer"}}>
                  {isGOTW&&<span style={{fontSize:10,flexShrink:0}}>🏆</span>}
                  {isBye
                    ?<><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team}</span><span style={{fontSize:11,color:"#aaa",background:"#f5f5f5",borderRadius:2,padding:"2px 8px",flexShrink:0}}>BYE</span></>
                    :isCPUOpp(opp)
                    ?<><span style={{fontSize:13,fontWeight:700,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team}</span><span style={{fontSize:10,fontWeight:800,color:"#bbb",padding:"0 8px",flexShrink:0}}>VS</span><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{formatOpp(opp)}</span></>
                    :<>
                        <span style={{flex:1,minWidth:0,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6,overflow:"hidden"}}>
                          <span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>{team}</span>
                          {logoFor(team)&&<img src={logoFor(team)} alt="" style={{height:20,width:20,objectFit:"contain",flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>}
                        </span>
                        <div style={{padding:"0 10px",textAlign:"center",flexShrink:0}}><span style={{fontSize:10,fontWeight:900,color:isGOTW?"#1a3a6b":"#bbb",letterSpacing:1}}>VS</span></div>
                        <span style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:6,overflow:"hidden"}}>
                          {logoFor(opp)&&<img src={logoFor(opp)} alt="" style={{height:20,width:20,objectFit:"contain",flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>}
                          <span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{opp}</span>
                        </span>
                      </>
                  }
                  {!isBye&&<span style={{fontSize:10,color:"#ccc",flexShrink:0,marginLeft:6}}>{isOpen?"▲":"▼"}</span>}
                </div>
                {isOpen&&!isBye&&<MatchupPreview team1={team} team2={opp2} sorted={sorted} gameArchive={gameArchive} year={year} week={week} history={history} logoFor={logoFor}/>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Schedule Panel ────────────────────────────────────────────────────────
function SchedulePanel({entries,schedule,setSchedule}) {
  const isMobile = useIsMobile();
  const [editWeek,setEditWeek] = useState(1);
  const [saved,setSaved] = useState(false);
  const [showClear,setShowClear] = useState(false);
  const [schedImg,setSchedImg] = useState(null);
  const [schedImgPreview,setSchedImgPreview] = useState(null);
  const [schedParsing,setSchedParsing] = useState(false);
  const [schedResult,setSchedResult] = useState("");
  const [weekParsing,setWeekParsing] = useState(false);
  const [weekParseResult,setWeekParseResult] = useState("");
  const weekFileRef = useRef(null);
  const teamNames = (entries||[]).map(e=>e.teamName);
  const WEEKS = Array.from({length:14},(_,i)=>i);
  const POST_SEASON_LABELS = {14:"Conf. Champ",15:"Bowl Games",16:"Playoffs R1",17:"Playoffs R2",18:"Playoffs R3",19:"Natl. Champ"};
  const OPPONENTS = ["BYE","CPU",...teamNames];
  const SUPA_URL2 = "https://uyaqmdljwwslskoqxvpn.supabase.co";
  const SUPA_KEY2 = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";

  function handleSchedImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSchedImg(file);
    setSchedResult("");
    const reader = new FileReader();
    reader.onload = ev => setSchedImgPreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function parseScheduleImage() {
    if (!schedImg) return;
    setSchedParsing(true);
    setSchedResult("");
    try {
      const b64 = await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=e=>res(e.target.result.split(",")[1]);reader.onerror=rej;reader.readAsDataURL(schedImg);});
      const resp = await fetch("https://dynasty-api.brockdrury.workers.dev/api/parse-screenshot", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({image:b64, mediaType:schedImg.type||"image/jpeg", teams:teamNames, type:"schedule"}),
      });
      if (!resp.ok) { const e=await resp.json().catch(()=>({})); throw new Error(e?.error||`API error ${resp.status}`); }
      const parsed = await resp.json();
      let filled = 0;
      setSchedule(prev => {
        const ns = {...prev};
        Object.entries(parsed).forEach(([wk, matchups]) => {
          const w = parseInt(wk);
          if (w < 0 || w > 13) return;
          ns[w] = {...(ns[w]||{})};
          Object.entries(matchups).forEach(([rawTeam, rawOpp]) => {
            const matchedTeam = matchDynastyTeam(rawTeam, teamNames);
            if (!matchedTeam) return;
            const matchedOpp = rawOpp === "BYE" ? "BYE" : (matchDynastyTeam(rawOpp, teamNames) || ("CPU:" + rawOpp));
            ns[w][matchedTeam] = matchedOpp; filled++;
            if (!isCPUOpp(matchedOpp) && matchedOpp !== "BYE") ns[w][matchedOpp] = matchedTeam;
          });
        });
        return ns;
      });
      setSchedResult("✅ Parsed " + Object.keys(parsed).length + " weeks (" + filled + " matchups). Review below and save.");
    } catch(e) {
      setSchedResult("❌ " + e.message);
    } finally {
      setSchedParsing(false);
    }
  }

  function setMatchup(wk,team,opp) {
    setSchedule(prev=>{
      const ns={...prev,[wk]:{...(prev[wk]||{}),[team]:opp}};
      if(opp!=="BYE"&&!isCPUopp(opp)&&teamNames.includes(opp))ns[wk][opp]=team;
      return ns;
    });
    setSaved(false);
  }

  function clearWeek(wk) {
    const label=POST_SEASON_LABELS[wk]||`Week ${wk}`;
    if(!window.confirm(`Clear all matchups for ${label}?`))return;
    setSchedule(prev=>{const ns={...prev};delete ns[wk];return ns;});
    setSaved(false);
  }

  function clearTeam(team) {
    if(!window.confirm(`Clear all matchups for ${team}?`))return;
    setSchedule(prev=>{
      const ns={};
      Object.entries(prev).forEach(([w,wk])=>{
        const nwk={...wk};
        // remove team's entry and unset them as opponent for others
        delete nwk[team];
        Object.keys(nwk).forEach(t=>{if(nwk[t]===team)delete nwk[t];});
        if(Object.keys(nwk).length)ns[w]=nwk;
      });
      return ns;
    });
    setSaved(false);
  }

  function clearAll() {
    if(!window.confirm("Clear the ENTIRE schedule? This cannot be undone."))return;
    setSchedule({});
    setSaved(false);
  }

  function saveSchedule() {
    setSchedule(curr=>{
      fetch(`${SUPA_URL2}/rest/v1/dynasty_state?id=eq.main`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json","apikey":SUPA_KEY2,"Authorization":`Bearer ${SUPA_KEY2}`,"Prefer":"return=minimal"},
        body:JSON.stringify({schedule:curr,updated_at:new Date().toISOString()}),
      }).then(()=>{setSaved(true);setTimeout(()=>setSaved(false),2500);}).catch(console.error);
      return curr;
    });
  }

  const isCPUopp=isCPUOpp;
  const getCPUTeam=cpuOppName;
  const getOpp=(wk,team)=>schedule[wk]?.[team]||"";
  const countGames=team=>WEEKS.filter(w=>schedule[w]?.[team]&&schedule[w][team]!=="").length;
  const confCount=team=>WEEKS.filter(w=>schedule[w]?.[team]&&!isCPUopp(schedule[w][team])&&schedule[w][team]!=="BYE").length;
  const cpuCount=team=>WEEKS.filter(w=>isCPUopp(schedule[w]?.[team])).length;

  if(!teamNames.length) return (
    <Card style={{padding:20}}><div style={{color:"#888",fontSize:14,textAlign:"center"}}>No teams found. Set up your league first in League Setup.</div></Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{padding:16}}>
        <SL>Import Schedule from Screenshot</SL>
        <p style={{fontSize:13,color:"#888",marginBottom:12,lineHeight:1.5}}>Take a screenshot of your dynasty schedule screen and Claude will read all 14 weeks automatically (including Week 0).</p>
        <input type="file" accept="image/*" onChange={handleSchedImage} style={{color:"#111",fontSize:13,marginBottom:12,display:"block"}}/>
        {schedImgPreview&&<img src={schedImgPreview} alt="schedule preview" style={{maxWidth:"100%",maxHeight:180,borderRadius:2,border:"1px solid #ddd",marginBottom:12,display:"block"}}/>}
        <button onClick={parseScheduleImage} disabled={!schedImg||schedParsing} style={{background:schedImg&&!schedParsing?RED:"#ccc",color:"#fff",border:"none",borderRadius:2,padding:"9px 18px",cursor:schedImg&&!schedParsing?"pointer":"not-allowed",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>{schedParsing?"Reading Schedule...":"Parse Schedule →"}</button>
        {schedResult&&<div style={{marginTop:10,background:"#f7f7f7",borderRadius:2,padding:10,fontSize:13,color:"#111",borderLeft:`3px solid ${schedResult.startsWith("✅")?"#007a00":RED}`}}>{schedResult}</div>}
      </Card>
      <Card style={{padding:16}}>
        <SL>Season Schedule Setup</SL>
        <p style={{fontSize:13,color:"#888",marginBottom:14,lineHeight:1.5}}>Set each team's opponent for every week. Picking a dynasty team auto-fills both sides. Each team needs 10 conference + 2 CPU games.</p>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"#555",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Schedule Progress</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6}}>
            {teamNames.map(t=>{
              const g=countGames(t),c=confCount(t),cpu=cpuCount(t),done=g===12;
              return(<div key={t} style={{background:done?"#f0f8f0":"#f9f9f9",border:`1px solid ${done?"#cce5cc":"#eee"}`,borderRadius:3,padding:"7px 10px"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t}</div>
                <div style={{fontSize:10,color:done?"#007a00":"#888",marginTop:2}}>{g}/12 · {c} conf · {cpu} CPU</div>
                <div style={{background:"#eee",borderRadius:2,height:4,marginTop:4,overflow:"hidden"}}><div style={{width:`${(g/12)*100}%`,height:"100%",background:done?RED:"#ccc",borderRadius:2}}/></div>
              </div>);
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
          {WEEKS.map(w=>{
            const gset=teamNames.filter(t=>schedule[w]?.[t]).length;
            const done=gset===teamNames.length&&teamNames.length>0;
            return(<button key={w} onClick={()=>setEditWeek(w)} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:editWeek===w?RED:done?"#cce5cc":"#ddd",background:editWeek===w?RED:done?"#f0f8f0":"#fff",color:editWeek===w?"#fff":done?"#007a00":"#555",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff}}>Wk {w}</button>);
          })}
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,paddingTop:6,borderTop:"1px solid #eee"}}>
          {Object.entries(POST_SEASON_LABELS).map(([w,label])=>{
            const wn=Number(w);
            const gset=teamNames.filter(t=>schedule[wn]?.[t]).length;
            const done=gset>0;
            return(<button key={w} onClick={()=>setEditWeek(wn)} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:editWeek===wn?RED:done?"#cce5cc":"#ddd",background:editWeek===wn?RED:done?"#f0f8f0":"#fff",color:editWeek===wn?"#fff":done?"#007a00":"#555",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff}}>{label}</button>);
          })}
        </div>
        <div style={{background:"#f9f9f9",border:"1px solid #eee",borderRadius:3,padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
            <div style={{fontSize:12,fontWeight:800,color:"#111",textTransform:"uppercase",letterSpacing:0.5,flex:1}}>{POST_SEASON_LABELS[editWeek]||`Week ${editWeek}`} Matchups</div>
            <label style={{background:weekParsing?"#ccc":RED,color:"#fff",fontSize:11,fontWeight:700,padding:"6px 12px",borderRadius:2,cursor:weekParsing?"wait":"pointer",fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap",opacity:weekParsing?0.7:1}}>
              {weekParsing?"Scanning...":"📷 Scan Schedule"}
              <input ref={weekFileRef} type="file" accept="image/*" style={{display:"none"}} disabled={weekParsing} onChange={async e=>{
                const file=e.target.files?.[0]; if(!file)return;
                setWeekParsing(true); setWeekParseResult("");
                try{
                  const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
                  const prompt=`You are transcribing a College Football 27 dynasty schedule screenshot. Do not try to judge which teams are user-controlled vs CPU-controlled — just transcribe exactly what is shown. For every matchup visible in the image, write down both team names exactly as displayed (verbatim — do not abbreviate, expand, or normalize any name). If a team has a bye week (no opponent shown), use "BYE" for that entry. Respond with ONLY the JSON object below and nothing else — no explanation, no reasoning, no markdown fences: {"1":{"TeamA":"TeamB","TeamB":"TeamA"},"3":{"TeamC":"BYE"}} Use only week numbers as keys (integers as strings). Only include weeks and teams visible in the image.`;
                  const rawText=await callClaudeVision(b64,file.type||"image/jpeg",prompt);
                  const cleaned=rawText.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
                  const jsonStr=extractJsonObject(cleaned);
                  const parsed=JSON.parse(jsonStr);
                  let filled=0;
                  setSchedule(prev=>{
                    const ns={...prev};
                    Object.entries(parsed).forEach(([wk,matchups])=>{
                      const w=parseInt(wk);
                      ns[w]={...(ns[w]||{})};
                      Object.entries(matchups).forEach(([rawTeam,rawOpp])=>{
                        const mt=matchDynastyTeam(rawTeam,teamNames);
                        if(!mt)return; // not one of our dynasty teams — skip rather than corrupt the schedule
                        const mo=rawOpp==="BYE"?"BYE":(matchDynastyTeam(rawOpp,teamNames)||("CPU:"+rawOpp));
                        ns[w][mt]=mo; filled++;
                        if(!isCPUOpp(mo)&&mo!=="BYE")ns[w][mo]=mt;
                      });
                    });
                    return ns;
                  });
                  const weeks=Object.keys(parsed);
                  if(weeks.length===1)setEditWeek(parseInt(weeks[0]));
                  setWeekParseResult(`✅ Filled ${filled} matchups for week${weeks.length>1?"s":""}${weeks.length>1?" "+weeks.join(", "):""}.`);
                }catch(err){setWeekParseResult("❌ "+err.message);}
                finally{setWeekParsing(false);if(weekFileRef.current)weekFileRef.current.value="";}
              }}/>
            </label>
          </div>
          {weekParseResult&&<div style={{marginBottom:10,padding:"6px 10px",borderRadius:2,fontSize:12,background:"#f7f7f7",borderLeft:`3px solid ${weekParseResult.startsWith("✅")?"#007a00":RED}`,color:"#111"}}>{weekParseResult}</div>}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {teamNames.map(team=>{
              const opp=getOpp(editWeek,team);
              const isCPU=isCPUopp(opp);
              const cpuTeamName=getCPUTeam(opp);
              const selectVal=isCPU?"CPU":opp;
              const autoSet=opp&&opp!=="BYE"&&!isCPU&&teamNames.includes(opp)&&getOpp(editWeek,opp)===team;
              return(
                <div key={team} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#fff",border:"1px solid #eee",borderRadius:2,flexWrap:"wrap"}}>
                  <div style={{width:130,fontSize:13,fontWeight:600,color:"#111",flexShrink:0}}>{team}</div>
                  <div style={{fontSize:11,color:"#aaa",flexShrink:0}}>vs</div>
                  <select value={selectVal} onChange={e=>{
                    const v=e.target.value;
                    setMatchup(editWeek,team,v==="CPU"?"CPU":v);
                  }} disabled={autoSet} style={{flex:1,minWidth:120,background:autoSet?"#f0f8f0":"#fff",border:"1px solid #ddd",borderRadius:2,padding:"5px 8px",fontFamily:ff,fontSize:12,color:selectVal?"#111":"#aaa"}}>
                    <option value="">-- Not set --</option>
                    {OPPONENTS.filter(o=>o!==team).map(o=><option key={o} value={o}>{o==="BYE"?"🏖️ BYE WEEK":o==="CPU"?"💻 CPU (non-conf)":o}</option>)}
                  </select>
                  {isCPU&&<input
                    type="text"
                    placeholder="CPU team name (e.g. Florida State)"
                    value={cpuTeamName}
                    onChange={e=>{
                      const name=e.target.value;
                      setMatchup(editWeek,team,name?"CPU:"+name:"CPU");
                    }}
                    style={{flex:2,minWidth:160,border:"1px solid #ddd",borderRadius:2,padding:"5px 8px",fontFamily:ff,fontSize:12,color:"#111"}}
                  />}
                  {autoSet&&<span style={{fontSize:10,color:"#007a00",flexShrink:0,fontWeight:600}}>✓ Auto</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
          <button onClick={saveSchedule} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>💾 Save Schedule</button>
          {saved&&<div style={{fontSize:12,color:"#007a00",fontWeight:700}}>✓ Saved!</div>}
          <button onClick={()=>setShowClear(p=>!p)} style={{background:"#f5f5f5",color:"#555",border:"1px solid #ddd",borderRadius:2,padding:"11px 16px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:700}}>{showClear?"▲ Hide":"🗑 Clear Options"}</button>
        </div>
        {showClear&&<div style={{background:"#fff8f8",border:"1px solid #fcc",borderRadius:3,padding:14,marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:RED,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Clear Schedule</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div style={{fontSize:11,color:"#555",fontWeight:700,marginBottom:6}}>Clear Entire Schedule</div>
              <button onClick={clearAll} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"7px 16px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>🗑 Clear All Weeks</button>
            </div>
            <div>
              <div style={{fontSize:11,color:"#555",fontWeight:700,marginBottom:6}}>Clear by Week</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {WEEKS.map(w=>{
                  const set=teamNames.filter(t=>schedule[w]?.[t]).length;
                  return set>0?<button key={w} onClick={()=>clearWeek(w)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid #fcc",background:"#fff",color:RED,cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>Wk {w}</button>:null;
                })}
              </div>
            </div>
            <div>
              <div style={{fontSize:11,color:"#555",fontWeight:700,marginBottom:6}}>Clear by Team</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {teamNames.map(t=>(
                  <button key={t} onClick={()=>clearTeam(t)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid #fcc",background:"#fff",color:RED,cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{fontSize:10,color:"#aaa",marginTop:10}}>Remember to Save Schedule after clearing.</div>
        </div>}
      </Card>
      {!isMobile&&teamNames.length>0&&Object.keys(schedule).length>0&&(
        <Card style={{overflow:"hidden"}}>
          <CardHead>Full Schedule Grid</CardHead>
          <div style={{overflowX:"auto",padding:14}}>
            <table style={{borderCollapse:"collapse",fontSize:11,width:"100%"}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`}}>
                <th style={{padding:"6px 10px",textAlign:"left",color:"#555",fontWeight:800,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>Team</th>
                {WEEKS.map(w=><th key={w} style={{padding:"6px 8px",textAlign:"center",color:"#555",fontWeight:800,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>W{w}</th>)}
              </tr></thead>
              <tbody>
                {teamNames.map((team,i)=>(
                  <tr key={team} style={{borderBottom:"1px solid #eee",background:i%2===0?"#fafafa":"#fff"}}>
                    <td style={{padding:"7px 10px",fontWeight:700,color:"#111",whiteSpace:"nowrap"}}>{team}</td>
                    {WEEKS.map(w=>{
                      const o=schedule[w]?.[team]||"";
                      return(<td key={w} style={{padding:"7px 8px",textAlign:"center",whiteSpace:"nowrap"}}>
                        {o==="BYE"?<span style={{fontSize:10,color:"#aaa"}}>BYE</span>:isCPUopp(o)?<span style={{fontSize:10,color:"#888",fontWeight:600}} title={formatOpp(o)}>{getCPUTeam(o)?`${getCPUTeam(o).split(" ")[0]} (CPU)`:"CPU"}</span>:o?<span style={{fontSize:10,color:"#111",fontWeight:500}}>{o.split(" ")[0]}</span>:<span style={{color:"#ddd"}}>—</span>}
                      </td>);
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// Games flagged from Enter Results ("🏆 Instant Classic") — a lightweight year/week/team-pair
// tag independent of gameArchive, so it works whether or not a box score was ever scanned.
// When an archived box score does exist for the tagged game, the row expands into the same
// BoxScoreDetail view used everywhere else.
function ClassicGamesCard({classicGames, gameArchive, setupRows}) {
  const [expanded,setExpanded] = useState({});
  const games=[...(classicGames||[])].sort((a,b)=>b.year!==a.year?b.year-a.year:b.week-a.week);
  if(!games.length) return null;
  const logoFor=(teamName)=>{
    const row=(setupRows||[]).find(r=>r.teamName===teamName);
    return row?getPlayerImages(setupRows,row.userId,row.userName).teamLogo:null;
  };
  return (
    <Card style={{overflow:"hidden"}}>
      <CardHead bg="#b8860b">🏆 Classic Games</CardHead>
      <div style={{padding:14,display:"flex",flexDirection:"column",gap:8}}>
        {games.map((g,i)=>{
          const archivedGame=(gameArchive||[]).find(ga=>ga.year===g.year&&ga.week===g.week&&((ga.team1.name===g.teamA&&ga.team2.name===g.teamB)||(ga.team1.name===g.teamB&&ga.team2.name===g.teamA)));
          const key=`${g.year}-${g.week}-${g.teamA}-${g.teamB}-${i}`;
          const isOpen=expanded[key];
          const score=archivedGame&&(archivedGame.team1.name===g.teamA?`${archivedGame.team1.score}-${archivedGame.team2.score}`:`${archivedGame.team2.score}-${archivedGame.team1.score}`);
          return (
            <div key={key} style={{border:"1px solid #f0e6cc",borderRadius:2,overflow:"hidden"}}>
              <div onClick={archivedGame?()=>setExpanded(p=>({...p,[key]:!p[key]})):undefined} style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",cursor:archivedGame?"pointer":"default",background:"#fffbf0"}}>
                <span style={{fontSize:16}}>🏆</span>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:800,color:"#111",minWidth:0}}>
                  <TeamLogo url={logoFor(g.teamA)} size={18}/>
                  <span>{g.teamA}</span>
                  <span style={{color:"#bbb",fontWeight:600}}>vs</span>
                  <TeamLogo url={logoFor(g.teamB)} size={18}/>
                  <span>{g.teamB}</span>
                  {score&&<span style={{marginLeft:8,color:"#555",fontWeight:700}}>{score}</span>}
                </div>
                <div style={{fontSize:11,color:"#888",flexShrink:0}}>Wk {g.week} · {g.year}</div>
                {archivedGame&&<span style={{color:"#ccc",fontSize:11,flexShrink:0}}>{isOpen?"▲":"▼"}</span>}
              </div>
              {isOpen&&archivedGame&&<div style={{padding:"10px 14px",background:"#fff"}}><BoxScoreDetail team1={archivedGame.team1} team2={archivedGame.team2}/></div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────
function HistoryTab({history, setHistory, saveToDb, commUnlocked, entries, setEntries, season, week, setWeek, yearRosters, permanentUsers, currentEntries, year, setupRows, gameArchive, classicGames, playerStats}) {
  // Apply per-year team overrides from yearRosters to a standings array (username never changes)
  function applyRoster(standings, yr) {
    const roster = yearRosters?.[yr];
    if(!roster?.length) return standings;
    return standings.map(t=>{
      let ov = roster.find(r=>r.userId && r.userId===t.userId);
      if(!ov && permanentUsers?.length) {
        const pu = permanentUsers.find(u=>u.defaultName===t.userName);
        if(pu) ov = roster.find(r=>r.userId===pu.id);
      }
      if(!ov) return t;
      return {...t, teamName:ov.teamName||t.teamName};
    });
  }
  const isMobile = useIsMobile();
  const [sel,setSel] = useState(null);
  const [editing,setEditing] = useState(null);
  const [editData,setEditData] = useState(null);
  const [expandTeam,setExpandTeam] = useState({});
  const [liveEdit,setLiveEdit] = useState(false);
  const [liveData,setLiveData] = useState(null);
  const [showAllWins,setShowAllWins] = useState(false);
  // Aggregate all-time stats — userName is permanent, only teamName changes per season
  const allWins={}, confT={}, nattyT={};
  history.forEach(s=>{
    const nameMap={};
    s.finalStandings.forEach(t=>{ nameMap[t.teamName]=t.userName; });
    // Also map yearRoster override team names so confChampion strings stored with display names resolve correctly
    ((yearRosters||{})[s.year]||[]).forEach(r=>{ if(r.teamName&&r.userName) nameMap[r.teamName]=r.userName; });
    const gotNatty=new Set(), gotConf=new Set();
    s.finalStandings.forEach(t=>{
      allWins[t.userName]=(allWins[t.userName]||0)+(t.wins||0);
      if((t.nattyWins||0)>0){nattyT[t.userName]=(nattyT[t.userName]||0)+t.nattyWins;gotNatty.add(t.userName);}
      else if(t.nattyWinner===true){nattyT[t.userName]=(nattyT[t.userName]||0)+1;gotNatty.add(t.userName);}
      if((t.confChampWins||0)>0){confT[t.userName]=(confT[t.userName]||0)+t.confChampWins;gotConf.add(t.userName);}
      else if(t.confChampion===true){confT[t.userName]=(confT[t.userName]||0)+1;gotConf.add(t.userName);}
    });
    if(s.nattyWinner){s.nattyWinner.split(", ").filter(Boolean).forEach(tn=>{
      const un=nameMap[tn]||tn;
      if(!gotNatty.has(un)){nattyT[un]=(nattyT[un]||0)+1;}
    });}
    if(s.confChampion){s.confChampion.split(", ").filter(Boolean).forEach(tn=>{
      const un=nameMap[tn]||tn;
      if(!gotConf.has(un)){confT[un]=(confT[un]||0)+1;}
    });}
  });
  (currentEntries||entries||[]).forEach(t=>{allWins[t.userName]=(allWins[t.userName]||0)+(t.wins||0);});
  const wList=Object.entries(allWins).sort((a,b)=>b[1]-a[1]);

  // Sort history by year descending
  const sortedHistory=[...history].sort((a,b)=>(b.year||0)-(a.year||0));

  const numI=(val,onChange,w=52)=><NumField value={val} onChange={onChange} width={w}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <LeagueRecordBook history={history} currentEntries={currentEntries||entries||[]} season={season} year={year} permanentUsers={permanentUsers} setupRows={setupRows||[]} gameArchive={gameArchive} playerStats={playerStats}/>

      {/* Live Season Editor */}
      {commUnlocked&&entries?.length>0&&<Card style={{borderTop:`3px solid ${RED}`,overflow:"hidden"}}>
        <div style={{background:"#111",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <span style={{fontSize:13,fontWeight:900,color:"#fff",letterSpacing:1}}>CURRENT SEASON</span>
            <span style={{fontSize:11,color:"#888",marginLeft:10}}>{season&&week!==undefined&&week!==null?`S${season} · Week ${week}`:""}</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            {!liveEdit&&<button onClick={()=>{setLiveEdit(true);setLiveData(JSON.parse(JSON.stringify(entries)));}} style={{padding:"4px 12px",background:"#1a3a6b",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>✏️ Edit</button>}
            {liveEdit&&<button onClick={()=>{
              setEntries(liveData);
              saveToDb({entries:liveData});
              setLiveEdit(false);setLiveData(null);
            }} style={{padding:"4px 12px",background:"#007a00",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>✓ Save</button>}
            {liveEdit&&<button onClick={()=>{setLiveEdit(false);setLiveData(null);}} style={{padding:"4px 12px",background:"#888",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>Cancel</button>}
            {liveEdit&&<button onClick={()=>{if(!window.confirm("Reset all current season stats to zero? This cannot be undone."))return;const blank=liveData.map(e=>({...e,wins:0,losses:0,confWins:0,confLosses:0,gamePts:0,rankedBonusPts:0,confStandPts:0,confChampPts:0,bowlPts:0,recruitingPts:0,prestigePts:0,heismanPts:0,weekLog:[],h2h:{}}));setLiveData(blank);}} style={{padding:"4px 12px",background:RED,color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>🗑 Reset Season</button>}
          </div>
        </div>
        {liveEdit&&<div style={{padding:"8px 14px",background:"#fffbf0",fontSize:11,color:"#886600",fontWeight:600,borderBottom:"1px solid #f0c040"}}>
          Editing week directly also: <select value={week} onChange={e=>{const w=Number(e.target.value);setWeek(w);saveToDb({week:w});}} style={{fontFamily:ff,fontSize:11,padding:"2px 6px",border:"1px solid #ddd",borderRadius:2}}>
            {Array.from({length:20},(_,i)=>i+1).map(w=><option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>}
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?11:12}}>
            <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>
              {["User","Team","W","L","Game","Ranked","Conf St","Conf Ch","Bowl","Recruit","Prestige","Heisman","Total"].map(h=><th key={h} style={{padding:"6px 5px",textAlign:h==="User"||h==="Team"?"left":"center",color:"#555",fontSize:9,letterSpacing:0.5,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{(liveEdit?liveData:entries).map((t,i)=>{
              const tot=calcTotal(t);
              const setF=(field,val)=>setLiveData(prev=>prev.map((e,j)=>j===i?{...e,[field]:parseInt(val)||0}:e));
              return(<tr key={t.teamName} style={{borderBottom:"1px solid #eee",background:i%2===0?"#fff":"#fafafa"}}>
                <td style={{padding:"6px 5px",fontWeight:700,color:"#111",whiteSpace:"nowrap"}}>{t.userName}</td>
                <td style={{padding:"6px 5px",color:"#888",fontSize:11,whiteSpace:"nowrap"}}>{t.teamName}</td>
                {liveEdit?(<>
                  <td style={{padding:"3px 2px"}}>{numI(t.wins,v=>setF("wins",v),38)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.losses,v=>setF("losses",v),38)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.gamePts,v=>setF("gamePts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.rankedBonusPts,v=>setF("rankedBonusPts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.confStandPts,v=>setF("confStandPts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.confChampPts,v=>setF("confChampPts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.bowlPts,v=>setF("bowlPts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.recruitingPts,v=>setF("recruitingPts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.prestigePts,v=>setF("prestigePts",v),44)}</td>
                  <td style={{padding:"3px 2px"}}>{numI(t.heismanPts,v=>setF("heismanPts",v),44)}</td>
                  <td style={{padding:"6px 5px",textAlign:"center",fontWeight:900,color:RED,fontSize:13}}>{calcTotal(t)}</td>
                </>):(
                  [t.wins,t.losses,t.gamePts,t.rankedBonusPts,t.confStandPts,t.confChampPts,t.bowlPts,t.recruitingPts,t.prestigePts,t.heismanPts].map((v,j)=><td key={j} style={{padding:"6px 5px",textAlign:"center",color:j===0?"#007a00":j===1?RED:"#555"}}>{v||0}</td>)
                  .concat(<td key="tot" style={{padding:"6px 5px",textAlign:"center",fontWeight:900,color:RED,fontSize:13}}>{tot}</td>)
                )}
              </tr>);
            })}</tbody>
          </table>
        </div>
      </Card>}

      {/* All-Time Leaders */}
      {history.length>0&&<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:14}}>
        <Card><CardHead bg={RED}>All-Time Wins</CardHead><div style={{padding:"4px 0"}}>
          {(()=>{const filtered=wList.filter(([,w])=>w>0);const display=showAllWins?filtered:filtered.slice(0,5);return(<>
            {display.length===0&&<div style={{padding:"10px 12px",fontSize:12,color:"#aaa"}}>No wins recorded yet</div>}
            {display.map(([u,w],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}>
              <span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span>
              <span style={{fontSize:13,fontWeight:800,color:"#007a00"}}>{w}W</span>
            </div>)}
            {filtered.length>5&&<button onClick={()=>setShowAllWins(v=>!v)} style={{width:"100%",padding:"8px",background:"none",border:"none",borderTop:"1px solid #f0f0f0",color:RED,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5}}>{showAllWins?`Show Less ▲`:`Show All (${filtered.length}) ▼`}</button>}
          </>);})()}
        </div></Card>
        <Card><CardHead bg="#1a3a6b">National Titles</CardHead><div style={{padding:"4px 0"}}>
          {Object.keys(nattyT).length===0&&<div style={{padding:"10px 12px",fontSize:12,color:"#aaa"}}>None recorded</div>}
          {Object.entries(nattyT).sort((a,b)=>b[1]-a[1]).map(([u,n],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}>
            <span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span>
            <span style={{fontSize:13,fontWeight:800,color:"#1a3a6b"}}>{n}×</span>
          </div>)}
        </div></Card>
        <Card><CardHead bg="#333">Conf Titles</CardHead><div style={{padding:"4px 0"}}>
          {Object.keys(confT).length===0&&<div style={{padding:"10px 12px",fontSize:12,color:"#aaa"}}>None recorded</div>}
          {Object.entries(confT).sort((a,b)=>b[1]-a[1]).map(([u,n],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}>
            <span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span>
            <span style={{fontSize:13,fontWeight:800,color:"#333"}}>{n}×</span>
          </div>)}
        </div></Card>
      </div>}

      {/* Season History - sorted by year */}
      <Card><CardHead>Season History</CardHead>
        {!history.length&&<div style={{padding:"16px 14px",color:"#aaa",fontSize:13,textAlign:"center"}}>No completed seasons yet.</div>}
        <div style={{padding:"12px 14px",display:"flex",gap:8,flexWrap:"wrap"}}>
          {sortedHistory.map((s,i)=>{const key=s.year+"-"+i;return(<button key={key} onClick={()=>{setSel(sel===key?null:key);setEditing(null);}} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:sel===key?RED:s.isHistorical?"#aaa":"#ddd",background:sel===key?RED:s.isHistorical?"#f5f5f5":"#fff",color:sel===key?"#fff":"#555",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>{s.year}{s.isHistorical?" · HIST":` · S${s.seasonNum}`}</button>);})}
        </div>
        {sel!==null&&(()=>{
          const selIdx=sortedHistory.findIndex((_,i)=>sel===_.year+"-"+i);
          const s=selIdx>=0?sortedHistory[selIdx]:null;
          if(!s)return null;
          // Find index in original history array for mutations
          const histIdx=history.indexOf(s);

          function handleDelete(){
            if(!window.confirm(`Delete ${s.year} season? This cannot be undone.`))return;
            const next=history.filter((_,i)=>i!==histIdx);
            setHistory(next);
            saveToDb({history:next});
            setSel(null);setEditing(null);
          }

          function startEdit(){
            setEditing(selIdx);
            setEditData(JSON.parse(JSON.stringify(s)));
            setExpandTeam({});
          }

          function setEditTeam(teamName,field,val){
            setEditData(prev=>{
              const numFields=["historicalTotal","wins","losses","playoffWins","playoffLosses","top25Wins","top25Losses","top10Wins","top10Losses"];
              const standings=prev.finalStandings.map(t=>t.teamName===teamName?{...t,[field]:numFields.includes(field)?parseInt(val)||0:val}:t);
              return{...prev,finalStandings:standings};
            });
          }

          function toggleEditMulti(field,teamName){
            setEditData(prev=>{
              const cur=(prev[field]||"").split(", ").filter(Boolean);
              const next=cur.includes(teamName)?cur.filter(x=>x!==teamName):[...cur,teamName];
              return{...prev,[field]:next.join(", ")};
            });
          }

          function saveEdit(){
            const srt=[...editData.finalStandings].sort((a,b)=>calcTotal(b)-calcTotal(a));
            const updated={...editData,champion:srt[0]?.userName||editData.champion};
            const next=history.map((h,i)=>i===histIdx?updated:h);
            setHistory(next);
            saveToDb({history:next});
            setEditing(null);setEditData(null);
          }

          const isEditing=editing===selIdx&&editData;
          const rawData=isEditing?editData:s;
          // Apply per-year name overrides from yearRosters
          const displayData=isEditing ? rawData : (rawData.finalStandings ? {...rawData, finalStandings:applyRoster(rawData.finalStandings, rawData.year)} : rawData);
          const allTeams=displayData.finalStandings;
          const active=displayData.finalStandings.filter(t=>t.wins>0||t.losses>0||calcTotal(t)>0);
          const srt=[...(active.length?active:displayData.finalStandings)].sort((a,b)=>calcTotal(b)-calcTotal(a));
          const top=calcTotal(srt[0]);

          const numInp=(val,onChange,w=52)=><NumField value={val} onChange={onChange} width={w}/>;

          // Multi-select toggle buttons for awards
          const MultiToggle=({field,label})=>{
            const selected=(editData[field]||"").split(", ").filter(Boolean);
            return(
              <div>
                <div style={{fontSize:11,color:"#555",fontWeight:700,marginBottom:5}}>{label}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {allTeams.map(t=>{const on=selected.includes(t.teamName);return(
                    <button key={t.teamName} onClick={()=>toggleEditMulti(field,t.teamName)}
                      style={{padding:"3px 10px",borderRadius:2,border:`1px solid ${on?RED:"#ddd"}`,background:on?RED:"#fff",color:on?"#fff":"#555",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>
                      {t.teamName}
                    </button>
                  );})}
                </div>
                {selected.length>0&&<div style={{fontSize:11,color:RED,marginTop:3,fontWeight:600}}>{selected.join(", ")}</div>}
              </div>
            );
          };

          return(
            <div style={{padding:"0 14px 14px"}}>
              {/* Season badges + action buttons */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {s.isHistorical&&<div style={{background:"#555",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#fff",fontWeight:700}}>📥 IMPORTED</div>}
                  {displayData.champion&&<div style={{background:RED,borderRadius:2,padding:"3px 10px",fontSize:11,color:"#fff",fontWeight:700}}>🏆 {displayData.champion}</div>}
                  {displayData.nattyWinner&&<div style={{background:"#1a3a6b",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#fff",fontWeight:700}}>🏈 Natty: {displayData.nattyWinner}</div>}
                  {displayData.confChampion&&<div style={{background:"#f5f5f5",border:"1px solid #ddd",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#111",fontWeight:700}}>🏅 Conf: {displayData.confChampion}</div>}
                  {displayData.heisman&&<div style={{background:"#fff8e8",border:"1px solid #ddd",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#cc7700",fontWeight:700}}>🏆 Heisman: {displayData.heisman}</div>}
                </div>
                {commUnlocked&&<div style={{display:"flex",gap:6,flexShrink:0}}>
                  {!isEditing&&<button onClick={startEdit} style={{padding:"4px 12px",background:"#1a3a6b",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>✏️ Edit</button>}
                  {isEditing&&<button onClick={saveEdit} style={{padding:"4px 12px",background:"#007a00",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>✓ Save</button>}
                  {isEditing&&<button onClick={()=>{setEditing(null);setEditData(null);}} style={{padding:"4px 12px",background:"#888",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>Cancel</button>}
                  {!isEditing&&<button onClick={handleDelete} style={{padding:"4px 12px",background:RED,color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff}}>🗑 Delete</button>}
                </div>}
              </div>

              {/* Edit: awards (multi-select) + heisman */}
              {isEditing&&<div style={{background:"#f9f9f9",border:"1px solid #eee",borderRadius:2,padding:"14px",marginBottom:14,display:"flex",flexDirection:"column",gap:14}}>
                <div style={{fontSize:11,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1}}>Awards & Championships</div>
                <MultiToggle field="nattyWinner" label="🏈 National Championship Winner(s)"/>
                <MultiToggle field="nattyRunnerUp" label="National Championship Runner-Up(s)"/>
                <MultiToggle field="confChampion" label="🏅 Conference Championship Winner(s)"/>
                <MultiToggle field="confRunnerUp" label="Conference Championship Runner-Up(s)"/>
                <div>
                  <div style={{fontSize:11,color:"#555",fontWeight:700,marginBottom:5}}>🏆 Heisman Winner</div>
                  <input value={editData.heisman||""} onChange={e=>setEditData(p=>({...p,heisman:e.target.value}))}
                    placeholder="Team name" style={{padding:"5px 8px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,width:"100%",boxSizing:"border-box"}}/>
                </div>
              </div>}

              {/* Standings table */}
              <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?10:12}}>
                <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>
                  {["#","User","Team","W","L","PTS",
                    ...(isEditing?["Playoff W","Playoff L","Bowl W","Bowl L","Natty W","Natty L","Conf W","Conf L","Top25 W","Top25 L","Top10 W","Top10 L"]:["Behind"])]
                    .map(h=><th key={h} style={{padding:"6px 4px",textAlign:h==="User"||h==="Team"?"left":"center",color:"#555",fontSize:8,letterSpacing:0.5,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>{srt.map((t,i)=>{
                  const tot=calcTotal(t);
                  return(
                  <tr key={t.teamName||t.userName} style={{borderBottom:"1px solid #eee",background:i===0?"#fff8f8":"transparent"}}>
                    <td style={{padding:"6px 4px",textAlign:"center",color:i===0?RED:"#bbb",fontWeight:800,fontSize:12}}>{i+1}</td>
                    <td style={{padding:"6px 4px",color:"#111",fontWeight:i===0?800:400,whiteSpace:"nowrap"}}><Name userId={t.userId} userName={t.userName}>{t.userName}</Name></td>
                    <td style={{padding:"6px 4px",color:"#888",fontSize:11,whiteSpace:"nowrap"}}><Name userId={t.userId} userName={t.userName}>{t.teamName}</Name></td>
                    {isEditing?(
                      <>
                        <td style={{padding:"3px 2px"}}>{numInp(t.wins||0,v=>setEditTeam(t.teamName,"wins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.losses||0,v=>setEditTeam(t.teamName,"losses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.historicalTotal!==undefined?t.historicalTotal:tot,v=>setEditTeam(t.teamName,t.historicalTotal!==undefined?"historicalTotal":"gamePts",v),52)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.playoffWins||0,v=>setEditTeam(t.teamName,"playoffWins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.playoffLosses||0,v=>setEditTeam(t.teamName,"playoffLosses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.bowlWins!=null?t.bowlWins:(t.bowlResult==="win"?1:0),v=>setEditTeam(t.teamName,"bowlWins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.bowlLosses!=null?t.bowlLosses:(t.bowlResult==="loss"?1:0),v=>setEditTeam(t.teamName,"bowlLosses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.nattyWins||0,v=>setEditTeam(t.teamName,"nattyWins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.nattyLosses||0,v=>setEditTeam(t.teamName,"nattyLosses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.confChampWins||0,v=>setEditTeam(t.teamName,"confChampWins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.confChampLosses||0,v=>setEditTeam(t.teamName,"confChampLosses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.top25Wins||0,v=>setEditTeam(t.teamName,"top25Wins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.top25Losses||0,v=>setEditTeam(t.teamName,"top25Losses",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.top10Wins||0,v=>setEditTeam(t.teamName,"top10Wins",v),40)}</td>
                        <td style={{padding:"3px 2px"}}>{numInp(t.top10Losses||0,v=>setEditTeam(t.teamName,"top10Losses",v),40)}</td>
                      </>
                    ):(
                      <>
                        <td style={{padding:"6px 4px",textAlign:"center",color:"#007a00",fontWeight:700}}>{t.wins||0}</td>
                        <td style={{padding:"6px 4px",textAlign:"center",color:RED,fontWeight:700}}>{t.losses||0}</td>
                        <td style={{padding:"6px 4px",textAlign:"center",fontWeight:800,color:i===0?RED:"#111",fontSize:14}}>{tot}</td>
                        <td style={{padding:"6px 4px",textAlign:"center",color:i===0?"#007a00":RED,fontSize:12}}>{i===0?"LEAD":`-${top-tot}`}</td>
                      </>
                    )}
                  </tr>
                  );
                })}</tbody>
              </table>
              </div>
            </div>
          );
        })()}
      </Card>
      <ClassicGamesCard classicGames={classicGames} gameArchive={gameArchive} setupRows={setupRows||[]}/>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────
function ScheduleTab({schedule,entries,week,season,year,setup,setupRows,history}) {
  const isMobile = useIsMobile();
  const [view,setView] = useState("full");
  const [expanded,setExpanded] = useState({}); // key -> bool
  const [selYear,setSelYear] = useState(year);

  // Which years have browsable data: the live current year, plus any year snapshotted
  // at season finalization (setup.scheduleArchive) or present in finalized season history.
  const scheduleArchive = setup?.scheduleArchive||{};
  const availableYears = [...new Set([year, ...Object.keys(scheduleArchive).map(Number), ...(history||[]).map(h=>h.year)])].sort((a,b)=>b-a);
  const isCurrentYear = selYear===year;

  // For a past year, reconstruct the roster/results from the most recently finalized season that year
  // (finalStandings is the same shape as the live entries array).
  const pastYearEntries = (() => {
    if (isCurrentYear) return entries;
    const matches=(history||[]).filter(h=>h.year===selYear);
    return matches[matches.length-1]?.finalStandings||[];
  })();
  const effEntries = isCurrentYear ? entries : pastYearEntries;
  const effSchedule = isCurrentYear ? schedule : (scheduleArchive[selYear]||{});

  const weeks = Object.keys(effSchedule||{}).map(Number).sort((a,b)=>a-b);
  const teams = effEntries.map(e=>e.teamName).sort();

  // teamName -> logo URL, built from entries (which carry userId/userName) via the shared setupRows lookup
  const logoByTeam = {};
  // teamName -> {userId,userName}, so real dynasty teams' names can link to their profile
  const ownerByTeam = {};
  effEntries.forEach(e=>{
    const logo = getPlayerImages(setupRows, e.userId, e.userName).teamLogo;
    if (logo) logoByTeam[e.teamName] = logo;
    ownerByTeam[e.teamName] = {userId:e.userId, userName:e.userName};
  });
  // Wrap a team name in a profile link when it's one of our dynasty teams; CPU/BYE opponents stay plain text.
  // `name` is the lookup key (always the raw team name); `display` optionally overrides the rendered text
  // (e.g. formatOpp() output like "Florida State (CPU)") while still looking up the owner by the raw name.
  function TeamNameLink({name, display, style}) {
    const owner = ownerByTeam[name];
    const text = display ?? name;
    if (!owner) return <span style={style}>{text}</span>;
    return <Name userId={owner.userId} userName={owner.userName} style={style}>{text}</Name>;
  }

  // Build a lookup: teamName -> weekNum -> weekLog entry (with stats)
  const resultLookup = {};
  effEntries.forEach(e=>{
    resultLookup[e.teamName]={};
    (e.weekLog||[]).forEach(log=>{ resultLookup[e.teamName][log.week]=log; });
  });

  // Commissioner-uploaded box scores (setup.gameArchive) for the selected year — richer than weekLog.stats
  const archiveByKey = {};
  (setup?.gameArchive||[]).forEach(g=>{
    if (g.year!==selYear) return;
    archiveByKey[`${g.week}-${g.team1.name}`] = {mine:g.team1, opp:g.team2};
    archiveByKey[`${g.week}-${g.team2.name}`] = {mine:g.team2, opp:g.team1};
  });

  // For a given matchup, find the recorded game result (winner, scores) — prefers the commissioner's
  // uploaded box score (setup.gameArchive) over the thinner bulk-import weekLog.stats when both exist.
  function getGameResult(teamA, teamB, w) {
    const archA = archiveByKey[`${w}-${teamA}`];
    const logA = resultLookup[teamA]?.[w];
    const logB = resultLookup[teamB]?.[w];
    if (!archA && !logA && !logB) return null;
    const statsA = logA?.stats || null;
    const statsB = logB?.stats || null;
    const scoreA = archA ? archA.mine.score : (logA?.score ?? logA?.scoreFor ?? null);
    const scoreB = archA ? archA.opp.score : (logB?.score ?? logB?.scoreFor ?? null);
    const winner = scoreA!=null&&scoreB!=null ? (scoreA>scoreB?teamA:scoreB>scoreA?teamB:null) : (logA?.result==="win"?teamA:logB?.result==="win"?teamB:null);
    const loser = winner ? (winner===teamA?teamB:teamA) : (logA?.result==="loss"?teamA:logB?.result==="loss"?teamB:null);
    return {winner, loser, logA, logB, statsA, statsB, scoreA, scoreB, archiveGame: archA||null};
  }

  function BoxScore({teamA, teamB, result}) {
    const {statsA, statsB, scoreA, scoreB, archiveGame} = result;
    const wA = scoreA!=null&&scoreB!=null ? scoreA>scoreB : result.winner===teamA;
    const wB = scoreA!=null&&scoreB!=null ? scoreB>scoreA : result.winner===teamB;

    if (archiveGame) {
      const {mine,opp} = archiveGame;
      return (
        <div style={{background:"#111",padding:0,borderTop:"1px solid #333"}}>
          <div style={{display:"flex",alignItems:"stretch",background:"#1a1a1a",borderBottom:"1px solid #333"}}>
            <div style={{flex:1,padding:"10px 14px",textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:wA?900:600,color:wA?"#fff":"#888",display:"flex",alignItems:"center",justifyContent:"flex-end",gap:5}}><TeamNameLink name={teamA}/><TeamLogo url={logoByTeam[teamA]} size={16}/></div>
              <div style={{fontSize:22,fontWeight:900,color:wA?"#fff":"#888",lineHeight:1.1}}>{mine.score}</div>
            </div>
            <div style={{padding:"10px 8px",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{fontSize:9,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1}}>FINAL</div>
            </div>
            <div style={{flex:1,padding:"10px 14px",textAlign:"left"}}>
              <div style={{fontSize:13,fontWeight:wB?900:600,color:wB?"#fff":"#888",display:"flex",alignItems:"center",gap:5}}><TeamLogo url={logoByTeam[teamB]} size={16}/><TeamNameLink name={teamB}/></div>
              <div style={{fontSize:22,fontWeight:900,color:wB?"#fff":"#888",lineHeight:1.1}}>{opp.score}</div>
            </div>
          </div>
          <div style={{padding:12,fontSize:11}}>
            <BoxScoreDetail team1={mine} team2={opp} dark/>
          </div>
        </div>
      );
    }

    const rows = [
      ["Passing Yds",    statsA?.passing_yards, statsB?.passing_yards],
      ["Rushing Yds",    statsA?.rushing_yards, statsB?.rushing_yards],
      ["Total Yds",      statsA?.total_yards,   statsB?.total_yards],
      ["Turnovers",      statsA?.turnovers,     statsB?.turnovers],
      ["Interceptions",  statsA?.interceptions, statsB?.interceptions],
    ];
    const hasStats = statsA || statsB;
    return (
      <div style={{background:"#111",padding:"0",borderTop:"1px solid #333"}}>
        {/* Score header */}
        <div style={{display:"flex",alignItems:"stretch",background:"#1a1a1a",borderBottom:"1px solid #333"}}>
          <div style={{flex:1,padding:"10px 14px",textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:wA?900:600,color:wA?"#fff":"#888",display:"flex",alignItems:"center",justifyContent:"flex-end",gap:5}}><TeamNameLink name={teamA}/><TeamLogo url={logoByTeam[teamA]} size={16}/></div>
            {(scoreA!=null)&&<div style={{fontSize:22,fontWeight:900,color:wA?"#fff":"#888",lineHeight:1.1}}>{scoreA}</div>}
          </div>
          <div style={{padding:"10px 8px",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontSize:9,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1}}>FINAL</div>
          </div>
          <div style={{flex:1,padding:"10px 14px",textAlign:"left"}}>
            <div style={{fontSize:13,fontWeight:wB?900:600,color:wB?"#fff":"#888",display:"flex",alignItems:"center",gap:5}}><TeamLogo url={logoByTeam[teamB]} size={16}/><TeamNameLink name={teamB}/></div>
            {(scoreB!=null)&&<div style={{fontSize:22,fontWeight:900,color:wB?"#fff":"#888",lineHeight:1.1}}>{scoreB}</div>}
          </div>
        </div>
        {/* Stats table */}
        {hasStats&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>
            <th style={{padding:"6px 14px",textAlign:"right",color:"#555",fontSize:9,fontWeight:800,letterSpacing:1,textTransform:"uppercase",width:"40%"}}>{teamA}</th>
            <th style={{padding:"6px 8px",textAlign:"center",color:"#444",fontSize:9,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>&nbsp;</th>
            <th style={{padding:"6px 14px",textAlign:"left",color:"#555",fontSize:9,fontWeight:800,letterSpacing:1,textTransform:"uppercase",width:"40%"}}>{teamB}</th>
          </tr></thead>
          <tbody>{rows.map(([label,valA,valB])=>{
            const hasStat=valA!=null||valB!=null;
            if(!hasStat)return null;
            const lowerBetter=label==="Turnovers"||label==="Interceptions";
            const aWins=lowerBetter?(valA!=null&&valB!=null&&valA<valB):(valA!=null&&valB!=null&&valA>valB);
            const bWins=lowerBetter?(valB!=null&&valA!=null&&valB<valA):(valB!=null&&valA!=null&&valB>valA);
            return(<tr key={label} style={{borderTop:"1px solid #222"}}>
              <td style={{padding:"7px 14px",textAlign:"right",fontWeight:aWins?800:400,color:aWins?"#fff":"#888",fontSize:13}}>{valA??"-"}</td>
              <td style={{padding:"7px 8px",textAlign:"center",color:"#444",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>{label}</td>
              <td style={{padding:"7px 14px",textAlign:"left",fontWeight:bWins?800:400,color:bWins?"#fff":"#888",fontSize:13}}>{valB??"-"}</td>
            </tr>);
          })}</tbody>
        </table>}
        {!hasStats&&<div style={{padding:"10px 14px",color:"#555",fontSize:11,textAlign:"center"}}>No box score data recorded for this game.</div>}
      </div>
    );
  }

  function MatchupRow({home, away, w}) {
    const isCPU = isCPUOpp(away);
    const result = away!=="BYE" ? getGameResult(home, away, w) : null;
    const played = !!result;
    const winHome = result?.winner===home, winAway = result?.winner===away;
    const key = `${w}-${[home,away].sort().join("||")}`;
    const isOpen = expanded[key];

    return (
      <div style={{borderBottom:"1px solid #f0f0f0"}}>
        <div
          onClick={played ? ()=>setExpanded(p=>({...p,[key]:!p[key]})) : undefined}
          style={{display:"flex",alignItems:"center",padding:"10px 12px",gap:6,cursor:played?"pointer":"default",background:isOpen?"#fafafa":"transparent"}}
          onMouseEnter={played?e=>e.currentTarget.style.background="#fafafa":undefined}
          onMouseLeave={played?e=>e.currentTarget.style.background=isOpen?"#fafafa":"transparent":undefined}
        >
          {/* Home side */}
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:5,minWidth:0}}>
            <TeamNameLink name={home} style={{fontSize:13,fontWeight:played?(winHome?800:500):700,color:played?(winHome?"#111":"#999"):"#111",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}/>
            <TeamLogo url={logoByTeam[home]} size={18}/>
            {played&&<span style={{fontSize:10,fontWeight:800,padding:"1px 5px",borderRadius:2,background:winHome?"#e8f5e9":"#fff0f0",color:winHome?"#007a00":RED,flexShrink:0}}>{winHome?"W":"L"}</span>}
          </div>

          {/* Score / VS center */}
          <div style={{textAlign:"center",minWidth:60,flexShrink:0}}>
            {played ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                {result.scoreA!=null&&<span style={{fontSize:14,fontWeight:900,color:winHome?"#111":"#999"}}>{result.scoreA}</span>}
                <span style={{fontSize:10,fontWeight:800,color:"#ccc"}}>–</span>
                {result.scoreB!=null&&<span style={{fontSize:14,fontWeight:900,color:winAway?"#111":"#999"}}>{result.scoreB}</span>}
                {result.scoreA==null&&result.scoreB==null&&<span style={{fontSize:9,fontWeight:800,color:"#007a00",textTransform:"uppercase",padding:"1px 5px",background:"#f0f8f0",borderRadius:2}}>FINAL</span>}
              </div>
            ) : (
              <span style={{fontSize:10,fontWeight:800,color:"#bbb",padding:"2px 6px",border:"1px solid #eee",borderRadius:2}}>{isCPU?"":"VS"}</span>
            )}
          </div>

          {/* Away side */}
          <div style={{flex:1,display:"flex",alignItems:"center",gap:5,minWidth:0}}>
            {played&&<span style={{fontSize:10,fontWeight:800,padding:"1px 5px",borderRadius:2,background:winAway?"#e8f5e9":"#fff0f0",color:winAway?"#007a00":RED,flexShrink:0}}>{winAway?"W":"L"}</span>}
            <TeamLogo url={logoByTeam[away]} size={18}/>
            <TeamNameLink name={away} display={formatOpp(away)} style={{fontSize:13,fontWeight:played?(winAway?800:500):700,color:isCPU?"#aaa":played?(winAway?"#111":"#999"):"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}/>
          </div>

          {played&&<span style={{fontSize:11,color:"#ccc",flexShrink:0}}>{isOpen?"▲":"▼"}</span>}
        </div>
        {played&&isOpen&&<BoxScore teamA={home} teamB={away} result={result}/>}
      </div>
    );
  }

  // Per-team schedule with result lookup — a week with no entry for this team is an implicit bye
  function getTeamSchedule(teamName) {
    return weeks.map(w=>{
      const opp=effSchedule[w]?.[teamName]||"BYE";
      const log=resultLookup[teamName]?.[w]||null;
      return{week:w,opp,log};
    });
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {availableYears.length>1&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:0.5}}>Season:</span>
          {availableYears.map(y=>(
            <button key={y} onClick={()=>{setSelYear(y);setView("full");}} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:selYear===y?RED:"#ddd",background:selYear===y?RED:"#fff",color:selYear===y?"#fff":"#555",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff}}>{y}{y===year?" (Current)":""}</button>
          ))}
        </div>
      )}
      {!weeks.length ? (
        <Card style={{padding:20,textAlign:"center",color:"#888",fontSize:13}}>{isCurrentYear?"No schedule set up yet. Add matchups in Commissioner Mode.":`No schedule available for ${selYear}.`}</Card>
      ) : (
      <Card style={{overflow:"hidden"}}>
        <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #eee"}}>
          <button onClick={()=>setView("full")} style={{padding:"9px 16px",background:"transparent",border:"none",borderBottom:view==="full"?`3px solid ${RED}`:"3px solid transparent",color:view==="full"?"#111":"#888",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>Full Schedule</button>
          {teams.map(t=><button key={t} onClick={()=>setView(t)} style={{padding:"9px 14px",background:"transparent",border:"none",borderBottom:view===t?`3px solid ${RED}`:"3px solid transparent",color:view===t?"#111":"#888",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}><TeamLogo url={logoByTeam[t]} size={16}/>{t}</button>)}
        </div>

        {view==="full"&&(
          <div>
            {weeks.map(w=>{
              const matchups=[];
              const seen=new Set();
              Object.entries(effSchedule[w]||{}).forEach(([team,opp])=>{
                const key=[team,opp].sort().join("||");
                if(!seen.has(key)){seen.add(key);matchups.push({home:team,away:opp});}
              });
              return(
                <div key={w}>
                  <div style={{background:"#f7f7f7",padding:"7px 14px",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #eee"}}>
                    <span style={{fontSize:10,fontWeight:800,color:RED,textTransform:"uppercase",letterSpacing:1}}>{w>13?"Post-Season":`Week ${w}`}</span>
                    {isCurrentYear&&w===week&&<span style={{background:RED,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,textTransform:"uppercase",letterSpacing:0.5}}>Current</span>}
                    {isCurrentYear&&w<week&&<span style={{background:"#007a00",color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,textTransform:"uppercase",letterSpacing:0.5}}>Final</span>}
                  </div>
                  {matchups.map(({home,away},i)=>(
                    <MatchupRow key={i} home={home} away={away} w={w}/>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {view!=="full"&&(
          <div>
            <div style={{padding:"12px 14px",borderBottom:"1px solid #eee",display:"flex",alignItems:"center",gap:10}}>
              <TeamLogo url={logoByTeam[view]} size={26}/>
              <TeamNameLink name={view} style={{fontSize:16,fontWeight:900,color:"#111"}}/>
              <div style={{fontSize:11,color:"#888"}}>Season {season} Schedule</div>
            </div>
            {getTeamSchedule(view).map(({week:w,opp,log})=>{
              const gameResult = opp!=="BYE" ? getGameResult(view, opp, w) : null;
              const played = !!gameResult;
              const won = gameResult?.winner===view;
              const key=`team-${view}-${w}`;
              const isOpen=expanded[key];
              const myScore=gameResult?.scoreA??null;
              const theirScore=gameResult?.scoreB??null;
              return(
                <div key={w} style={{borderBottom:"1px solid #eee"}}>
                  <div
                    onClick={played?()=>setExpanded(p=>({...p,[key]:!p[key]})):undefined}
                    style={{display:"flex",alignItems:"center",padding:"10px 14px",gap:10,cursor:played?"pointer":"default",background:isCurrentYear&&w===week?"#fff8f8":isOpen?"#fafafa":"transparent"}}
                  >
                    <div style={{width:50,flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:isCurrentYear&&w===week?800:500,color:isCurrentYear&&w===week?RED:"#555",textAlign:"center"}}>{w>13?"Post":isCurrentYear&&w===week?<span style={{background:RED,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:10}}>NOW</span>:`Wk ${w}`}</div>
                    </div>
                    <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
                      {played&&<span style={{fontSize:10,fontWeight:800,padding:"2px 6px",borderRadius:2,background:won?"#e8f5e9":"#fff0f0",color:won?"#007a00":RED,flexShrink:0}}>{won?"W":"L"}</span>}
                      <TeamLogo url={logoByTeam[opp]} size={18}/>
                      <TeamNameLink name={opp} display={opp==="BYE"?"BYE WEEK":formatOpp(opp)} style={{fontSize:13,fontWeight:700,color:isCPUOpp(opp)||opp==="BYE"?"#aaa":"#111"}}/>
                    </div>
                    {played&&(myScore!=null||theirScore!=null)&&(
                      <div style={{fontSize:14,fontWeight:900,color:"#111",flexShrink:0}}>
                        <span style={{color:won?"#007a00":RED}}>{myScore??"-"}</span>
                        <span style={{color:"#ccc",margin:"0 4px"}}>–</span>
                        <span style={{color:!won?"#007a00":RED}}>{theirScore??"-"}</span>
                      </div>
                    )}
                    {played&&myScore==null&&theirScore==null&&<span style={{fontSize:9,fontWeight:800,color:"#007a00",textTransform:"uppercase",padding:"1px 5px",background:"#f0f8f0",borderRadius:2,flexShrink:0}}>FINAL</span>}
                    {played&&<span style={{fontSize:11,color:"#ccc",flexShrink:0}}>{isOpen?"▲":"▼"}</span>}
                  </div>
                  {played&&isOpen&&<BoxScore teamA={view} teamB={opp} result={gameResult}/>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      )}
    </div>
  );
}

// Box-score-derived stat streaks — shared between LeagueRecordBook (league-wide) and the
// player profile Streaks tab (per-user). Each predicate runs against a game that already has
// archived box score stats attached (see getUserGames / profileGames below).
const STAT_STREAK_DEFS=[
  {key:"passTD2",label:"2+ Pass TD Games",pred:g=>(g.stats.passing?.tds||0)>=2},
  {key:"pass300",label:"300+ Pass Yd Games",pred:g=>(g.stats.passing?.yds||0)>=300},
  {key:"turnoverFree",label:"Turnover-Free Games",pred:g=>(g.stats.misc?.turnovers||0)===0},
  {key:"rush100",label:"100+ Rush Yd Games",pred:g=>(g.stats.rushing?.yds||0)>=100},
  {key:"rushTD",label:"Rush TD Games",pred:g=>(g.stats.rushing?.tds||0)>=1},
  {key:"hasInt",label:"Interception Games",pred:g=>(g.stats.passing?.int||0)>=1},
  {key:"rushDefUnder100",label:"Held Opp Under 100 Rush Yds",pred:g=>(g.oppStats?.rushing?.yds??Infinity)<100},
  {key:"passDefUnder200",label:"Held Opp Under 200 Pass Yds",pred:g=>(g.oppStats?.passing?.yds??Infinity)<200},
  {key:"turnoverForced",label:"Turnover Forced",pred:g=>(g.oppStats?.misc?.turnovers||0)>=1},
];
function longestStatStreak(games,pred){
  let max=0,cur=0,startIdx=0,bestStart=0,bestEnd=0;
  games.forEach((g,i)=>{if(pred(g)){if(cur===0)startIdx=i;cur++;if(cur>max){max=cur;bestStart=startIdx;bestEnd=i;}}else cur=0;});
  if(!max)return null;
  const span=[...new Set(games.slice(bestStart,bestEnd+1).map(g=>g.year))].join("–");
  return {len:max,span,teamName:games[bestStart]?.teamName||""};
}

function LeagueRecordBook({history,currentEntries,season,year,permanentUsers,setupRows,gameArchive,playerStats}) {
  const isMobile=useIsMobile();
  const [lrYear,setLrYear]=useState(null);
  const allUsers=(permanentUsers?.length?permanentUsers.map(u=>({userId:u.id,userName:u.defaultName,teamName:(setupRows||[]).find(r=>r.userId===u.id)?.teamName||u.teamName||""})):setupRows)||[];
  if(!allUsers.length)return null;

  function getProfile(userId,fallbackUserName){
    const seasons=history.map(s=>{
      const srt=[...s.finalStandings].sort((a,b)=>calcTotal(b)-calcTotal(a));
      const entry=srt.find(t=>(userId&&t.userId===userId)||(t.userName===fallbackUserName));
      if(!entry)return null;
      const rank=srt.findIndex(t=>(userId&&t.userId===userId)||(t.userName===fallbackUserName))+1;
      const userName=entry.userName;
      const nattyWin=(entry.nattyWinner||((entry.nattyWins||0)>0))||(s.nattyWinners?.includes(entry.teamName))||(s.nattyWinner&&s.nattyWinner.split(", ").includes(entry.teamName));
      const confChamp=(entry.confChampion||((entry.confChampWins||0)>0))||(s.confWinners?.includes(entry.teamName))||(s.confChampion&&s.confChampion.split(", ").includes(entry.teamName))||s.confChampion===entry.teamName||s.confChampion===userName;
      return{year:s.year,seasonNum:s.seasonNum,rank,total:calcTotal(entry),wins:entry.wins,losses:entry.losses,teamName:entry.teamName,userName,champion:s.champion===userName,confChamp,confChampWins:entry.confChampWins||0,confChampLosses:entry.confChampLosses||0,nattyWin,nattyWins:entry.nattyWins||0,nattyLosses:entry.nattyLosses||0,weekLog:entry.weekLog||[],gamePts:entry.gamePts||0,h2h:entry.h2h||{},playoffWins:entry.playoffWins||0,playoffLosses:entry.playoffLosses||0,bowlResult:entry.bowlResult||"none",bowlWins:entry.bowlWins,bowlLosses:entry.bowlLosses,top25Wins:entry.top25Wins||0,top10Wins:entry.top10Wins||0,isHistorical:s.isHistorical||false,confChampPts:entry.confChampPts||0};
    }).filter(Boolean);
    const cur=currentEntries.find(e=>(userId&&e.userId===userId)||(e.userName===fallbackUserName));
    const totalWins=seasons.reduce((a,s)=>a+s.wins,0)+(cur?.wins||0);
    const totalLosses=seasons.reduce((a,s)=>a+s.losses,0)+(cur?.losses||0);
    const totalPts=seasons.reduce((a,s)=>a+s.total,0)+(cur?calcTotal(cur):0);
    const championships=seasons.filter(s=>s.champion).length;
    const winPct=totalWins+totalLosses>0?((totalWins/(totalWins+totalLosses))*100).toFixed(1):0;
    const careerPlayoffWins=seasons.reduce((a,s)=>a+(s.playoffWins||0),0);
    const careerPlayoffLosses=seasons.reduce((a,s)=>a+(s.playoffLosses||0),0);
    const bowlWins=seasons.reduce((a,s)=>a+(s.bowlWins!=null?s.bowlWins:(s.bowlResult==="win"?1:0)),0);
    const bowlLosses=seasons.reduce((a,s)=>a+(s.bowlLosses!=null?s.bowlLosses:(s.bowlResult==="loss"?1:0)),0);
    const allWeekLogs=[...seasons.flatMap(s=>s.weekLog||[]),(cur?.weekLog||[])].flat();
    const rankedWins=allWeekLogs.filter(w=>w.result==="win"&&(w.ranked25||w.ranked10)).length;
    const h2hMerged={};
    [...seasons.map(s=>s.h2h||{}),(cur?.h2h||{})].forEach(h2h=>{Object.entries(h2h).forEach(([opp,rec])=>{if(!h2hMerged[opp])h2hMerged[opp]={wins:0,losses:0};h2hMerged[opp].wins+=(rec.wins||0);h2hMerged[opp].losses+=(rec.losses||0);});});
    return{seasons,cur,totalWins,totalLosses,totalPts,championships,winPct,careerPlayoffWins,careerPlayoffLosses,bowlWins,bowlLosses,rankedWins,h2hMerged};
  }

  function getLR(filterYear=null){
    const recs={};
    const displayToId={};
    allUsers.forEach(u=>{try{const curEntry=currentEntries.find(e=>u.userId?e.userId===u.userId:e.userName===u.userName);const displayName=curEntry?.userName||u.userName;recs[displayName]=getProfile(u.userId||null,u.userName);displayToId[displayName]=u.userId||null;}catch{}});
    const e=Object.entries(recs).filter(([,p])=>p);
    if(!e.length)return{};
    // Career passing totals pulled from playerStats (season-by-season box score aggregates), summed
    // across all years or narrowed to filterYear when a single season is selected.
    const getPassingTotals=(userId)=>{
      const stats=playerStats?.[userId]||{};
      const yearsToSum=filterYear!=null?[filterYear]:Object.keys(stats).map(Number);
      return yearsToSum.reduce((acc,y)=>{const p=stats[y]?.passing;if(!p)return acc;return{att:acc.att+(p.att||0),comp:acc.comp+(p.comp||0),tds:acc.tds+(p.tds||0),int:acc.int+(p.int||0),yds:acc.yds+(p.yds||0)};},{att:0,comp:0,tds:0,int:0,yds:0});
    };
    const passingEntries=e.map(([name])=>[name,getPassingTotals(displayToId[name])]);
    const mostPassAtt=[...passingEntries].sort((a,b)=>b[1].att-a[1].att)[0];
    const mostPassComp=[...passingEntries].sort((a,b)=>b[1].comp-a[1].comp)[0];
    const mostPassTD=[...passingEntries].sort((a,b)=>b[1].tds-a[1].tds)[0];
    const mostInt=[...passingEntries].sort((a,b)=>b[1].int-a[1].int)[0];
    const bestCompPct=[...passingEntries].filter(([,t])=>t.att>0).sort((a,b)=>(b[1].comp/b[1].att)-(a[1].comp/a[1].att))[0];
    const bestYPC=[...passingEntries].filter(([,t])=>t.comp>0).sort((a,b)=>(b[1].yds/b[1].comp)-(a[1].yds/a[1].comp))[0];
    // Career rushing totals pulled from playerStats the same way as passing totals above.
    const getRushingTotals=(userId)=>{
      const stats=playerStats?.[userId]||{};
      const yearsToSum=filterYear!=null?[filterYear]:Object.keys(stats).map(Number);
      return yearsToSum.reduce((acc,y)=>{const r=stats[y]?.rushing;if(!r)return acc;return{att:acc.att+(r.att||0),yds:acc.yds+(r.yds||0),tds:acc.tds+(r.tds||0)};},{att:0,yds:0,tds:0});
    };
    const rushingEntries=e.map(([name])=>[name,getRushingTotals(displayToId[name])]);
    const mostRushAtt=[...rushingEntries].sort((a,b)=>b[1].att-a[1].att)[0];
    const mostRushYds=[...rushingEntries].sort((a,b)=>b[1].yds-a[1].yds)[0];
    const mostRushTD=[...rushingEntries].sort((a,b)=>b[1].tds-a[1].tds)[0];
    const bestYPCarry=[...rushingEntries].filter(([,t])=>t.att>0).sort((a,b)=>(b[1].yds/b[1].att)-(a[1].yds/a[1].att))[0];
    // Single-season passing/rushing records: same fields as the career versions above, but each
    // (user, year) pair from playerStats is its own entry instead of being summed across years.
    const singleSeasonPassing=[], singleSeasonRushing=[];
    e.forEach(([name])=>{
      const stats=playerStats?.[displayToId[name]]||{};
      Object.keys(stats).map(Number).filter(y=>filterYear==null||y===filterYear).forEach(y=>{
        if(stats[y]?.passing)singleSeasonPassing.push({name,year:y,...stats[y].passing});
        if(stats[y]?.rushing)singleSeasonRushing.push({name,year:y,...stats[y].rushing});
      });
    });
    const ssMostPassAtt=[...singleSeasonPassing].sort((a,b)=>b.att-a.att)[0];
    const ssMostPassComp=[...singleSeasonPassing].sort((a,b)=>b.comp-a.comp)[0];
    const ssMostPassTD=[...singleSeasonPassing].sort((a,b)=>b.tds-a.tds)[0];
    const ssMostInt=[...singleSeasonPassing].sort((a,b)=>b.int-a.int)[0];
    const ssBestCompPct=[...singleSeasonPassing].filter(p=>p.att>0).sort((a,b)=>(b.comp/b.att)-(a.comp/a.att))[0];
    const ssBestYPC=[...singleSeasonPassing].filter(p=>p.comp>0).sort((a,b)=>(b.yds/b.comp)-(a.yds/a.comp))[0];
    const ssMostRushAtt=[...singleSeasonRushing].sort((a,b)=>b.att-a.att)[0];
    const ssMostRushYds=[...singleSeasonRushing].sort((a,b)=>b.yds-a.yds)[0];
    const ssMostRushTD=[...singleSeasonRushing].sort((a,b)=>b.tds-a.tds)[0];
    const ssBestYPCarry=[...singleSeasonRushing].filter(r=>r.att>0).sort((a,b)=>(b.yds/b.att)-(a.yds/a.att))[0];
    // Single-season 4th quarter comeback wins, counted per (user, year) directly off the archive.
    const idToDisplay={};
    Object.entries(displayToId).forEach(([name,id])=>{if(id)idToDisplay[id]=name;});
    const seasonComebacks={};
    (gameArchive||[]).filter(g=>filterYear==null||g.year===filterYear).forEach(g=>{
      [[g.team1,g.team2],[g.team2,g.team1]].forEach(([team,opp])=>{
        const name=idToDisplay[team.userId];
        if(!name)return;
        const tq=team.quarters||[], oq=opp.quarters||[];
        if(tq.length<4||oq.length<4)return;
        const teamWon=(team.score||0)>(opp.score||0);
        const q4Deficit=(oq[0]+oq[1]+oq[2])-(tq[0]+tq[1]+tq[2]);
        if(teamWon&&q4Deficit>0){
          const key=`${name}|${g.year}`;
          seasonComebacks[key]=(seasonComebacks[key]||0)+1;
        }
      });
    });
    let ssMost4thQComebacks=null;
    Object.entries(seasonComebacks).forEach(([key,n])=>{
      const [name,yr]=key.split("|");
      if(!ssMost4thQComebacks||n>ssMost4thQComebacks.n)ssMost4thQComebacks={name,year:Number(yr),n};
    });
    const getUserLogs=(name)=>{const prof=recs[name];if(!prof)return[];const logs=[];prof.seasons.filter(s=>!s.isHistorical&&(filterYear==null||s.year===filterYear)).forEach(s=>{(s.weekLog||[]).forEach(w=>logs.push({...w,season:s.seasonNum,year:s.year,teamName:s.teamName}));});if(!filterYear&&prof.cur)(prof.cur.weekLog||[]).forEach(w=>logs.push({...w,season,year,teamName:prof.cur.teamName}));return logs;};
    // Join each weekLog entry with its archived box score (if one was scanned) so stat-based
    // streaks (pass yards, rush TDs, turnovers, etc.) have something to test.
    const getUserGames=(name)=>getUserLogs(name).map(w=>{
      const archivedGame=(gameArchive||[]).find(g=>g.year===w.year&&g.week===w.week&&(g.team1.name===w.teamName||g.team2.name===w.teamName));
      if(!archivedGame)return null;
      const isTeam1=archivedGame.team1.name===w.teamName;
      const stats=isTeam1?archivedGame.team1:archivedGame.team2;
      const oppStats=isTeam1?archivedGame.team2:archivedGame.team1;
      return{...w,stats,oppStats};
    }).filter(Boolean);
    const statStreaks={};
    STAT_STREAK_DEFS.forEach(def=>{
      let best=null;
      e.forEach(([name])=>{const s=longestStatStreak(getUserGames(name),def.pred);if(s&&(!best||s.len>best.data.len))best={name,data:s};});
      statStreaks[def.key]=best;
    });
    const getWinStreakAllTime=(name)=>{const logs=getUserLogs(name);let max=0,cur=0,startIdx=0,bestStart=0,bestEnd=0;logs.forEach((w,i)=>{if(w.result==="win"){if(cur===0)startIdx=i;cur++;if(cur>max){max=cur;bestStart=startIdx;bestEnd=i;}}else cur=0;});if(!max)return null;const span=[...new Set(logs.slice(bestStart,bestEnd+1).map(w=>w.year))];return{len:max,years:span.join("–"),teamName:logs[bestStart]?.teamName||""};};
    const getWinStreakSeason=(name)=>{const prof=recs[name];if(!prof)return null;let best=null;const allS=[...prof.seasons.filter(s=>!s.isHistorical&&(filterYear==null||s.year===filterYear))];if(!filterYear&&prof.cur)allS.push({...prof.cur,year,seasonNum:season,isHistorical:false});allS.forEach(s=>{let cur=0,max=0;(s.weekLog||[]).forEach(w=>{if(w.result==="win"){cur++;if(cur>max)max=cur;}else cur=0;});if(max>0&&(!best||max>best.len))best={len:max,year:s.year,teamName:s.teamName};});return best;};
    const isUvU=(w)=>w.opponent&&!isCPUOpp(w.opponent)&&w.opponent!=="BYE"&&w.opponent!=="Unknown"&&w.opponent!=="";
    let bestSeason=null,worstSeason=null,mostSeasonLosses=null;
    e.forEach(([name,prof])=>{const allS=[...prof.seasons.filter(s=>!s.isHistorical&&(filterYear==null||s.year===filterYear))];if(!filterYear&&prof.cur)allS.push({...prof.cur,year,seasonNum:season,isHistorical:false});allS.forEach(s=>{const uvuW=(s.weekLog||[]).filter(w=>isUvU(w)&&w.result==="win").length;const uvuL=(s.weekLog||[]).filter(w=>isUvU(w)&&w.result==="loss").length;if(uvuW+uvuL===0)return;const pct=uvuW/(uvuW+uvuL);if(!bestSeason||pct>bestSeason.pct||(pct===bestSeason.pct&&uvuW>bestSeason.w))bestSeason={name,w:uvuW,l:uvuL,pct,year:s.year,teamName:s.teamName};if(!worstSeason||pct<worstSeason.pct||(pct===worstSeason.pct&&uvuL>worstSeason.l))worstSeason={name,w:uvuW,l:uvuL,pct,year:s.year,teamName:s.teamName};const totL=(s.weekLog||[]).filter(w=>w.result==="loss").length;if(!mostSeasonLosses||totL>mostSeasonLosses.l)mostSeasonLosses={name,l:totL,year:s.year,teamName:s.teamName};});});
    // Built from getUserLogs (already year-filtered) rather than prof.h2hMerged, which is an
    // all-time aggregate computed once in getProfile() and would ignore the year filter entirely.
    let mostH2HWins=null;e.forEach(([name])=>{const byOpp={};getUserLogs(name).filter(isUvU).forEach(w=>{if(w.result==="win")byOpp[w.opponent]=(byOpp[w.opponent]||0)+1;});Object.entries(byOpp).forEach(([opp,wins])=>{if(!mostH2HWins||wins>mostH2HWins.wins)mostH2HWins={name,opp,wins};});});
    let longestH2HStreak=null;e.forEach(([name])=>{const logs=getUserLogs(name);const opponents=[...new Set(logs.filter(isUvU).map(w=>w.opponent))];opponents.forEach(opp=>{const oppLogs=logs.filter(w=>w.opponent===opp);let cur=0,max=0;oppLogs.forEach(w=>{if(w.result==="win"){cur++;if(cur>max)max=cur;}else cur=0;});if(max>0&&(!longestH2HStreak||max>longestH2HStreak.len))longestH2HStreak={name,opp,len:max};});});
    let mostConfApp=null,mostNattyApp=null;e.forEach(([name,prof])=>{const filteredS=prof.seasons.filter(s=>filterYear==null||s.year===filterYear);const confApps=filteredS.reduce((a,s)=>{const games=(s.confChampWins||0)+(s.confChampLosses||0);return a+(games>0?games:(s.confChamp||s.confChampPts>0?1:0));},0);const nattyApps=filteredS.reduce((a,s)=>{const games=Math.min((s.nattyWins||0)+(s.nattyLosses||0),5);return a+(games>0?games:(s.nattyWin?1:0));},0);if(!mostConfApp||confApps>mostConfApp.n)mostConfApp={name,n:confApps};if(!mostNattyApp||nattyApps>mostNattyApp.n)mostNattyApp={name,n:nattyApps};});
    const streakAllTime={},streakSeason={};e.forEach(([name])=>{streakAllTime[name]=getWinStreakAllTime(name);streakSeason[name]=getWinStreakSeason(name);});
    const bestStreakAllTime=[...e].map(([name])=>({name,data:streakAllTime[name]})).filter(x=>x.data).sort((a,b)=>b.data.len-a.data.len)[0];
    const bestStreakSeason=[...e].map(([name])=>({name,data:streakSeason[name]})).filter(x=>x.data).sort((a,b)=>b.data.len-a.data.len)[0];
    const getYearStats=(prof)=>{if(!filterYear)return prof;const s=prof.seasons.find(s=>s.year===filterYear);const w=(s?.weekLog||[]);return{totalWins:s?.wins||0,totalLosses:s?.losses||0,totalPts:s?.total||0,championships:s?.champion?1:0,winPct:(s&&(s.wins+s.losses)>0)?((s.wins/(s.wins+s.losses))*100).toFixed(1):"0",bowlWins:s?(s.bowlWins!=null?s.bowlWins:(s.bowlResult==="win"?1:0)):0,careerPlayoffWins:s?.playoffWins||0,careerPlayoffLosses:s?.playoffLosses||0,rankedWins:w.filter(wk=>wk.result==="win"&&(wk.ranked25||wk.ranked10)).length};};
    const eys=e.map(([name,prof])=>[name,getYearStats(prof)]);
    return{mostWins:[...eys].sort((a,b)=>b[1].totalWins-a[1].totalWins)[0],mostLosses:[...eys].sort((a,b)=>b[1].totalLosses-a[1].totalLosses)[0],mostPts:[...eys].sort((a,b)=>b[1].totalPts-a[1].totalPts)[0],mostChamps:[...eys].sort((a,b)=>b[1].championships-a[1].championships)[0],bestWinPct:[...eys].filter(([,p])=>p.totalWins+p.totalLosses>0).sort((a,b)=>parseFloat(b[1].winPct)-parseFloat(a[1].winPct))[0],mostBowlWins:[...eys].sort((a,b)=>b[1].bowlWins-a[1].bowlWins)[0],mostPlayoffApp:[...eys].sort((a,b)=>(b[1].careerPlayoffWins+b[1].careerPlayoffLosses)-(a[1].careerPlayoffWins+a[1].careerPlayoffLosses))[0],mostRW:[...eys].sort((a,b)=>b[1].rankedWins-a[1].rankedWins)[0],mostConfApp,mostNattyApp,bestSeason,worstSeason,mostSeasonLosses,mostH2HWins,longestH2HStreak,bestStreakAllTime,bestStreakSeason,statStreaks,mostPassAtt,mostPassComp,mostPassTD,mostInt,bestCompPct,bestYPC,mostRushAtt,mostRushYds,mostRushTD,bestYPCarry,ssMostPassAtt,ssMostPassComp,ssMostPassTD,ssMostInt,ssBestCompPct,ssBestYPC,ssMostRushAtt,ssMostRushYds,ssMostRushTD,ssBestYPCarry,ssMost4thQComebacks};
  }

  const lr=getLR(lrYear);
  if(!Object.keys(lr).length)return null;
  const RR=({label,holder,val,sub})=>{const u=allUsers.find(u=>u.userName===holder);return(<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f0f0f0"}}><span style={{fontSize:12,color:"#555",flex:1}}>{label}</span><div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:13,color:"#111",fontWeight:700}}><Name userId={u?.userId} userName={holder}>{holder}</Name></div><div style={{fontSize:11,color:RED,fontWeight:700}}>{val}</div>{sub&&<div style={{fontSize:10,color:"#aaa"}}>{sub}</div>}</div></div>);};
  return(
    <Card style={{overflow:"hidden"}}><CardHead bg="#111">📖 League Record Book</CardHead>
      <div style={{padding:"10px 14px 4px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderBottom:"1px solid #f0f0f0"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:0.5}}>Filter:</span>
        {[null,...[...new Set(history.map(s=>s.year))].sort((a,b)=>b-a)].map(y=>(
          <button key={y??'all'} onClick={()=>setLrYear(y)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:lrYear===y?RED:"#ddd",background:lrYear===y?RED:"#fff",color:lrYear===y?"#fff":"#555",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>{y==null?"All Time":y}</button>
        ))}
      </div>
      <div style={{padding:"4px 14px 6px",fontSize:10,color:"#aaa",fontStyle:"italic",borderBottom:"1px solid #f5f5f5"}}>Rivalry and game records are user vs user matchups only. Win streaks count all games.</div>
      <div style={{padding:"4px 14px 10px",display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?"0":"0 24px"}}>
        <div style={{gridColumn:"1/-1",padding:"6px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>CAREER RECORDS</div>
        {lr.mostWins&&<RR label="Most Wins" holder={lr.mostWins[0]} val={lr.mostWins[1].totalWins+"W"}/>}
        {lr.mostLosses&&<RR label="Most Losses" holder={lr.mostLosses[0]} val={lr.mostLosses[1].totalLosses+"L"}/>}
        {lr.mostPts&&<RR label="Most Pts" holder={lr.mostPts[0]} val={String(lr.mostPts[1].totalPts)}/>}
        {lr.mostChamps&&<RR label="Most Titles" holder={lr.mostChamps[0]} val={lr.mostChamps[1].championships+"×"}/>}
        {lr.bestWinPct&&<RR label="Best Win%" holder={lr.bestWinPct[0]} val={lr.bestWinPct[1].winPct+"%"}/>}
        {lr.mostRW&&<RR label="Most Ranked Wins" holder={lr.mostRW[0]} val={lr.mostRW[1].rankedWins+"W"}/>}
        {lr.mostBowlWins&&lr.mostBowlWins[1].bowlWins>0&&<RR label="Most Bowl Wins" holder={lr.mostBowlWins[0]} val={lr.mostBowlWins[1].bowlWins+"W"}/>}
        {lr.mostPlayoffApp&&(lr.mostPlayoffApp[1].careerPlayoffWins+lr.mostPlayoffApp[1].careerPlayoffLosses)>0&&<RR label="Most Playoff Games" holder={lr.mostPlayoffApp[0]} val={(lr.mostPlayoffApp[1].careerPlayoffWins+lr.mostPlayoffApp[1].careerPlayoffLosses)+"×"}/>}
        {lr.mostConfApp?.n>0&&<RR label="Most Conf Champ Apps" holder={lr.mostConfApp.name} val={lr.mostConfApp.n+"×"}/>}
        {lr.mostNattyApp?.n>0&&<RR label="Most Natty Apps" holder={lr.mostNattyApp.name} val={lr.mostNattyApp.n+"×"}/>}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>PASSING RECORDS</div>
        {lr.mostPassAtt&&lr.mostPassAtt[1].att>0&&<RR label="Pass Attempts" holder={lr.mostPassAtt[0]} val={lr.mostPassAtt[1].att+" ATT"}/>}
        {lr.mostPassComp&&lr.mostPassComp[1].comp>0&&<RR label="Pass Completions" holder={lr.mostPassComp[0]} val={lr.mostPassComp[1].comp+" COMP"}/>}
        {lr.bestCompPct&&<RR label="Completion Percentage" holder={lr.bestCompPct[0]} val={((lr.bestCompPct[1].comp/lr.bestCompPct[1].att)*100).toFixed(1)+"%"}/>}
        {lr.mostPassTD&&lr.mostPassTD[1].tds>0&&<RR label="Passing Touchdowns" holder={lr.mostPassTD[0]} val={lr.mostPassTD[1].tds+" TD"}/>}
        {lr.mostInt&&lr.mostInt[1].int>0&&<RR label="Interceptions" holder={lr.mostInt[0]} val={lr.mostInt[1].int+" INT"}/>}
        {lr.bestYPC&&<RR label="Yards Per Completion" holder={lr.bestYPC[0]} val={(lr.bestYPC[1].yds/lr.bestYPC[1].comp).toFixed(1)}/>}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>RUSHING RECORDS</div>
        {lr.mostRushAtt&&lr.mostRushAtt[1].att>0&&<RR label="Rushing Attempts" holder={lr.mostRushAtt[0]} val={lr.mostRushAtt[1].att+" ATT"}/>}
        {lr.mostRushYds&&lr.mostRushYds[1].yds>0&&<RR label="Rushing Yards" holder={lr.mostRushYds[0]} val={lr.mostRushYds[1].yds.toLocaleString()+" YDS"}/>}
        {lr.mostRushTD&&lr.mostRushTD[1].tds>0&&<RR label="Rushing Touchdowns" holder={lr.mostRushTD[0]} val={lr.mostRushTD[1].tds+" TD"}/>}
        {lr.bestYPCarry&&<RR label="Yards Per Carry" holder={lr.bestYPCarry[0]} val={(lr.bestYPCarry[1].yds/lr.bestYPCarry[1].att).toFixed(1)}/>}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>SINGLE SEASON RECORDS</div>
        {lr.bestSeason&&<RR label="Best Season (UvU)" holder={lr.bestSeason.name} val={`${lr.bestSeason.w}W-${lr.bestSeason.l}L`} sub={`${lr.bestSeason.teamName} · ${lr.bestSeason.year}`}/>}
        {lr.worstSeason&&<RR label="Worst Season (UvU)" holder={lr.worstSeason.name} val={`${lr.worstSeason.w}W-${lr.worstSeason.l}L`} sub={`${lr.worstSeason.teamName} · ${lr.worstSeason.year}`}/>}
        {lr.mostSeasonLosses&&lr.mostSeasonLosses.l>0&&<RR label="Most Losses in a Season" holder={lr.mostSeasonLosses.name} val={lr.mostSeasonLosses.l+"L"} sub={`${lr.mostSeasonLosses.teamName} · ${lr.mostSeasonLosses.year}`}/>}
        {lr.ssMostPassAtt&&lr.ssMostPassAtt.att>0&&<RR label="Pass Attempts (Season)" holder={lr.ssMostPassAtt.name} val={lr.ssMostPassAtt.att+" ATT"} sub={String(lr.ssMostPassAtt.year)}/>}
        {lr.ssMostPassComp&&lr.ssMostPassComp.comp>0&&<RR label="Pass Completions (Season)" holder={lr.ssMostPassComp.name} val={lr.ssMostPassComp.comp+" COMP"} sub={String(lr.ssMostPassComp.year)}/>}
        {lr.ssBestCompPct&&<RR label="Completion Percentage (Season)" holder={lr.ssBestCompPct.name} val={((lr.ssBestCompPct.comp/lr.ssBestCompPct.att)*100).toFixed(1)+"%"} sub={String(lr.ssBestCompPct.year)}/>}
        {lr.ssMostPassTD&&lr.ssMostPassTD.tds>0&&<RR label="Passing Touchdowns (Season)" holder={lr.ssMostPassTD.name} val={lr.ssMostPassTD.tds+" TD"} sub={String(lr.ssMostPassTD.year)}/>}
        {lr.ssMostInt&&lr.ssMostInt.int>0&&<RR label="Interceptions (Season)" holder={lr.ssMostInt.name} val={lr.ssMostInt.int+" INT"} sub={String(lr.ssMostInt.year)}/>}
        {lr.ssBestYPC&&<RR label="Yards Per Completion (Season)" holder={lr.ssBestYPC.name} val={(lr.ssBestYPC.yds/lr.ssBestYPC.comp).toFixed(1)} sub={String(lr.ssBestYPC.year)}/>}
        {lr.ssMostRushAtt&&lr.ssMostRushAtt.att>0&&<RR label="Rushing Attempts (Season)" holder={lr.ssMostRushAtt.name} val={lr.ssMostRushAtt.att+" ATT"} sub={String(lr.ssMostRushAtt.year)}/>}
        {lr.ssMostRushYds&&lr.ssMostRushYds.yds>0&&<RR label="Rushing Yards (Season)" holder={lr.ssMostRushYds.name} val={lr.ssMostRushYds.yds.toLocaleString()+" YDS"} sub={String(lr.ssMostRushYds.year)}/>}
        {lr.ssMostRushTD&&lr.ssMostRushTD.tds>0&&<RR label="Rushing Touchdowns (Season)" holder={lr.ssMostRushTD.name} val={lr.ssMostRushTD.tds+" TD"} sub={String(lr.ssMostRushTD.year)}/>}
        {lr.ssBestYPCarry&&<RR label="Yards Per Carry (Season)" holder={lr.ssBestYPCarry.name} val={(lr.ssBestYPCarry.yds/lr.ssBestYPCarry.att).toFixed(1)} sub={String(lr.ssBestYPCarry.year)}/>}
        {lr.ssMost4thQComebacks&&<RR label="4th Quarter Comebacks (Season)" holder={lr.ssMost4thQComebacks.name} val={lr.ssMost4thQComebacks.n+"×"} sub={String(lr.ssMost4thQComebacks.year)}/>}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>WIN STREAKS</div>
        {lr.bestStreakAllTime&&<RR label="Longest Win Streak All Time" holder={lr.bestStreakAllTime.name} val={lr.bestStreakAllTime.data.len+"G"} sub={lr.bestStreakAllTime.data.years?`${lr.bestStreakAllTime.data.teamName} · ${lr.bestStreakAllTime.data.years}`:""}/>}
        {lr.bestStreakSeason&&<RR label="Longest Win Streak (Season)" holder={lr.bestStreakSeason.name} val={lr.bestStreakSeason.data.len+"G"} sub={`${lr.bestStreakSeason.data.teamName} · ${lr.bestStreakSeason.data.year}`}/>}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>STAT STREAKS</div>
        {STAT_STREAK_DEFS.map(def=>{const s=lr.statStreaks?.[def.key];return s&&<RR key={def.key} label={`Longest ${def.label} Streak`} holder={s.name} val={s.data.len+"G"} sub={s.data.span?`${s.data.teamName} · ${s.data.span}`:""}/>;})}
        <div style={{gridColumn:"1/-1",padding:"10px 0 2px",fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid #f0f0f0",marginBottom:2}}>RIVALRY RECORDS (UvU)</div>
        {lr.mostH2HWins&&lr.mostH2HWins.wins>0&&<RR label="Most Wins vs Single Opponent" holder={lr.mostH2HWins.name} val={lr.mostH2HWins.wins+"W"} sub={`vs ${lr.mostH2HWins.opp}`}/>}
        {lr.longestH2HStreak&&lr.longestH2HStreak.len>0&&<RR label="Longest Streak vs Opponent" holder={lr.longestH2HStreak.name} val={lr.longestH2HStreak.len+"W"} sub={`vs ${lr.longestH2HStreak.opp}`}/>}
      </div>
    </Card>
  );
}

// ── Year Stats ────────────────────────────────────────────────────────────
// Career > Year > Season(s) in that year. A single year can hold more than one finalized
// season if the commissioner advances seasonNum without bumping the year, so the year picker
// and season picker are two separate, nested controls.
function YearStatsTab({history,currentEntries,season,year,setupRows,permanentUsers,playerStats,gameArchive}) {
  const isMobile=useIsMobile();
  // Merge permanentUsers with setupRows the same way ProfileTab does — a plain fallback
  // (permanentUsers only, when non-empty) silently dropped any coach who's in setupRows but
  // not yet a permanentUser, making them vanish from every leaderboard on this page.
  const puList=(permanentUsers||[]).map(u=>({userId:u.id,userName:u.defaultName,teamName:(setupRows||[]).find(r=>r.userId===u.id)?.teamName||u.teamName||""}));
  const puIds=new Set(puList.map(u=>u.userId));
  const extraRows=(setupRows||[]).filter(r=>r.userId&&!puIds.has(r.userId)).map(r=>({userId:r.userId,userName:r.userName,teamName:r.teamName}));
  const allUsers=[...puList,...extraRows].filter(u=>u.userName);
  const allYears=[...new Set([...history.map(s=>s.year),year])].sort((a,b)=>b-a);
  const [selYear,setSelYear]=useState(year);
  const [selSeasonKey,setSelSeasonKey]=useState(null);
  const [expanded,setExpanded]=useState({});
  const finalizedSeasons=history.filter(s=>s.year===selYear).sort((a,b)=>(a.seasonNum||0)-(b.seasonNum||0));
  const hasCurrent=selYear===year;
  const seasonTabs=[...finalizedSeasons.map(s=>({key:`s${s.seasonNum}`,label:`Season ${s.seasonNum}`})),...(hasCurrent?[{key:"current",label:`Season ${season} (Current)`}]:[])];
  useEffect(()=>{
    const defaultKey=hasCurrent?"current":(finalizedSeasons.length?`s${finalizedSeasons[finalizedSeasons.length-1].seasonNum}`:null);
    setSelSeasonKey(defaultKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selYear]);
  if(!allUsers.length)return null;
  const activeKey=selSeasonKey??(hasCurrent?"current":(finalizedSeasons.length?`s${finalizedSeasons[finalizedSeasons.length-1].seasonNum}`:null));
  // Stat leaders come from playerStats, which is only bucketed by year (not by seasonNum) since
  // box scores are matched by year+week — so leaders below reflect the whole year, not just the
  // season selected above.
  const leaders=allUsers.map(u=>{
    const curEntry=(currentEntries||[]).find(e=>u.userId?e.userId===u.userId:e.userName===u.userName);
    const displayName=curEntry?.userName||u.userName;
    const stats=playerStats?.[u.userId]?.[selYear]||EMPTY_STATS();
    const qs=computeQuarterStats(gameArchive,u.userId,selYear);
    return{userId:u.userId,name:displayName,passing:stats.passing,rushing:stats.rushing,team:stats.team,qs};
  });
  const hasTeamGames=l=>(l.team?.games||0)>0;
  const LeaderList=({title,valFn,suffix="",asc=false,filterFn,renderVal})=>{
    const ff2=filterFn||(l=>valFn(l)>0);
    const all=[...leaders].filter(ff2).sort((a,b)=>asc?valFn(a)-valFn(b):valFn(b)-valFn(a));
    if(!all.length)return null;
    const isOpen=!!expanded[title];
    const rows=isOpen?all:all.slice(0,5);
    return(<Card><CardHead bg="#333">{title}</CardHead><div style={{padding:"4px 0"}}>
      {rows.map((l,i)=><div key={l.userId||l.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}>
        <span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. <Name userId={l.userId} userName={l.name}>{l.name}</Name></span>
        <span style={{fontSize:13,fontWeight:800,color:RED}}>{renderVal?renderVal(l):valFn(l).toLocaleString()+suffix}</span>
      </div>)}
      {all.length>5&&<button onClick={()=>setExpanded(prev=>({...prev,[title]:!prev[title]}))} style={{width:"100%",padding:"8px",background:"none",border:"none",borderTop:"1px solid #f0f0f0",color:RED,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5}}>{isOpen?"Show Less ▲":`Show All (${all.length}) ▼`}</button>}
    </div></Card>);
  };
  const SectionLabel=({children})=><div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:1,padding:"2px 4px"}}>{children}</div>;
  const leaderGrid={display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr 1fr",gap:14};
  const qRows=leaders.filter(l=>(l.qs?.qGames||0)>0).sort((a,b)=>a.name.localeCompare(b.name));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Card style={{overflow:"hidden"}}>
        <CardHead bg="#111">📅 Year Stats</CardHead>
        <div style={{padding:"10px 14px 4px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderBottom:"1px solid #f0f0f0"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:0.5}}>Year:</span>
          {allYears.map(y=>(
            <button key={y} onClick={()=>setSelYear(y)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:selYear===y?RED:"#ddd",background:selYear===y?RED:"#fff",color:selYear===y?"#fff":"#555",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>{y}</button>
          ))}
        </div>
        {seasonTabs.length>0&&<div style={{padding:"8px 14px 10px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:0.5}}>Season:</span>
          {seasonTabs.map(s=>(
            <button key={s.key} onClick={()=>setSelSeasonKey(s.key)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:activeKey===s.key?"#1a3a6b":"#ddd",background:activeKey===s.key?"#1a3a6b":"#fff",color:activeKey===s.key?"#fff":"#555",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>{s.label}</button>
          ))}
        </div>}
      </Card>
      <div style={{fontSize:10,color:"#aaa",fontStyle:"italic",padding:"0 4px"}}>Stats below are tracked per year (not split further by season if a year has more than one).</div>

      <SectionLabel>Passing</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="Passing Yards" valFn={l=>l.passing?.yds||0}/>
        <LeaderList title="Passing TDs" valFn={l=>l.passing?.tds||0}/>
        <LeaderList title="Interceptions Thrown" valFn={l=>l.passing?.int||0}/>
      </div>

      <SectionLabel>Rushing</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="Rushing Yards" valFn={l=>l.rushing?.yds||0}/>
        <LeaderList title="Rushing TDs" valFn={l=>l.rushing?.tds||0}/>
      </div>

      <SectionLabel>Scoring & Yards</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="Off Pts/Game" valFn={l=>l.team.offPts/l.team.games} filterFn={hasTeamGames} renderVal={l=>(l.team.offPts/l.team.games).toFixed(1)}/>
        <LeaderList title="Def Pts/Game (Best)" valFn={l=>l.team.defPts/l.team.games} filterFn={hasTeamGames} asc renderVal={l=>(l.team.defPts/l.team.games).toFixed(1)}/>
        <LeaderList title="Offensive Yards" valFn={l=>l.team?.offYds||0} filterFn={hasTeamGames}/>
        <LeaderList title="Defensive Yards (Best)" valFn={l=>l.team?.defYds||0} filterFn={hasTeamGames} asc/>
      </div>

      <SectionLabel>Efficiency</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="3rd Down %" valFn={l=>(l.team.thirdConv/l.team.thirdAtt)*100} filterFn={l=>(l.team?.thirdAtt||0)>0} renderVal={l=>((l.team.thirdConv/l.team.thirdAtt)*100).toFixed(1)+"%"}/>
        <LeaderList title="4th Down Attempts" valFn={l=>l.team?.fourthAtt||0} filterFn={hasTeamGames}/>
        <LeaderList title="4th Down Conversion %" valFn={l=>(l.team.fourthConv/l.team.fourthAtt)*100} filterFn={l=>(l.team?.fourthAtt||0)>0} renderVal={l=>((l.team.fourthConv/l.team.fourthAtt)*100).toFixed(1)+"%"}/>
        <LeaderList title="2 Point Attempts" valFn={l=>l.team?.twoPtAtt||0} filterFn={hasTeamGames}/>
        <LeaderList title="2 Point Conversion %" valFn={l=>(l.team.twoPtConv/l.team.twoPtAtt)*100} filterFn={l=>(l.team?.twoPtAtt||0)>0} renderVal={l=>((l.team.twoPtConv/l.team.twoPtAtt)*100).toFixed(1)+"%"}/>
      </div>

      <SectionLabel>Turnovers</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="Takeaways" valFn={l=>l.team?.takeaways||0} filterFn={hasTeamGames}/>
        <LeaderList title="Giveaways (Fewest)" valFn={l=>l.team?.giveaways||0} filterFn={hasTeamGames} asc/>
        <LeaderList title="Turnover Differential" valFn={l=>l.team.takeaways-l.team.giveaways} filterFn={hasTeamGames} renderVal={l=>{const d=l.team.takeaways-l.team.giveaways;return(d>0?`+${d}`:String(d));}}/>
      </div>

      <SectionLabel>Comebacks & Halftime</SectionLabel>
      <div style={leaderGrid}>
        <LeaderList title="4th Quarter Comebacks" valFn={l=>l.qs?.fourthQComebacks||0} suffix="×" filterFn={l=>(l.qs?.qGames||0)>0}/>
        <LeaderList title="Comeback Wins" valFn={l=>l.qs?.comebackWins||0} suffix="×" filterFn={l=>(l.qs?.qGames||0)>0}/>
        <LeaderList title="Record When Leading at Half" valFn={l=>l.qs?.leadHalfW||0} filterFn={l=>(l.qs?.qGames||0)>0} renderVal={l=>`${l.qs.leadHalfW}-${l.qs.leadHalfL}`}/>
        <LeaderList title="Avg Time of Possession" valFn={l=>l.qs.topGames>0?l.qs.topSecSum/l.qs.topGames:0} filterFn={l=>(l.qs?.topGames||0)>0} renderVal={l=>formatTOP(l.qs.topSecSum/l.qs.topGames)}/>
      </div>

      {qRows.length>0&&<>
        <SectionLabel>Quarter By Quarter (Avg Points Scored)</SectionLabel>
        <Card style={{overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?11:12}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>
                {["Coach","Avg Q1","Avg Q2","Avg Q3","Avg Q4"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:h==="Coach"?"left":"center",color:"#555",fontSize:9,letterSpacing:0.5,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}
              </tr></thead>
              <tbody>{qRows.map((l,i)=>(
                <tr key={l.userId||l.name} style={{borderBottom:"1px solid #eee",background:i%2===0?"#fff":"#fafafa"}}>
                  <td style={{padding:"6px 8px",fontWeight:700,whiteSpace:"nowrap"}}><Name userId={l.userId} userName={l.name}>{l.name}</Name></td>
                  {[0,1,2,3].map(qi=><td key={qi} style={{padding:"6px 8px",textAlign:"center"}}>{(l.qs.qSum[qi]/l.qs.qGames).toFixed(1)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>

        <SectionLabel>Quarter By Quarter (Avg Points Allowed)</SectionLabel>
        <Card style={{overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?11:12}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>
                {["Coach","Avg Q1","Avg Q2","Avg Q3","Avg Q4"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:h==="Coach"?"left":"center",color:"#555",fontSize:9,letterSpacing:0.5,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}
              </tr></thead>
              <tbody>{qRows.map((l,i)=>(
                <tr key={l.userId||l.name} style={{borderBottom:"1px solid #eee",background:i%2===0?"#fff":"#fafafa"}}>
                  <td style={{padding:"6px 8px",fontWeight:700,whiteSpace:"nowrap"}}><Name userId={l.userId} userName={l.name}>{l.name}</Name></td>
                  {[0,1,2,3].map(qi=><td key={qi} style={{padding:"6px 8px",textAlign:"center"}}>{(l.qs.qSumAllowed[qi]/l.qs.qGames).toFixed(1)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </>}
    </div>
  );
}

function ProfileTab({history,setupRows,currentEntries,season,year,permanentUsers,sel,setSel,pTab,setPTab,articles,setActiveArticle,playerStats,gameArchive}) {
  const isMobile = useIsMobile();
  const [expandedSeasons,setExpandedSeasons] = useState({});
  const [expandedGames,setExpandedGames] = useState({});
  const [expandedH2H,setExpandedH2H] = useState({});
  const [expandedH2HGame,setExpandedH2HGame] = useState({});
  // Merge permanentUsers with setupRows so no one gets dropped
  const puList = (permanentUsers||[]).map(u=>({userId:u.id,userName:u.defaultName,teamName:(setupRows||[]).find(r=>r.userId===u.id)?.teamName||u.teamName||""}));
  const puIds = new Set(puList.map(u=>u.userId));
  const extraRows = (setupRows||[]).filter(r=>r.userId&&!puIds.has(r.userId)).map(r=>({userId:r.userId,userName:r.userName,teamName:r.teamName}));
  const allUsers = [...puList,...extraRows].filter(u=>u.userName);
  if (!allUsers.length) return <Card style={{padding:20}}><div style={{color:"#888",fontSize:14}}>No users found.</div></Card>;
  // H2H records are keyed by opponent TEAM name (that's what's stored in weekLog), but the
  // profile page is about coaches — resolve each opponent team to its current coach's name for
  // display, falling back to the team name itself if that team isn't on the current roster.
  const teamNameToCoach = Object.fromEntries(allUsers.filter(u=>u.teamName).map(u=>[u.teamName,u.userName]));

  function getProfile(userId, fallbackUserName) {
    const seasons=history.map(s=>{
      const srt=[...s.finalStandings].sort((a,b)=>calcTotal(b)-calcTotal(a));
      // Match by userId first, then fall back to userName
      const entry=srt.find(t=>(userId&&t.userId===userId)||(t.userName===fallbackUserName));
      if(!entry)return null;
      const rank=srt.findIndex(t=>(userId&&t.userId===userId)||(t.userName===fallbackUserName))+1;
      const userName=entry.userName;
      const nattyWin=(entry.nattyWinner||((entry.nattyWins||0)>0))||(s.nattyWinners?.includes(entry.teamName))||(s.nattyWinner&&s.nattyWinner.split(", ").includes(entry.teamName));
      const confChamp=(entry.confChampion||((entry.confChampWins||0)>0))||(s.confWinners?.includes(entry.teamName))||(s.confChampion&&s.confChampion.split(", ").includes(entry.teamName))||s.confChampion===entry.teamName||s.confChampion===userName;
      return{year:s.year,seasonNum:s.seasonNum,rank,total:calcTotal(entry),wins:entry.wins,losses:entry.losses,teamName:entry.teamName,userName,champion:s.champion===userName,confChamp,confChampWins:entry.confChampWins||0,confChampLosses:entry.confChampLosses||0,nattyWin,nattyWins:entry.nattyWins||0,nattyLosses:entry.nattyLosses||0,heisman:s.heisman===entry.teamName||s.heisman===userName,weekLog:entry.weekLog||[],gamePts:entry.gamePts||0,rankedBonusPts:entry.rankedBonusPts||0,confStandPts:entry.confStandPts||0,confChampPts:entry.confChampPts||0,bowlPts:entry.bowlPts||0,recruitingPts:entry.recruitingPts||0,prestigePts:entry.prestigePts||0,heismanPts:entry.heismanPts||0,h2h:entry.h2h||{},playoffWins:entry.playoffWins||0,playoffLosses:entry.playoffLosses||0,bowlResult:entry.bowlResult||"none",bowlOpponent:entry.bowlOpponent||"",top25Wins:entry.top25Wins||0,top25Losses:entry.top25Losses||0,top10Wins:entry.top10Wins||0,top10Losses:entry.top10Losses||0,isHistorical:s.isHistorical||false};
    }).filter(Boolean);
    const cur=currentEntries.find(e=>(userId&&e.userId===userId)||(e.userName===fallbackUserName));
    const totalWins=seasons.reduce((a,s)=>a+s.wins,0)+(cur?.wins||0);
    const totalLosses=seasons.reduce((a,s)=>a+s.losses,0)+(cur?.losses||0);
    const totalPts=seasons.reduce((a,s)=>a+s.total,0)+(cur?calcTotal(cur):0);
    const championships=seasons.filter(s=>s.champion).length;
    const confTitles=seasons.reduce((a,s)=>a+(s.confChampWins>0?s.confChampWins:s.confChamp?1:0),0);
    const nattyWins=seasons.reduce((a,s)=>a+(s.nattyWins>0?s.nattyWins:s.nattyWin?1:0),0);
    const heismans=seasons.filter(s=>s.heisman).length;
    const bestFinish=seasons.length?Math.min(...seasons.map(s=>s.rank)):null;
    const allResults=[...seasons.flatMap(s=>(s.weekLog||[]).map(w=>w.result)),(cur?.weekLog||[]).map(w=>w.result)].flat().filter(r=>r==="win"||r==="loss");
    let longestWin=0,longestLoss=0,tmpW=0,tmpL=0;
    allResults.forEach(r=>{if(r==="win"){tmpW++;tmpL=0;if(tmpW>longestWin)longestWin=tmpW;}else{tmpL++;tmpW=0;if(tmpL>longestLoss)longestLoss=tmpL;}});
    let curStreak=0,curStreakType="";
    for(let i=allResults.length-1;i>=0;i--){if(i===allResults.length-1){curStreakType=allResults[i];curStreak=1;}else if(allResults[i]===curStreakType)curStreak++;else break;}
    const allWeekLogs=[...seasons.flatMap(s=>s.weekLog||[]),(cur?.weekLog||[])].flat();
    const rankedWins=allWeekLogs.filter(w=>w.result==="win"&&(w.ranked25||w.ranked10)).length;
    const top10Wins=allWeekLogs.filter(w=>w.result==="win"&&w.ranked10).length;
    const winPct=totalWins+totalLosses>0?((totalWins/(totalWins+totalLosses))*100).toFixed(1):0;
    // Career bowl/playoff/ranked records (from historical + weekLog-derived)
    const careerPlayoffWins=seasons.reduce((a,s)=>a+(s.playoffWins||0),0);
    const careerPlayoffLosses=seasons.reduce((a,s)=>a+(s.playoffLosses||0),0);
    const bowlWins=seasons.reduce((a,s)=>a+(s.bowlWins!=null?s.bowlWins:(s.bowlResult==="win"?1:0)),0);
    const bowlLosses=seasons.reduce((a,s)=>a+(s.bowlLosses!=null?s.bowlLosses:(s.bowlResult==="loss"?1:0)),0);
    const bowlAppearances=bowlWins+bowlLosses;
    const careerTop25Wins=seasons.reduce((a,s)=>a+(s.top25Wins||0),0)+allWeekLogs.filter(w=>w.result==="win"&&w.ranked25&&!w.ranked10).length;
    const careerTop10Wins=seasons.reduce((a,s)=>a+(s.top10Wins||0),0)+allWeekLogs.filter(w=>w.result==="win"&&w.ranked10).length;
    const forfeitWins=allWeekLogs.filter(w=>w.forfeit&&w.result==="win").length;
    const forfeitLosses=allWeekLogs.filter(w=>w.forfeit&&w.result==="loss").length;
    // H2H - merge across all seasons + current
    const h2hMerged={};
    [...seasons.map(s=>s.h2h||{}),(cur?.h2h||{})].forEach(h2h=>{Object.entries(h2h).forEach(([opp,rec])=>{if(!h2hMerged[opp])h2hMerged[opp]={wins:0,losses:0};h2hMerged[opp].wins+=(rec.wins||0);h2hMerged[opp].losses+=(rec.losses||0);});});
    const ptBreakdown={game:seasons.reduce((a,s)=>a+(s.gamePts||0),0)+(cur?.gamePts||0),bonus:seasons.reduce((a,s)=>a+(s.rankedBonusPts||0),0)+(cur?.rankedBonusPts||0),conf:seasons.reduce((a,s)=>a+(s.confStandPts||0),0)+(cur?.confStandPts||0),cc:seasons.reduce((a,s)=>a+(s.confChampPts||0),0)+(cur?.confChampPts||0),bowl:seasons.reduce((a,s)=>a+(s.bowlPts||0),0)+(cur?.bowlPts||0),rec:seasons.reduce((a,s)=>a+(s.recruitingPts||0),0)+(cur?.recruitingPts||0),awards:seasons.reduce((a,s)=>a+(s.prestigePts||0)+(s.heismanPts||0),0)+((cur?.prestigePts||0)+(cur?.heismanPts||0))};
    return{seasons,cur,totalWins,totalLosses,totalPts,championships,confTitles,heismans,nattyWins,bestFinish,longestWin,longestLoss,curStreak,curStreakType,rankedWins,top10Wins,winPct,h2hMerged,ptBreakdown,careerPlayoffWins,careerPlayoffLosses,bowlWins,bowlLosses,bowlAppearances,careerTop25Wins,careerTop10Wins,forfeitWins,forfeitLosses};
  }


  const user=sel?allUsers.find(u=>(u.userId||u.userName)===sel):null;
  const profile=user?getProfile(user.userId||null,user.userName):null;
  const SB=({label,val,color="#111",sub})=><div style={{background:"#f7f7f7",borderRadius:2,padding:"12px 8px",textAlign:"center",border:"1px solid #eee"}}><div style={{fontSize:19,fontWeight:900,color}}>{val}</div>{sub&&<div style={{fontSize:10,color:"#999"}}>{sub}</div>}<div style={{fontSize:9,color:"#aaa",textTransform:"uppercase",letterSpacing:1,marginTop:3,fontWeight:700}}>{label}</div></div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <SL>Select User</SL>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
        {allUsers.map(u=>{const key=u.userId||u.userName;const curEntry=currentEntries.find(e=>u.userId?e.userId===u.userId:e.userName===u.userName);return(<button key={key} onClick={()=>{setSel(sel===key?null:key);}} style={{padding:"10px 14px",borderRadius:2,border:"1px solid",borderColor:sel===key?RED:"#ddd",background:sel===key?RED:"#fff",color:sel===key?"#fff":"#333",cursor:"pointer",fontFamily:ff,textAlign:"left"}}><div style={{fontWeight:800,fontSize:13}}>{curEntry?.userName||u.userName}</div><div style={{fontSize:10,color:sel===key?"rgba(255,255,255,0.7)":"#999",marginTop:2,textTransform:"uppercase"}}>{curEntry?.teamName||u.teamName}</div></button>);})}
      </div>
      {profile&&user&&<Card style={{borderTop:`3px solid ${RED}`,overflow:"hidden"}}>
        <div style={{background:"#f7f7f7",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          {(()=>{const curEntry=currentEntries.find(e=>user.userId?e.userId===user.userId:e.userName===user.userName);const displayName=curEntry?.userName||user.userName;const displayTeam=curEntry?.teamName||user.teamName;const imgs=getPlayerImages(setupRows,user.userId,user.userName);return(
          <div style={{display:"flex",gap:14,alignItems:"flex-start",flex:1,minWidth:0}}>
            <div style={{position:"relative",width:72,height:72,flexShrink:0}}>
              <div style={{width:72,height:72,borderRadius:"50%",background:"#ddd",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#aaa",border:"3px solid #fff",boxShadow:"0 1px 4px rgba(0,0,0,0.1)"}}>{displayName[0]?.toUpperCase()}</div>
              {imgs.profilePic&&<img key={imgs.profilePic} src={imgs.profilePic} alt={displayName} style={{position:"absolute",top:0,left:0,width:72,height:72,borderRadius:"50%",objectFit:"cover",border:"3px solid #fff",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}} onError={e=>{e.target.style.display="none";}}/>}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#111"}}>{displayName.toUpperCase()}</div>
                {imgs.teamLogo&&<img src={imgs.teamLogo} alt={displayTeam} style={{height:28,width:"auto",objectFit:"contain",maxWidth:60}} onError={e=>{e.target.style.display="none";}} key={imgs.teamLogo}/>}
              </div>
              <div style={{fontSize:12,color:"#888",marginTop:2}}>{displayTeam} · {profile.totalWins}W-{profile.totalLosses}L · {profile.winPct}%</div>
              <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{profile.championships>0&&<div style={{background:RED,borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏆 DYNASTY CHAMP {profile.championships}×</div>}{profile.nattyWins>0&&<div style={{background:"#b8860b",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🎖️ NATTY {profile.nattyWins}×</div>}{profile.confTitles>0&&<div style={{background:"#1a3a6b",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏅 CONF {profile.confTitles}×</div>}{profile.heismans>0&&<div style={{background:"#5a2d82",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>⭐ HEISMAN {profile.heismans}×</div>}{((profile.curStreakType==="win"&&profile.curStreak>=5)||(profile.curStreakType==="loss"&&profile.curStreak>1))&&<div style={{background:profile.curStreakType==="win"?"#e8f5e8":"#fff0f0",border:`1px solid ${profile.curStreakType==="win"?"#007a00":RED}`,borderRadius:2,padding:"2px 8px",fontSize:10,color:profile.curStreakType==="win"?"#007a00":RED,fontWeight:700}}>{profile.curStreakType==="win"?"🔥":"❄️"} {profile.curStreak} STREAK</div>}</div>
            </div>
          </div>
          );})()}
        </div>
        <div style={{display:"flex",borderBottom:"1px solid #eee",background:"#fff",overflowX:"auto"}}>
          {["overview","seasons","h2h","streaks","points","stats","news"].map(t=><button key={t} onClick={()=>setPTab(t)} style={{padding:isMobile?"10px 8px":"10px 14px",background:"transparent",border:"none",borderBottom:pTab===t?`3px solid ${RED}`:"3px solid transparent",color:pTab===t?"#111":"#888",cursor:"pointer",fontSize:isMobile?10:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{isMobile?(t==="overview"?"OVR":t==="seasons"?"SEASONS":t==="h2h"?"H2H":t==="streaks"?"STREAKS":t==="points"?"PTS":t==="stats"?"STATS":"NEWS"):(t==="h2h"?"H2H Records":t==="news"?"📰 News":t==="stats"?"Game Stats":t)}</button>)}
        </div>
        <div style={{padding:isMobile?12:18}}>
          {pTab==="overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div><SL>Career Stats</SL><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr 1fr":"repeat(auto-fill,minmax(90px,1fr))",gap:8}}>
              <SB label="Total Pts" val={profile.totalPts} color={RED}/>
              <SB label="Wins" val={profile.totalWins} color="#007a00"/>
              <SB label="Losses" val={profile.totalLosses} color={RED}/>
              <SB label="Win %" val={profile.winPct+"%"}/>
              <SB label="Best Finish" val={profile.bestFinish?`#${profile.bestFinish}`:"—"} color={RED}/>
              <SB label="Seasons" val={profile.seasons.length+(profile.cur?1:0)}/>
              <SB label="Natty Wins" val={profile.nattyWins} color="#1a3a6b"/>
              <SB label="Conf Titles" val={profile.confTitles} color="#555"/>
            </div></div>
            <div><SL>Bowl & Playoff</SL><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(110px,1fr))",gap:8}}>
              <SB label="Bowl Apps" val={profile.bowlAppearances}/>
              <SB label="Bowl Record" val={profile.bowlAppearances>0?`${profile.bowlWins}-${profile.bowlLosses}`:"—"} color={profile.bowlWins>profile.bowlLosses?"#007a00":RED}/>
              <SB label="Playoff W" val={profile.careerPlayoffWins} color="#007a00"/>
              <SB label="Playoff L" val={profile.careerPlayoffLosses} color={RED}/>
            </div></div>
            <div><SL>Ranked Record</SL><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(110px,1fr))",gap:8}}>
              <SB label="Top 25 Wins" val={profile.careerTop25Wins} color="#cc7700"/>
              <SB label="Top 10 Wins" val={profile.careerTop10Wins} color={RED}/>
              <SB label="Win Streak" val={profile.longestWin+"G"} color="#007a00"/>
              <SB label="Loss Streak" val={profile.longestLoss+"G"} color={RED}/>
            </div></div>
            {(profile.forfeitWins>0||profile.forfeitLosses>0)&&<div><SL>Forfeits</SL><div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(110px,1fr))",gap:8}}>
              <SB label="Forfeit Wins" val={profile.forfeitWins} color="#b8860b"/>
              <SB label="Forfeit Losses" val={profile.forfeitLosses} color="#b8860b"/>
            </div></div>}
          </div>}

          {pTab==="h2h"&&(()=>{
            // Individual games behind an H2H record — weekLog only stores the aggregate
            // win/loss count per opponent, so this walks every season's (and the live
            // season's) log looking for entries against this one opponent team.
            const getH2HGames = (oppTeamName) => {
              const games=[];
              profile.seasons.filter(s=>!s.isHistorical).forEach(s=>{
                (s.weekLog||[]).forEach(w=>{ if(w.opponent===oppTeamName) games.push({year:s.year,week:w.week,result:w.result,forfeit:w.forfeit,teamName:s.teamName}); });
              });
              if(profile.cur){
                (profile.cur.weekLog||[]).forEach(w=>{ if(w.opponent===oppTeamName) games.push({year,week:w.week,result:w.result,forfeit:w.forfeit,teamName:profile.cur.teamName}); });
              }
              return games.sort((a,b)=>b.year!==a.year?b.year-a.year:b.week-a.week);
            };
            const H2HGameLog = ({opp}) => {
              const games = getH2HGames(opp);
              if(!games.length) return <div style={{padding:"10px 14px",background:"#fafafa",color:"#aaa",fontSize:12}}>No individual game records found (this opponent's record may be from a bulk/historical import).</div>;
              return (
                <div style={{background:"#fafafa"}}>
                  {games.map((g,i)=>{
                    const archivedGame=(gameArchive||[]).find(ga=>ga.year===g.year&&ga.week===g.week&&(ga.team1.name===g.teamName||ga.team2.name===g.teamName));
                    const gameKey=`${opp}-${g.year}-${g.week}-${i}`;
                    const isOpen=expandedH2HGame[gameKey];
                    const mine=archivedGame&&(archivedGame.team1.name===g.teamName?archivedGame.team1:archivedGame.team2);
                    const oppGame=archivedGame&&(archivedGame.team1.name===g.teamName?archivedGame.team2:archivedGame.team1);
                    return (
                      <div key={gameKey} style={{borderTop:"1px solid #eee"}}>
                        <div onClick={archivedGame?()=>setExpandedH2HGame(p=>({...p,[gameKey]:!p[gameKey]})):undefined} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",cursor:archivedGame?"pointer":"default"}}>
                          <span style={{fontSize:11,color:"#888",width:80,flexShrink:0}}>Wk {g.week} · {g.year}</span>
                          <span style={{fontSize:11,fontWeight:800,color:g.result==="win"?"#007a00":RED,textTransform:"uppercase",width:50,flexShrink:0}}>{g.result}{g.forfeit?" (F)":""}</span>
                          <span style={{fontSize:12,fontWeight:700,color:"#555",flex:1}}>{archivedGame?`${mine.score}-${oppGame.score}`:"-"}</span>
                          {archivedGame&&<span style={{fontSize:10,color:"#ccc"}}>{isOpen?"▲":"▼"}</span>}
                        </div>
                        {isOpen&&archivedGame&&<div style={{padding:"0 14px 10px"}}><BoxScoreDetail team1={mine} team2={oppGame}/></div>}
                      </div>
                    );
                  })}
                </div>
              );
            };
            return (
            <div>
            <SL>Head-to-Head Records</SL>
            {Object.keys(profile.h2hMerged).length===0?<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>No head-to-head data yet. Records are tracked when opponent names match dynasty users.</div>:
            isMobile?(
              <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                {Object.entries(profile.h2hMerged).sort((a,b)=>(b[1].wins+b[1].losses)-(a[1].wins+a[1].losses)).map(([opp,rec])=>{const winning=rec.wins>rec.losses;const isOpen=expandedH2H[opp];return(
                  <div key={opp} style={{borderRadius:2,border:"1px solid #eee",overflow:"hidden"}}>
                    <div onClick={()=>setExpandedH2H(p=>({...p,[opp]:!p[opp]}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",cursor:"pointer",background:winning?"#f0f8f0":rec.wins<rec.losses?"#fff8f8":"transparent"}}>
                      <span style={{fontSize:13,fontWeight:600,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{teamNameToCoach[opp]||opp}</span>
                      <span style={{fontSize:12,fontWeight:700,color:"#555",margin:"0 10px",flexShrink:0}}>{rec.wins}W-{rec.losses}L</span>
                      <span style={{background:winning?RED:"#007a00",color:"#fff",borderRadius:2,padding:"2px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>{winning?"LEADS":"TRAILS"}{rec.wins===rec.losses?" (TIED)":""}</span>
                      <span style={{fontSize:10,color:"#ccc",marginLeft:8,flexShrink:0}}>{isOpen?"▲":"▼"}</span>
                    </div>
                    {isOpen&&<H2HGameLog opp={opp}/>}
                  </div>
                );})}
              </div>
            ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Opponent","W","L","W%","Result"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Opponent"?"left":"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800}}>{h}</th>)}</tr></thead>
              <tbody>{Object.entries(profile.h2hMerged).sort((a,b)=>(b[1].wins+b[1].losses)-(a[1].wins+a[1].losses)).map(([opp,rec])=>{const total=rec.wins+rec.losses;const wpct=total>0?((rec.wins/total)*100).toFixed(0):0;const winning=rec.wins>rec.losses;const isOpen=expandedH2H[opp];return(<Fragment key={opp}>
                <tr onClick={()=>setExpandedH2H(p=>({...p,[opp]:!p[opp]}))} style={{borderBottom:"1px solid #eee",cursor:"pointer",background:winning?"#f0f8f0":rec.wins<rec.losses?"#fff8f8":"transparent"}}>
                  <td style={{padding:"9px 10px",fontWeight:600,color:"#111"}}>{teamNameToCoach[opp]||opp} <span style={{fontSize:10,color:"#ccc"}}>{isOpen?"▲":"▼"}</span></td>
                  <td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:"#007a00"}}>{rec.wins}</td>
                  <td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:RED}}>{rec.losses}</td>
                  <td style={{padding:"9px 10px",textAlign:"center",color:"#555"}}>{wpct}%</td>
                  <td style={{padding:"9px 10px",textAlign:"center"}}><span style={{background:winning?RED:"#007a00",color:"#fff",borderRadius:2,padding:"2px 8px",fontSize:10,fontWeight:700}}>{winning?"LEADS":"TRAILS"}{rec.wins===rec.losses?" (TIED)":""}</span></td>
                </tr>
                {isOpen&&<tr><td colSpan={5} style={{padding:0}}><H2HGameLog opp={opp}/></td></tr>}
              </Fragment>);})}</tbody>
            </table>)}
            </div>
            );
          })()}

          {pTab==="seasons"&&<div style={{display:"flex",flexDirection:"column",gap:0}}>
            <SL>Season-by-Season Results</SL>
            {(()=>{
              const allSeasons=[...profile.seasons];
              if(profile.cur){allSeasons.push({year:year,seasonNum:season,teamName:profile.cur.teamName,wins:profile.cur.wins,losses:profile.cur.losses,total:calcTotal(profile.cur),rank:null,champion:false,confChamp:false,heisman:false,weekLog:profile.cur.weekLog||[],isCurrent:true});}
              // Sort by year descending, then seasonNum descending within same year
              allSeasons.sort((a,b)=>b.year!==a.year?b.year-a.year:(b.seasonNum||0)-(a.seasonNum||0));
              return allSeasons.map((s,idx)=>{
                const pct=s.wins+s.losses>0?((s.wins/(s.wins+s.losses))*100).toFixed(0):0;
                const key=`${s.year}-${s.seasonNum}-${idx}`;
                return(
                  <div key={key} style={{border:"1px solid #eee",borderRadius:2,overflow:"hidden",marginBottom:8}}>
                    {/* Year + season header — click to expand */}
                    <div onClick={()=>setExpandedSeasons(prev=>({...prev,[key]:!prev[key]}))}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",background:s.champion?"#fff8f8":s.isCurrent?"#f8f8ff":"#fff",borderBottom:expandedSeasons[key]?"1px solid #eee":"none"}}>
                      {/* Year badge */}
                      <div style={{background:"#1a1a1a",borderRadius:2,padding:"3px 8px",flexShrink:0}}>
                        <div style={{fontSize:12,fontWeight:900,color:"#fff",letterSpacing:1}}>{s.year}</div>
                        {s.seasonNum&&<div style={{fontSize:9,color:"#888",textAlign:"center"}}>S{s.seasonNum}</div>}
                      </div>
                      <div style={{flex:1,fontSize:12,fontWeight:700,color:"#555"}}>{s.teamName}</div>
                      <div style={{fontSize:12,fontWeight:700,color:"#007a00"}}>{s.wins}W</div>
                      <div style={{fontSize:12,color:"#aaa"}}>-</div>
                      <div style={{fontSize:12,fontWeight:700,color:RED}}>{s.losses}L</div>
                      <div style={{fontSize:11,color:"#888",width:32,textAlign:"center"}}>{pct}%</div>
                      <div style={{fontSize:14,fontWeight:900,color:RED,width:36,textAlign:"right"}}>{s.total}</div>
                      <div style={{fontSize:11,color:s.rank===1?RED:"#888",fontWeight:s.rank===1?800:400,width:28,textAlign:"right"}}>{s.rank?`#${s.rank}`:s.isCurrent?"Live":"—"}</div>
                      {s.champion&&<span style={{fontSize:11}}>🏆</span>}
                      {s.nattyWin&&<span style={{fontSize:11}} title="National Champion">🏈</span>}
                      {s.confChamp&&<span style={{fontSize:11}} title="Conf Champion">🏅</span>}
                      {s.isCurrent&&<span style={{background:RED,color:"#fff",fontSize:8,fontWeight:800,padding:"1px 5px",borderRadius:10}}>LIVE</span>}
                      <span style={{color:"#ccc",fontSize:12}}>{expandedSeasons[key]?"▲":"▼"}</span>
                    </div>
                    {/* Expanded: game log */}
                    {expandedSeasons[key]&&s.weekLog&&s.weekLog.length>0&&(
                      <div style={{background:"#fafafa"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead><tr style={{borderBottom:"1px solid #e0e0e0"}}>{["Week","Opponent","Result","Score","Opponent Rank","Pts"].map(h=><th key={h} style={{padding:"6px 12px",textAlign:"center",color:"#aaa",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>{h}</th>)}</tr></thead>
                          <tbody>{s.weekLog.map((w,i)=>{
                            const archivedGame=(gameArchive||[]).find(g=>g.year===s.year&&g.week===w.week&&(g.team1.name===s.teamName||g.team2.name===s.teamName));
                            const gameKey=`${key}-${w.week}-${i}`;
                            const isOpen=expandedGames[gameKey];
                            const mine=archivedGame&&(archivedGame.team1.name===s.teamName?archivedGame.team1:archivedGame.team2);
                            const opp=archivedGame&&(archivedGame.team1.name===s.teamName?archivedGame.team2:archivedGame.team1);
                            return(<Fragment key={i}>
                              <tr onClick={archivedGame?()=>setExpandedGames(prev=>({...prev,[gameKey]:!prev[gameKey]})):undefined} style={{borderBottom:"1px solid #f0f0f0",background:w.result==="win"?"#f0f8f0":"#fff8f8",cursor:archivedGame?"pointer":"default"}}>
                                <td style={{padding:"7px 12px",textAlign:"center",color:"#888"}}>Wk {w.week}</td>
                                <td style={{padding:"7px 12px",textAlign:"center",color:"#555"}}>{w.opponent&&w.opponent!=="Unknown"?formatOpp(w.opponent):"—"}</td>
                                <td style={{padding:"7px 12px",textAlign:"center",fontWeight:800,color:w.result==="win"?"#007a00":RED,textTransform:"uppercase"}}>{w.result}{w.forfeit&&" (F)"}</td>
                                <td style={{padding:"7px 12px",textAlign:"center",color:"#555",fontWeight:700}}>{archivedGame?`${mine.score}-${opp.score}`:"-"}</td>
                                <td style={{padding:"7px 12px",textAlign:"center",color:w.ranked10?RED:w.ranked25?"#cc7700":"#ccc"}}>{w.ranked10?"Top 10":w.ranked25?"Top 25":"Unranked"}</td>
                                <td style={{padding:"7px 12px",textAlign:"center",color:RED,fontWeight:700}}>+{w.pts}{archivedGame&&<span style={{marginLeft:6,color:"#bbb",fontSize:10}}>{isOpen?"▲":"▼"}</span>}</td>
                              </tr>
                              {isOpen&&archivedGame&&(
                                <tr>
                                  <td colSpan={6} style={{padding:"10px 12px",background:"#fff"}}>
                                    <BoxScoreDetail team1={mine} team2={opp}/>
                                  </td>
                                </tr>
                              )}
                            </Fragment>);
                          })}</tbody>
                        </table>
                      </div>
                    )}
                    {expandedSeasons[key]&&(!s.weekLog||s.weekLog.length===0)&&(
                      <div style={{padding:"12px 14px",background:"#fafafa",color:"#aaa",fontSize:12}}>No game log available for this season.</div>
                    )}
                  </div>
                );
              });
            })()}
            {profile.seasons.length===0&&!profile.cur&&<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>No seasons recorded yet.</div>}
          </div>}

          {pTab==="streaks"&&(()=>{
            // Compute per-profile streak details
            const allLogs=[];
            profile.seasons.filter(s=>!s.isHistorical).forEach(s=>(s.weekLog||[]).forEach(w=>allLogs.push({...w,year:s.year,seasonNum:s.seasonNum,teamName:s.teamName})));
            if(profile.cur)(profile.cur.weekLog||[]).forEach(w=>allLogs.push({...w,year,seasonNum:season,teamName:profile.cur.teamName}));
            // Find longest win streak with span
            let maxW=0,curW=0,startI=0,bestWS=0,bestWE=0;
            allLogs.forEach((w,i)=>{if(w.result==="win"){if(curW===0)startI=i;curW++;if(curW>maxW){maxW=curW;bestWS=startI;bestWE=i;}}else curW=0;});
            const wsSpan=maxW>0?[...new Set(allLogs.slice(bestWS,bestWE+1).map(w=>w.year))].join("–"):"";
            const wsTeam=maxW>0?(allLogs[bestWS]?.teamName||""):"";
            // Longest loss streak
            let maxL=0,curL=0;
            allLogs.forEach(w=>{if(w.result==="loss"){curL++;if(curL>maxL)maxL=curL;}else curL=0;});
            // Current active streak
            let activeCnt=0,activeType="";
            for(let i=allLogs.length-1;i>=0;i--){const r=allLogs[i].result;if(!activeType){activeType=r;activeCnt=1;}else if(r===activeType)activeCnt++;else break;}
            // Best single-season win streak
            let bestSSnLen=0,bestSSnYear=null,bestSSnTeam="";
            const ssnSrc=[...profile.seasons.filter(s=>!s.isHistorical)];
            if(profile.cur)ssnSrc.push({...profile.cur,year,seasonNum:season});
            ssnSrc.forEach(s=>{let c=0,m=0;(s.weekLog||[]).forEach(w=>{if(w.result==="win"){c++;if(c>m)m=c;}else c=0;});if(m>bestSSnLen){bestSSnLen=m;bestSSnYear=s.year;bestSSnTeam=s.teamName;}});
            // Join weekLog entries with their archived box scores (if scanned) for stat-based streaks
            const profileGames=allLogs.map(w=>{
              const archivedGame=(gameArchive||[]).find(g=>g.year===w.year&&g.week===w.week&&(g.team1.name===w.teamName||g.team2.name===w.teamName));
              if(!archivedGame)return null;
              const isTeam1=archivedGame.team1.name===w.teamName;
              const stats=isTeam1?archivedGame.team1:archivedGame.team2;
              const oppStats=isTeam1?archivedGame.team2:archivedGame.team1;
              return{...w,stats,oppStats};
            }).filter(Boolean);
            return(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div><SL>Streak Records</SL>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
                  <SB label="Longest Win Streak" val={maxW>0?maxW+"W":"—"} color="#007a00" sub={maxW>0?`${wsTeam} · ${wsSpan}`:""}/>
                  <SB label="Longest Loss Streak" val={maxL>0?maxL+"L":"—"} color={RED}/>
                  <SB label="Current Streak" val={activeCnt>0?`${activeCnt}${activeType==="win"?"W":"L"}`:"—"} color={activeType==="win"?"#007a00":RED}/>
                  <SB label="Best Season Streak" val={bestSSnLen>0?bestSSnLen+"W":"—"} color="#007a00" sub={bestSSnLen>0?`${bestSSnTeam} · ${bestSSnYear}`:""}/>
                </div>
              </div>
              <div><SL>Stat Streaks</SL>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
                  {STAT_STREAK_DEFS.map(def=>{const s=longestStatStreak(profileGames,def.pred);return(
                    <SB key={def.key} label={def.label} val={s?s.len+"G":"—"} color="#1a3a6b" sub={s?`${s.teamName} · ${s.span}`:""}/>
                  );})}
                </div>
              </div>
              {profile.cur?.weekLog?.length>0&&<div><SL>Current Season Game Log</SL><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Week","Result","Opponent","Opp Rank","Pts"].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>{h}</th>)}</tr></thead><tbody>{profile.cur.weekLog.map((w,i)=><tr key={i} style={{borderBottom:"1px solid #eee",background:w.result==="win"?"#f0f8f0":"#fff8f8"}}><td style={{padding:"7px 8px",textAlign:"center",color:"#888"}}>Wk {w.week}</td><td style={{padding:"7px 8px",textAlign:"center",fontWeight:800,color:w.result==="win"?"#007a00":RED,textTransform:"uppercase"}}>{w.result}{w.forfeit&&" (F)"}</td><td style={{padding:"7px 8px",textAlign:"center",color:"#555",fontSize:11}}>{w.opponent||"—"}</td><td style={{padding:"7px 8px",textAlign:"center",color:w.ranked10?RED:w.ranked25?"#cc7700":"#ccc"}}>{w.ranked10?"Top 10":w.ranked25?"Top 25":"Unranked"}</td><td style={{padding:"7px 8px",textAlign:"center",color:RED,fontWeight:700}}>+{w.pts}</td></tr>)}</tbody></table></div>}
            </div>);
          })()}

          {pTab==="points"&&<div style={{display:"flex",flexDirection:"column",gap:14}}><SL>All-Time Points Breakdown</SL>{[["Game Wins",profile.ptBreakdown.game,"#007a00"],["Ranked Bonuses",profile.ptBreakdown.bonus,"#cc7700"],["Conf Standings",profile.ptBreakdown.conf,"#111"],["Conf Championship",profile.ptBreakdown.cc,"#111"],["Bowl & Playoff",profile.ptBreakdown.bowl,"#0066cc"],["Recruiting",profile.ptBreakdown.rec,"#111"],["Awards",profile.ptBreakdown.awards,"#cc7700"]].map(([label,val,color])=>{const pct=profile.totalPts>0?Math.round((val/profile.totalPts)*100):0;return(<div key={label} style={{padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:"#333"}}>{label}</span><span style={{fontSize:13,fontWeight:800,color}}>{val} <span style={{fontSize:11,color:"#aaa",fontWeight:400}}>({pct}%)</span></span></div><div style={{background:"#eee",borderRadius:2,height:6,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2}}/></div></div>);})}
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0"}}><span style={{fontSize:14,fontWeight:800}}>TOTAL</span><span style={{fontSize:16,fontWeight:900,color:RED}}>{profile.totalPts}</span></div></div>}

          {pTab==="stats"&&<PlayerStatsTab userId={user.userId} userName={user.userName} playerStats={playerStats} gameArchive={gameArchive} yearList={[]} ff={ff} RED={RED}/>}
          {pTab==="news"&&(()=>{
            const curEntry=currentEntries.find(e=>user.userId?e.userId===user.userId:e.userName===user.userName);
            const names=[curEntry?.userName,curEntry?.teamName,user.userName].filter(Boolean);
            const allSeasonNames=[...new Set([...names,...profile.seasons.map(s=>s.teamName).filter(Boolean)])];
            const playerArticles=(articles||[]).filter(a=>allSeasonNames.some(n=>a.body?.includes(n)||a.headline?.includes(n)));
            if(!playerArticles.length)return <div style={{color:"#888",fontSize:13,padding:"16px 0",textAlign:"center"}}>No articles mention {curEntry?.userName||user.userName} yet.</div>;
            return(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <SL>{playerArticles.length} Article{playerArticles.length!==1?"s":""} Mentioning {curEntry?.userName||user.userName}</SL>
                {playerArticles.map(a=>(
                  <div key={a.id} onClick={()=>setActiveArticle&&setActiveArticle(a)} style={{border:"1px solid #eee",borderRadius:2,overflow:"hidden",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="#fafafa"} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                    <div style={{background:a.reporterColor||"#111",padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff",flexShrink:0}}>{a.reporterAvatar||"DC"}</div>
                      <div style={{fontSize:11,fontWeight:800,color:"#fff",flex:1,minWidth:0}}>{a.reporter||"Dynasty Central"}</div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.7)",flexShrink:0}}>S{a.season} Wk{a.week}</div>
                    </div>
                    <div style={{padding:"10px 12px"}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#111",lineHeight:1.3}}>{a.headline}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Card>}
    </div>
  );
}

// ── Player image helpers ──────────────────────────────────────────────────
function getPlayerImages(setupRows, userId, userName) {
  const row = (setupRows||[]).find(r => (userId && r.userId===userId) || r.userName===userName);
  return { profilePic: row?.profilePicUrl||null, teamLogo: row?.teamLogoUrl||null };
}

// ── PlayerStatsTab ────────────────────────────────────────────────────────
const EMPTY_STATS = () => ({
  passing:{att:0,comp:0,yds:0,tds:0,int:0},
  rushing:{att:0,yds:0,tds:0,fum:0},
  receiving:{rec:0,yds:0,tds:0},
  defense:{int:0,fum:0,sacks:0,tds:0},
  specialTeams:{fgAtt:0,fgMade:0,punts:0,puntYds:0,puntsIn20:0},
  team:{games:0,offPts:0,defPts:0,offYds:0,defYds:0,giveaways:0,takeaways:0,thirdConv:0,thirdAtt:0,fourthConv:0,fourthAtt:0,twoPtConv:0,twoPtAtt:0,offRedZonePct:0,defRedZonePct:0},
});
function sumStats(a, b) {
  const s = (obj1, obj2) => Object.fromEntries(Object.keys(obj1).map(k=>[k,(obj1[k]||0)+(obj2?.[k]||0)]));
  return {
    passing: s(a.passing, b?.passing),
    rushing: s(a.rushing, b?.rushing),
    receiving: s(a.receiving, b?.receiving),
    defense: s(a.defense, b?.defense),
    specialTeams: s(a.specialTeams, b?.specialTeams),
    team: s(a.team, b?.team),
  };
}
function StatRow({label, val, sub}) {
  const ff="'Helvetica Neue',Arial,sans-serif";
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
      <div style={{fontSize:13,color:"#555",fontFamily:ff}}>{label}</div>
      <div style={{textAlign:"right"}}>
        <div style={{fontSize:15,fontWeight:800,color:"#111",fontFamily:ff}}>{val}</div>
        {sub&&<div style={{fontSize:10,color:"#888",fontFamily:ff}}>{sub}</div>}
      </div>
    </div>
  );
}
// Quarter-by-quarter stats for one coach, read directly off each archived box score's
// quarters:[] array (only games where all 4 regulation quarters were scanned are counted).
function parseTOP(str){
  if(!str||typeof str!=="string")return null;
  const m=str.match(/^(\d+):(\d{2})$/);
  if(!m)return null;
  return parseInt(m[1],10)*60+parseInt(m[2],10);
}
function formatTOP(sec){
  const s=Math.round(sec);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}
function computeQuarterStats(gameArchive, userId, filterYear) {
  const qs={leadHalfW:0,leadHalfL:0,trailHalfW:0,trailHalfL:0,qSum:[0,0,0,0],qSumAllowed:[0,0,0,0],qGames:0,fourthQComebacks:0,comebackWins:0,biggestComeback:null,biggest4thQComeback:null,mostQuarterPts:null,topSecSum:0,topGames:0};
  (gameArchive||[]).filter(g=>filterYear==null||g.year===filterYear).forEach(g=>{
    [[g.team1,g.team2],[g.team2,g.team1]].forEach(([team,opp])=>{
      if(!userId||team.userId!==userId)return;
      const tq=team.quarters||[], oq=opp.quarters||[];
      if(tq.length<4||oq.length<4)return;
      const tCum=[tq[0],tq[0]+tq[1],tq[0]+tq[1]+tq[2]];
      const oCum=[oq[0],oq[0]+oq[1],oq[0]+oq[1]+oq[2]];
      const teamWon=(team.score||0)>(opp.score||0);
      if(tCum[1]>oCum[1]){if(teamWon)qs.leadHalfW++;else qs.leadHalfL++;}
      else if(tCum[1]<oCum[1]){if(teamWon)qs.trailHalfW++;else qs.trailHalfL++;}
      if(teamWon){
        const maxDeficit=Math.max(oCum[0]-tCum[0],oCum[1]-tCum[1],oCum[2]-tCum[2]);
        if(maxDeficit>0){
          qs.comebackWins++;
          if(!qs.biggestComeback||maxDeficit>qs.biggestComeback.deficit)qs.biggestComeback={deficit:maxDeficit,opponent:opp.name,year:g.year,week:g.week,score:`${team.score}-${opp.score}`};
        }
        const q4Deficit=oCum[2]-tCum[2];
        if(q4Deficit>0){
          qs.fourthQComebacks++;
          if(!qs.biggest4thQComeback||q4Deficit>qs.biggest4thQComeback.deficit)qs.biggest4thQComeback={deficit:q4Deficit,opponent:opp.name,year:g.year,week:g.week,score:`${team.score}-${opp.score}`};
        }
      }
      for(let i=0;i<4;i++){qs.qSum[i]+=tq[i];qs.qSumAllowed[i]+=oq[i];}
      qs.qGames++;
      tq.forEach((pts,qi)=>{if(!qs.mostQuarterPts||pts>qs.mostQuarterPts.pts)qs.mostQuarterPts={pts,quarter:qi+1,opponent:opp.name,year:g.year,week:g.week};});
      const topSec=parseTOP(team.misc?.timeOfPossession);
      if(topSec!=null){qs.topSecSum+=topSec;qs.topGames++;}
    });
  });
  return qs;
}
function PlayerStatsTab({userId, userName, playerStats, gameArchive, yearList, ff, RED}) {
  const [view, setView] = useState("career");
  const [cat, setCat] = useState("offense");
  const [offSub, setOffSub] = useState("passing");
  const userStats = playerStats?.[userId]||{};
  const years = Object.keys(userStats).map(Number).sort((a,b)=>b-a);
  const statsForView = view==="career"
    ? years.reduce((acc,y)=>sumStats(acc,userStats[y]), EMPTY_STATS())
    : (userStats[view]||EMPTY_STATS());
  if(view==="career"){
    // Red zone % is a rate, not a count — sumStats added the per-year percentages together, so
    // recompute it here as an average across the years that actually have team stats.
    const yearsWithGames=years.filter(y=>(userStats[y]?.team?.games||0)>0);
    if(yearsWithGames.length){
      statsForView.team.offRedZonePct=yearsWithGames.reduce((a,y)=>a+(userStats[y].team.offRedZonePct||0),0)/yearsWithGames.length;
      statsForView.team.defRedZonePct=yearsWithGames.reduce((a,y)=>a+(userStats[y].team.defRedZonePct||0),0)/yearsWithGames.length;
    }
  }
  const p=statsForView.passing, ru=statsForView.rushing, re=statsForView.receiving;
  const d=statsForView.defense, st=statsForView.specialTeams;
  const t=statsForView.team||EMPTY_STATS().team;
  const compPct=p.att>0?((p.comp/p.att)*100).toFixed(1):"-";
  const ypassComp=p.comp>0?(p.yds/p.comp).toFixed(1):"-";
  const ypc=ru.att>0?(ru.yds/ru.att).toFixed(1):"-";
  const ypr=re.rec>0?(re.yds/re.rec).toFixed(1):"-";
  const fgPct=st.fgAtt>0?((st.fgMade/st.fgAtt)*100).toFixed(1):"-";
  const puntAvg=st.punts>0?(st.puntYds/st.punts).toFixed(1):"-";
  const offPPG=t.games>0?(t.offPts/t.games).toFixed(1):"-";
  const defPPG=t.games>0?(t.defPts/t.games).toFixed(1):"-";
  const thirdPct=t.thirdAtt>0?((t.thirdConv/t.thirdAtt)*100).toFixed(1):"-";
  const fourthPct=t.fourthAtt>0?((t.fourthConv/t.fourthAtt)*100).toFixed(1):"-";
  const twoPtPct=t.twoPtAtt>0?((t.twoPtConv/t.twoPtAtt)*100).toFixed(1):"-";
  const offRZPct=t.games>0?t.offRedZonePct.toFixed(1):"-";
  const defRZPct=t.games>0?t.defRedZonePct.toFixed(1):"-";
  const toDiff=t.takeaways-t.giveaways;
  const toDiffStr=toDiff>0?`+${toDiff}`:String(toDiff);
  const qStats=computeQuarterStats(gameArchive,userId,view==="career"?null:view);
  const avgQ=(i)=>qStats.qGames>0?(qStats.qSum[i]/qStats.qGames).toFixed(1):"-";
  const avgQAllowed=(i)=>qStats.qGames>0?(qStats.qSumAllowed[i]/qStats.qGames).toFixed(1):"-";
  const btnStyle=(active)=>({padding:"6px 14px",border:"none",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:11,fontWeight:800,textTransform:"uppercase",background:active?RED:"#eee",color:active?"#fff":"#555"});
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* View selector */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <button style={btnStyle(view==="career")} onClick={()=>setView("career")}>Career</button>
        {years.map(y=><button key={y} style={btnStyle(view===y)} onClick={()=>setView(y)}>{y}</button>)}
      </div>
      {/* Category selector */}
      <div style={{display:"flex",gap:6}}>
        {["offense","defense","specialTeams","team","misc"].map(c=><button key={c} style={btnStyle(cat===c)} onClick={()=>setCat(c)}>{c==="specialTeams"?"Special Teams":c==="team"?"Team Stats":c==="misc"?"Misc Stats":c.charAt(0).toUpperCase()+c.slice(1)}</button>)}
      </div>
      {cat==="offense"&&<div style={{display:"flex",gap:6,marginTop:-4}}>
        {["passing","rushing","receiving"].map(s=><button key={s} style={{...btnStyle(offSub===s),background:offSub===s?"#333":"#f5f5f5",color:offSub===s?"#fff":"#555"}} onClick={()=>setOffSub(s)}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>)}
      </div>}
      {/* Stats */}
      <div style={{background:"#fff",border:"1px solid #eee",borderRadius:2,padding:"4px 14px"}}>
        {cat==="offense"&&offSub==="passing"&&<>
          <StatRow label="Completions" val={p.comp}/>
          <StatRow label="Attempts" val={p.att}/>
          <StatRow label="Completion %" val={compPct==="-"?"-":compPct+"%"}/>
          <StatRow label="Passing TDs" val={p.tds}/>
          <StatRow label="Interceptions" val={p.int||0}/>
          <StatRow label="Passing Yards" val={p.yds.toLocaleString()}/>
          <StatRow label="Yards Per Completion" val={ypassComp}/>
        </>}
        {cat==="offense"&&offSub==="rushing"&&<>
          <StatRow label="Rushing Attempts" val={ru.att}/>
          <StatRow label="Rushing Yards" val={ru.yds.toLocaleString()}/>
          <StatRow label="Rushing Touchdowns" val={ru.tds}/>
          <StatRow label="Rushing YPC" val={ypc}/>
        </>}
        {cat==="offense"&&offSub==="receiving"&&<>
          <StatRow label="Receptions" val={re.rec}/>
          <StatRow label="Receiving Yards" val={re.yds.toLocaleString()}/>
          <StatRow label="Receiving Touchdowns" val={re.tds}/>
          <StatRow label="Yards Per Reception" val={ypr}/>
        </>}
        {cat==="defense"&&<>
          <StatRow label="Interceptions" val={d.int}/>
          <StatRow label="Fumble Recoveries" val={d.fum}/>
          <StatRow label="Sacks" val={d.sacks}/>
          <StatRow label="Defensive TDs" val={d.tds}/>
        </>}
        {cat==="specialTeams"&&<>
          <StatRow label="Field Goals Made" val={`${st.fgMade}/${st.fgAtt}`}/>
          <StatRow label="Field Goal %" val={fgPct==="-"?"-":fgPct+"%"}/>
          <StatRow label="Punts" val={st.punts}/>
          <StatRow label="Punting Yards" val={st.puntYds.toLocaleString()}/>
          <StatRow label="Punt Average" val={puntAvg}/>
          <StatRow label="Punts Inside 20" val={st.puntsIn20}/>
        </>}
        {cat==="team"&&<>
          <StatRow label="Offensive Points Per Game" val={offPPG}/>
          <StatRow label="Defensive Points Per Game" val={defPPG}/>
          <StatRow label="Offensive Yards" val={t.offYds.toLocaleString()}/>
          <StatRow label="Defensive Yards" val={t.defYds.toLocaleString()}/>
          <StatRow label="Takeaways" val={t.takeaways}/>
          <StatRow label="Giveaways" val={t.giveaways}/>
          <StatRow label="Turnover Differential" val={toDiffStr}/>
          <StatRow label="3rd Down Conversion %" val={thirdPct==="-"?"-":thirdPct+"%"}/>
          <StatRow label="4th Down Attempts" val={t.fourthAtt}/>
          <StatRow label="4th Down Conversion %" val={fourthPct==="-"?"-":fourthPct+"%"}/>
          <StatRow label="2 Point Attempts" val={t.twoPtAtt}/>
          <StatRow label="2 Point Conversion %" val={twoPtPct==="-"?"-":twoPtPct+"%"}/>
          <StatRow label="Offensive Redzone %" val={offRZPct==="-"?"-":offRZPct+"%"}/>
          <StatRow label="Defensive Redzone %" val={defRZPct==="-"?"-":defRZPct+"%"}/>
        </>}
        {cat==="misc"&&<>
          <StatRow label="Halftime Lead Record" val={`${qStats.leadHalfW}-${qStats.leadHalfL}`}/>
          <StatRow label="Halftime Trail Record" val={`${qStats.trailHalfW}-${qStats.trailHalfL}`}/>
          <StatRow label="4th Quarter Comeback Wins" val={qStats.fourthQComebacks}/>
          <StatRow label="Biggest Comeback Win" val={qStats.biggestComeback?`${qStats.biggestComeback.deficit} PT DEFICIT`:"-"} sub={qStats.biggestComeback?`${qStats.biggestComeback.score} vs ${qStats.biggestComeback.opponent} · ${qStats.biggestComeback.year}`:undefined}/>
          <StatRow label="Biggest 4th Quarter Comeback" val={qStats.biggest4thQComeback?`${qStats.biggest4thQComeback.deficit} PT DEFICIT`:"-"} sub={qStats.biggest4thQComeback?`${qStats.biggest4thQComeback.score} vs ${qStats.biggest4thQComeback.opponent} · ${qStats.biggest4thQComeback.year}`:undefined}/>
          <StatRow label="Most Points In A Quarter" val={qStats.mostQuarterPts?`${qStats.mostQuarterPts.pts} PTS (Q${qStats.mostQuarterPts.quarter})`:"-"} sub={qStats.mostQuarterPts?`vs ${qStats.mostQuarterPts.opponent} · ${qStats.mostQuarterPts.year}`:undefined}/>
          <StatRow label="Avg Q1 Points" val={avgQ(0)}/>
          <StatRow label="Avg Q2 Points" val={avgQ(1)}/>
          <StatRow label="Avg Q3 Points" val={avgQ(2)}/>
          <StatRow label="Avg Q4 Points" val={avgQ(3)}/>
          <StatRow label="Avg Q1 Points Allowed" val={avgQAllowed(0)}/>
          <StatRow label="Avg Q2 Points Allowed" val={avgQAllowed(1)}/>
          <StatRow label="Avg Q3 Points Allowed" val={avgQAllowed(2)}/>
          <StatRow label="Avg Q4 Points Allowed" val={avgQAllowed(3)}/>
        </>}
      </div>
    </div>
  );
}

// ── PlayerStatsAdmin ──────────────────────────────────────────────────────
function PlayerStatsAdmin({setup, setSetup, saveToDb, permanentUsers, year, ff, RED}) {
  const [selUser, setSelUser] = useState(permanentUsers?.[0]?.id||"");
  const [selYear, setSelYear] = useState(year||2026);
  const [saved, setSaved] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState("");
  const [preview, setPreview] = useState(null);
  const [edits, setEdits] = useState({});
  const fileRef = useRef();
  const userStats = setup?.playerStats?.[selUser]?.[selYear]||EMPTY_STATS();
  useEffect(()=>{setEdits({});setPreview(null);setParseErr("");},[selUser,selYear]);
  function getVal(cat,field){return edits?.[cat]?.[field]??userStats[cat]?.[field]??0;}
  function setVal(cat,field,val){setEdits(p=>({...p,[cat]:{...p[cat],[field]:val===""?"":isNaN(Number(val))?p[cat]?.[field]??0:Number(val)}}));}
  async function handleImage(e){
    const file=e.target.files?.[0];if(!file)return;
    if(!window.confirm("Scan this image for stats?\n\nThis will use the Claude Vision API.")) { if(fileRef.current)fileRef.current.value=""; return; }
    setParseErr("");setParsing(true);setPreview(URL.createObjectURL(file));
    try{
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
      const prompt=`This is a screenshot of college football video game season stats. Extract ALL visible stats and return ONLY a JSON object with this exact structure (use 0 for any stat not visible):
{"passing":{"att":0,"comp":0,"yds":0,"tds":0},"rushing":{"att":0,"yds":0,"tds":0},"receiving":{"rec":0,"yds":0,"tds":0},"defense":{"int":0,"fum":0,"sacks":0,"tds":0},"specialTeams":{"fgAtt":0,"fgMade":0,"punts":0,"puntYds":0,"puntsIn20":0},"team":{"games":0,"offPts":0,"defPts":0,"offYds":0,"defYds":0,"giveaways":0,"takeaways":0,"thirdConv":0,"thirdAtt":0,"fourthConv":0,"fourthAtt":0,"twoPtConv":0,"twoPtAtt":0,"offRedZonePct":0,"defRedZonePct":0}}
Return only the JSON, no explanation. Map what you see: passing yards→passing.yds, passing TDs→passing.tds, completions→passing.comp, attempts→passing.att, rushing yards→rushing.yds, rushing TDs→rushing.tds, rushing attempts→rushing.att, receptions→receiving.rec, receiving yards→receiving.yds, receiving TDs→receiving.tds, interceptions→defense.int, fumbles recovered→defense.fum, sacks→defense.sacks, defensive TDs→defense.tds, field goals made→specialTeams.fgMade, field goals attempted→specialTeams.fgAtt, punts→specialTeams.punts, punting yards→specialTeams.puntYds, punts inside 20→specialTeams.puntsIn20, games played→team.games, points scored→team.offPts, points allowed→team.defPts, total offensive yards→team.offYds, total yards allowed→team.defYds, giveaways/turnovers lost→team.giveaways, takeaways/turnovers gained→team.takeaways, 3rd down conversions→team.thirdConv, 3rd down attempts→team.thirdAtt, 4th down conversions→team.fourthConv, 4th down attempts→team.fourthAtt, 2-point conversions→team.twoPtConv, 2-point attempts→team.twoPtAtt, offensive red zone %→team.offRedZonePct, defensive red zone % (allowed)→team.defRedZonePct.`;
      const text=await callClaudeVision(b64,file.type,prompt);
      const json=JSON.parse(text.replace(/```json?|```/g,"").trim());
      setEdits(json);
    }catch(err){setParseErr("Could not parse stats: "+err.message);}
    finally{setParsing(false);if(fileRef.current)fileRef.current.value="";}
  }
  function saveStats(){
    const merged={...EMPTY_STATS()};
    Object.entries({...userStats,...edits}).forEach(([cat,fields])=>{if(merged[cat])merged[cat]={...merged[cat],...Object.fromEntries(Object.entries(fields).map(([k,v])=>([k,Number(v)||0])))};});
    const updated={...setup,playerStats:{...(setup?.playerStats||{}),[selUser]:{...(setup?.playerStats?.[selUser]||{}),[selYear]:merged}}};
    setSetup(updated);saveToDb({setup:updated});setSaved(true);setTimeout(()=>setSaved(false),2000);
  }
  // recomputePlayerStatsFromArchive only ever touches the single year a box score was just
  // scanned into — years archived before a stat category (e.g. Team Stats) existed never get
  // backfilled automatically, so this walks every year in the archive and rebuilds all of them.
  const [rebuilding, setRebuilding] = useState(false);
  function rebuildFromArchive(){
    const archive=setup?.gameArchive||[];
    const years=[...new Set(archive.map(g=>g.year))];
    if(!years.length){window.alert("No archived box scores found.");return;}
    if(!window.confirm(`Rebuild player/team stats for ${years.length} season(s) from the game archive? This overwrites any manually-entered stats for years that have archived box scores.`))return;
    setRebuilding(true);
    let ps=setup?.playerStats||{};
    years.forEach(y=>{ps=recomputePlayerStatsFromArchive(archive,ps,y);});
    const updated={...setup,playerStats:ps};
    setSetup(updated);saveToDb({setup:updated});setRebuilding(false);
  }
  const inp=(cat,field,label)=>(
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <label style={{fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,fontFamily:ff}}>{label}</label>
      <input type="number" min="0" value={getVal(cat,field)} onChange={e=>setVal(cat,field,e.target.value)} style={{padding:"7px 10px",border:"1px solid #ddd",borderRadius:2,fontFamily:ff,fontSize:13,color:"#111",width:"100%",boxSizing:"border-box"}}/>
    </div>
  );
  const yearOpts=[];for(let y=2020;y<=2035;y++)yearOpts.push(y);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <select value={selUser} onChange={e=>setSelUser(e.target.value)} style={{padding:"7px 10px",border:"1px solid #ccc",borderRadius:2,fontFamily:ff,fontSize:13,flex:1}}>
          {(permanentUsers||[]).map(u=><option key={u.id} value={u.id}>{u.defaultName}</option>)}
        </select>
        <select value={selYear} onChange={e=>setSelYear(Number(e.target.value))} style={{padding:"7px 10px",border:"1px solid #ccc",borderRadius:2,fontFamily:ff,fontSize:13,width:90}}>
          {yearOpts.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={rebuildFromArchive} disabled={rebuilding} style={{padding:"7px 14px",background:rebuilding?"#888":"#1a3a6b",color:"#fff",border:"none",borderRadius:2,cursor:rebuilding?"not-allowed":"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase"}}>{rebuilding?"Rebuilding…":"↻ Rebuild From Game Archive"}</button>
      </div>
      {/* Screenshot upload */}
      <Card>
        <CardHead bg="#1a3a6b">Import from Screenshot</CardHead>
        <div style={{padding:"14px"}}>
          <div style={{fontSize:12,color:"#666",marginBottom:10}}>Take a screenshot of the end-of-season stats screen in CFB 27 and upload it. AI will read and fill in the stats automatically.</div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{display:"none"}} id="stats-img-upload"/>
          <label htmlFor="stats-img-upload" style={{display:"inline-block",background:parsing?"#888":RED,color:"#fff",borderRadius:2,padding:"9px 18px",cursor:parsing?"not-allowed":"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase"}}>
            {parsing?"Parsing Stats...":"Upload Screenshot"}
          </label>
          {parseErr&&<div style={{marginTop:8,fontSize:12,color:RED,fontWeight:600}}>{parseErr}</div>}
          {preview&&<img src={preview} alt="uploaded" style={{marginTop:10,maxWidth:"100%",maxHeight:200,objectFit:"contain",borderRadius:2,border:"1px solid #eee"}}/>}
          {Object.keys(edits).length>0&&!parsing&&<div style={{marginTop:8,fontSize:12,color:"#007a00",fontWeight:700}}>✓ Stats parsed — review below and save</div>}
        </div>
      </Card>
      <Card><CardHead bg="#1a3a6b">Passing</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("passing","yds","Pass Yards")}{inp("passing","tds","Pass TDs")}{inp("passing","int","Interceptions")}{inp("passing","att","Attempts")}{inp("passing","comp","Completions")}
        </div>
      </Card>
      <Card><CardHead bg="#1a3a6b">Rushing</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("rushing","att","Attempts")}{inp("rushing","yds","Rush Yards")}{inp("rushing","tds","Rush TDs")}{inp("rushing","fum","Fumbles")}
        </div>
      </Card>
      <Card><CardHead bg="#1a3a6b">Receiving</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("receiving","yds","Rec Yards")}{inp("receiving","tds","Rec TDs")}{inp("receiving","rec","Receptions")}
        </div>
      </Card>
      <Card><CardHead bg="#333">Defense</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("defense","int","Interceptions")}{inp("defense","fum","Fumble Rec")}{inp("defense","sacks","Sacks")}{inp("defense","tds","Def TDs")}
        </div>
      </Card>
      <Card><CardHead bg="#333">Special Teams</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("specialTeams","fgMade","FG Made")}{inp("specialTeams","fgAtt","FG Attempted")}{inp("specialTeams","punts","Punts")}{inp("specialTeams","puntYds","Punt Yards")}{inp("specialTeams","puntsIn20","Punts Inside 20")}
        </div>
      </Card>
      <Card><CardHead bg="#111">Team Stats</CardHead>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,padding:"12px 14px"}}>
          {inp("team","games","Games Played")}{inp("team","offPts","Points Scored")}{inp("team","defPts","Points Allowed")}{inp("team","offYds","Offensive Yards")}{inp("team","defYds","Defensive Yards")}{inp("team","giveaways","Giveaways")}{inp("team","takeaways","Takeaways")}{inp("team","thirdConv","3rd Down Conv")}{inp("team","thirdAtt","3rd Down Att")}{inp("team","fourthConv","4th Down Conv")}{inp("team","fourthAtt","4th Down Att")}{inp("team","twoPtConv","2pt Conv")}{inp("team","twoPtAtt","2pt Att")}{inp("team","offRedZonePct","Off Redzone %")}{inp("team","defRedZonePct","Def Redzone %")}
        </div>
      </Card>
      <button onClick={saveStats} style={{background:saved?"#007a00":RED,color:"#fff",border:"none",borderRadius:2,padding:"10px 20px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>{saved?"✓ Saved":"Save Stats"}</button>
    </div>
  );
}
function TeamLogo({url, size=20, style={}}) {
  if (!url) return null;
  return <img src={url} alt="" style={{width:size,height:size,objectFit:"contain",borderRadius:2,flexShrink:0,...style}} onError={e=>{e.target.style.display="none";}}/>;
}

// ── Dynasty Redzone ───────────────────────────────────────────────────────
function getEmbedUrl(url) {
  if (!url) return null;
  const twitchMatch = url.match(/twitch\.tv\/([^/?#\s]+)/i);
  if (twitchMatch) {
    const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${parent}&autoplay=true`;
  }
  const ytWatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (ytWatch) return `https://www.youtube.com/embed/${ytWatch[1]}?autoplay=1&rel=0`;
  const ytLive = url.match(/youtube\.com\/live\/([A-Za-z0-9_-]{11})/);
  if (ytLive) return `https://www.youtube.com/embed/${ytLive[1]}?autoplay=1&rel=0`;
  const ytEmbed = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytEmbed) return url;
  const ytShort = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}?autoplay=1&rel=0`;
  return null;
}
function getPlatform(url) {
  if (!url) return null;
  if (/twitch\.tv/i.test(url)) return "twitch";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return null;
}
function toYouTubeChannelLiveUrl(url) {
  if (!url) return null;
  const handle = url.match(/youtube\.com\/@([^/?#\s]+)/i);
  if (handle) return `https://www.youtube.com/@${handle[1]}/live`;
  const channel = url.match(/youtube\.com\/channel\/([^/?#\s]+)/i);
  if (channel) return `https://www.youtube.com/channel/${channel[1]}/live`;
  const custom = url.match(/youtube\.com\/c\/([^/?#\s]+)/i);
  if (custom) return `https://www.youtube.com/c/${custom[1]}/live`;
  return null;
}

function DynastyRedzone({setup,entries,setTab,autoLiveStatuses,autoEmbedUrls,schedule,week}) {
  const isMobile = useIsMobile();
  const [shareCopied,setShareCopied] = useState(false);
  async function shareRedzone() {
    const shareUrl = `${window.location.origin}/redzone`;
    if (navigator.share) {
      try { await navigator.share({title:"Dynasty RedZone — Watch Live Now", url:shareUrl}); } catch(e) { /* user dismissed the share sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(()=>setShareCopied(false),2000);
    } catch(e) {
      window.prompt("Copy this link to share:", shareUrl);
    }
  }
  const streamLinks = setup?.streamLinks || {};
  const rows = setup?.rows || [];
  const liveStreams = rows.filter(r => {
    const key = r.userId || r.userName;
    const s = streamLinks[key];
    if (!s?.url) return false;
    // Auto-detected status takes precedence; fall back to manual toggle
    const live = key in (autoLiveStatuses||{}) ? autoLiveStatuses[key] : s.isLive;
    const embedUrl = (autoEmbedUrls||{})[key] || getEmbedUrl(s.url);
    return live && embedUrl;
  }).map(r => {
    const key = r.userId || r.userName;
    const s = streamLinks[key];
    const embedUrl = (autoEmbedUrls||{})[key] || getEmbedUrl(s.url);
    const opponent = (schedule||{})[week]?.[r.teamName];
    const matchup = opponent && opponent !== "BYE" ? `${r.teamName} vs ${formatOpp(opponent)}` : r.teamName;
    return { key, userName: r.userName, teamName: r.teamName, url: s.url, embedUrl, platform: getPlatform(s.url), matchup };
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = Math.min(activeIdx, liveStreams.length - 1);
  const active = liveStreams[safeIdx];

  useEffect(()=>{ setActiveIdx(0); },[liveStreams.length]);

  function switchTo(i) { setActiveIdx(i); }

  if (liveStreams.length === 0) {
    const checking = Object.keys(autoLiveStatuses||{}).length === 0 && (setup?.rows||[]).some(r=>streamLinks[r.userId||r.userName]?.url);
    return (
      <div style={{background:"#0a0a0a",borderRadius:4,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",gap:16}}>
          <img src="/redzone-tv.png" alt="Dynasty RedZone TV" style={{width:"100%",maxWidth:420,objectFit:"contain"}}/>
          <div style={{fontSize:isMobile?13:15,fontWeight:700,color:"rgba(255,255,255,0.55)",textAlign:"center",maxWidth:340,marginTop:4}}>
            {checking?"Detecting live streams from configured channels…":"Dynasty RedZone goes live when league members are streaming. Check back when games are in progress."}
          </div>
          {checking&&<div style={{fontSize:12,color:"#cc0000",fontWeight:800,letterSpacing:1,textTransform:"uppercase",animation:"pulse 1.5s ease-in-out infinite"}}>● Checking Streams…</div>}
          <button onClick={shareRedzone} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.3)",color:"rgba(255,255,255,0.8)",borderRadius:2,padding:"6px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Helvetica Neue',Arial,sans-serif",textTransform:"uppercase",letterSpacing:0.5}}>{shareCopied?"✓ Link Copied":"⤴ Share RedZone"}</button>
        </div>
        <RedzoneVoice/>
        <RedzoneChat setupRows={setup?.rows}/>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:0,background:"#0a0a0a",minHeight:400,borderRadius:4,overflow:"hidden"}}>
      {/* Header bar */}
      <div style={{background:"linear-gradient(135deg,#1a0000,#0a0a0a)",padding:"8px 16px",display:"flex",alignItems:"center",gap:12,borderBottom:"2px solid #cc0000"}}>
        <img src="/redzone-tv.png" alt="Dynasty RedZone TV" style={{height:isMobile?40:52,width:"auto",objectFit:"contain",flexShrink:0}}/>
        <div style={{flex:1}}/>
        <button onClick={shareRedzone} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.3)",color:"rgba(255,255,255,0.8)",borderRadius:2,padding:"6px 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Helvetica Neue',Arial,sans-serif",textTransform:"uppercase",letterSpacing:0.5,flexShrink:0}}>{shareCopied?"✓ Copied":"⤴ Share"}</button>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
          <div style={{background:"#cc0000",borderRadius:3,padding:"2px 8px",fontSize:10,fontWeight:900,color:"#fff",letterSpacing:1.5}}>● LIVE</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{liveStreams.length} game{liveStreams.length>1?"s":""} live</div>
        </div>
      </div>
      {/* Main player — all iframes stay mounted so cast sessions survive game switches */}
      <div style={{position:"relative",width:"100%",paddingTop:"56.25%",background:"#000"}}>
        {liveStreams.map((s,i)=>(
          <div key={s.key} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:i===safeIdx?"block":"none"}}>
            <iframe
              src={s.embedUrl}
              style={{width:"100%",height:"100%",border:"none"}}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
            />
          </div>
        ))}
        {/* Overlay label — desktop only, hidden on mobile to keep video clear */}
        {active&&!isMobile&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,0.85))",padding:"24px 16px 12px",pointerEvents:"none"}}>
          <div style={{fontSize:11,color:"#ff6666",fontWeight:800,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{active.platform==="twitch"?"🟣 Twitch":"🔴 YouTube"} · {active.userName}</div>
          <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>{active.matchup}</div>
        </div>}
      </div>
      {/* Mobile: slim now-watching bar below video */}
      {active&&isMobile&&<div style={{background:"#1a0000",borderBottom:"1px solid #330000",padding:"7px 12px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{background:"#cc0000",borderRadius:2,padding:"2px 6px",fontSize:9,fontWeight:900,color:"#fff",letterSpacing:1,flexShrink:0}}>● LIVE</div>
        <div style={{fontSize:11,fontWeight:800,color:"#fff",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{active.matchup}</div>
        <div style={{fontSize:10,color:"#888",flexShrink:0}}>{active.platform==="twitch"?"🟣":"🔴"} {active.userName}</div>
      </div>}
      {/* Game switcher */}
      {liveStreams.length > 1 && (
        <div style={{background:"#111",padding:"10px 12px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",letterSpacing:1.5}}>Switch Game</div>
            {!isMobile&&<div style={{fontSize:10,color:"#555",fontStyle:"italic"}}>📺 Cast via the player controls · switching won't interrupt your cast</div>}
          </div>
          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
            {liveStreams.map((s, i) => (
              <button key={i} onClick={() => switchTo(i)} style={{background:activeIdx===i?"#cc0000":"#1e1e1e",border:activeIdx===i?"2px solid #ff4444":"2px solid #333",borderRadius:3,padding:"8px 14px",cursor:"pointer",fontFamily:ff,minWidth:isMobile?130:160,textAlign:"left",flexShrink:0}}>
                <div style={{fontSize:10,color:activeIdx===i?"#ffaaaa":"#888",fontWeight:800,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>CH {i+1} — {s.userName}</div>
                <div style={{fontSize:12,fontWeight:800,color:activeIdx===i?"#fff":"#aaa",lineHeight:1.3}}>{s.matchup}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      <RedzoneVoice/>
      <RedzoneChat setupRows={setup?.rows}/>
    </div>
  );
}

// ── RedZone Voice ─────────────────────────────────────────────────────────
function RedzoneVoice() {
  const ff = "'Helvetica Neue',Arial,sans-serif";
  return (
    <div style={{background:"#0a0a0a",borderTop:"2px solid #1a1a1a",padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:900,color:"#fff",textTransform:"uppercase",letterSpacing:1.5}}>🎙️ Voice Chat</div>
        <div style={{fontSize:10,color:"#555",marginTop:2}}>Join the league voice channel on Discord</div>
      </div>
      <a href="https://discord.com/channels/1400879892614217728/1400879894396801088" target="_blank" rel="noopener noreferrer" style={{background:"#5865F2",color:"#fff",border:"none",borderRadius:3,padding:"8px 18px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800,flexShrink:0,textDecoration:"none",display:"inline-block"}}>Join Discord</a>
    </div>
  );
}

// ── RedZone Chat ─────────────────────────────────────────────────────────
const CHAT_URL = `${SUPA_URL}/rest/v1/chat_messages`;
async function chatFetch() {
  const r = await fetch(`${CHAT_URL}?league_id=eq.main&order=created_at.asc&limit=200`, {headers: SUPA_HEADERS});
  if (!r.ok) return null;
  return r.json();
}
async function chatPost(userName, message) {
  return fetch(CHAT_URL, {
    method: "POST",
    headers: {...SUPA_HEADERS, "Prefer": "return=minimal"},
    body: JSON.stringify({league_id: "main", user_name: userName, message}),
  });
}

function RedzoneChat({setupRows}) {
  const isMobile = useIsMobile();
  const ff = "'Helvetica Neue',Arial,sans-serif";
  const RED = "#cc0000";
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [chatName, setChatName] = useState(()=>localStorage.getItem("rz_chat_name")||"");
  const [nameInput, setNameInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const isAtBottomRef = useRef(true);

  useEffect(()=>{
    let cancelled = false;
    async function load() {
      const msgs = await chatFetch();
      if (cancelled) return;
      if (msgs === null) { setError("Chat unavailable — table not set up yet."); return; }
      setMessages(msgs);
      setReady(true);
    }
    load();
    const iv = setInterval(async ()=>{
      const msgs = await chatFetch();
      if (cancelled || msgs === null) return;
      setMessages(prev => {
        if (msgs.length === prev.length) return prev;
        // Only auto-scroll if user was already at bottom
        setTimeout(()=>{ if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, 50);
        return msgs;
      });
    }, 3000);
    return ()=>{ cancelled=true; clearInterval(iv); };
  }, []);

  useEffect(()=>{
    if (ready) bottomRef.current?.scrollIntoView({behavior:"instant"});
  }, [ready]);

  function handleScroll(e) {
    const el = e.currentTarget;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  function saveName() {
    const n = nameInput.trim();
    if (!n) return;
    localStorage.setItem("rz_chat_name", n);
    setChatName(n);
    setNameInput("");
  }

  async function send() {
    if (!text.trim() || !chatName || sending) return;
    setSending(true);
    const msg = text.trim();
    setText("");
    const r = await chatPost(chatName, msg);
    if (!r.ok) { setText(msg); }
    else {
      const msgs = await chatFetch();
      if (msgs) { setMessages(msgs); setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),50); }
    }
    setSending(false);
  }

  function handleKey(e) { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); send(); } }

  const colors = ["#cc0000","#1a6bb5","#007a00","#8a2be2","#cc7700","#006666","#aa0066"];
  function nameColor(name) { let h=0; for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0; return colors[h%colors.length]; }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  }

  return (
    <div style={{background:"#0d0d0d",borderTop:"2px solid #1a1a1a",display:"flex",flexDirection:"column"}}>
      {/* Chat header */}
      <div style={{background:"#111",padding:"8px 14px",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #222"}}>
        <div style={{fontSize:11,fontWeight:900,color:"#fff",textTransform:"uppercase",letterSpacing:1.5}}>💬 League Chat</div>
        {chatName&&<div style={{fontSize:10,color:"#555"}}>Chatting as <span style={{color:nameColor(chatName),fontWeight:700}}>{chatName}</span> · <span onClick={()=>{setChatName("");localStorage.removeItem("rz_chat_name");}} style={{color:"#555",cursor:"pointer",textDecoration:"underline"}}>change</span></div>}
        <div style={{flex:1}}/>
        {messages.length>0&&<div style={{fontSize:10,color:"#444"}}>{messages.length} messages</div>}
      </div>

      {error ? (
        <div style={{padding:"20px",textAlign:"center",color:"#666",fontSize:12}}>{error}</div>
      ) : !chatName ? (
        /* Name picker */
        <div style={{padding:"16px 14px",display:"flex",flexDirection:"column",gap:10,alignItems:"center"}}>
          <div style={{fontSize:13,color:"#aaa",fontWeight:600}}>Enter your name to join the chat</div>
          <div style={{display:"flex",gap:8,width:"100%",maxWidth:340}}>
            <input
              value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&saveName()}
              placeholder="Your name…" autoFocus
              style={{flex:1,background:"#1a1a1a",border:"1px solid #333",borderRadius:3,padding:"9px 12px",fontSize:13,fontFamily:ff,color:"#fff",outline:"none"}}
            />
            <button onClick={saveName} disabled={!nameInput.trim()} style={{background:nameInput.trim()?RED:"#333",color:"#fff",border:"none",borderRadius:3,padding:"9px 16px",cursor:nameInput.trim()?"pointer":"default",fontFamily:ff,fontSize:13,fontWeight:800}}>Join</button>
          </div>
          <div style={{fontSize:11,color:"#444"}}>You can use any name — pick something your league knows you by</div>
        </div>
      ) : (
        <>
          {/* Message list */}
          <div ref={listRef} onScroll={handleScroll} style={{height:isMobile?220:280,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:6,scrollbarWidth:"thin",scrollbarColor:"#333 transparent"}}>
            {messages.length===0&&ready&&<div style={{textAlign:"center",color:"#444",fontSize:12,marginTop:40}}>No messages yet. Say something! 🏈</div>}
            {messages.map((m,i)=>{
              const isMine = m.user_name===chatName;
              const showName = i===0||messages[i-1].user_name!==m.user_name;
              return(
                <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isMine?"flex-end":"flex-start",gap:1}}>
                  {showName&&<div style={{fontSize:10,fontWeight:700,color:nameColor(m.user_name),marginBottom:1,paddingLeft:isMine?0:4,paddingRight:isMine?4:0}}>{m.user_name}</div>}
                  <div style={{display:"flex",alignItems:"flex-end",gap:5,flexDirection:isMine?"row-reverse":"row"}}>
                    <div style={{background:isMine?"#7a0000":"#1e1e1e",borderRadius:isMine?"12px 12px 2px 12px":"12px 12px 12px 2px",padding:"7px 11px",maxWidth:"78%",wordBreak:"break-word"}}>
                      <div style={{fontSize:13,color:isMine?"#fff":"#ddd",lineHeight:1.4}}>{m.message}</div>
                    </div>
                    <div style={{fontSize:9,color:"#444",flexShrink:0}}>{formatTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          <div style={{padding:"8px 10px",borderTop:"1px solid #1a1a1a",display:"flex",gap:8,alignItems:"flex-end"}}>
            <input
              value={text} onChange={e=>setText(e.target.value)} onKeyDown={handleKey}
              placeholder="Message…" maxLength={500}
              style={{flex:1,background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:20,padding:"9px 14px",fontSize:13,fontFamily:ff,color:"#fff",outline:"none",resize:"none"}}
            />
            <button onClick={send} disabled={!text.trim()||sending} style={{background:text.trim()&&!sending?RED:"#333",color:"#fff",border:"none",borderRadius:20,padding:"9px 16px",cursor:text.trim()&&!sending?"pointer":"default",fontFamily:ff,fontSize:13,fontWeight:800,flexShrink:0,whiteSpace:"nowrap"}}>
              {sending?"…":"Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Discord Tab ───────────────────────────────────────────────────────────
function DiscordTab() {
  const isMobile = useIsMobile();
  const ff = "'Helvetica Neue',Arial,sans-serif";
  const DISCORD = "#5865F2";
  const DISCORD_URL = "https://discord.com/channels/1400879892614217728/1400879894396801088";

  const Step = ({n, text}) => (
    <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
      <div style={{width:24,height:24,borderRadius:"50%",background:DISCORD,color:"#fff",fontWeight:900,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{n}</div>
      <div style={{fontSize:13,color:"#333",lineHeight:1.6,flex:1}}>{text}</div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:700}}>
      {/* Join card */}
      <div style={{background:"linear-gradient(135deg,#5865F2,#404EED)",borderRadius:4,padding:isMobile?"20px 18px":"28px 32px",display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"flex-start":"center",gap:20}}>
        <div style={{flex:1}}>
          <div style={{fontSize:isMobile?20:26,fontWeight:900,color:"#fff",marginBottom:6}}>Join the League Discord</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.75)",lineHeight:1.5}}>Jump into the voice channel to talk trash, call plays, and hang with the league while games are live.</div>
        </div>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" style={{background:"#fff",color:DISCORD,borderRadius:3,padding:"12px 28px",fontFamily:ff,fontSize:14,fontWeight:900,textDecoration:"none",flexShrink:0,display:"inline-block",textAlign:"center"}}>🎙️ Join Voice Channel</a>
      </div>

      {/* PlayStation guide */}
      <div style={{background:"#fff",border:"1px solid #e5e5e5",borderRadius:4,overflow:"hidden"}}>
        <div style={{background:"#003087",padding:"12px 18px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:20}}>🎮</div>
          <div style={{fontSize:14,fontWeight:900,color:"#fff",letterSpacing:0.5}}>Link Discord to PlayStation</div>
        </div>
        <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:12}}>
          <Step n="1" text={<>On your PS5, go to <strong>Settings</strong> → <strong>Users and Accounts</strong> → <strong>Linked Services</strong>.</>}/>
          <Step n="2" text={<>Select <strong>Discord</strong> and choose <strong>Link Account</strong>.</>}/>
          <Step n="3" text={<>A code will appear on your TV. Open the <strong>Discord app</strong> on your phone → tap your profile picture → <strong>Connections</strong> → <strong>Connect to PlayStation</strong> → enter the code.</>}/>
          <Step n="4" text={<>Once linked, open the Discord app, join the league voice channel, then tap <strong>Transfer to PlayStation</strong> to move the call to your PS5.</>}/>
          <div style={{background:"#f0f4ff",border:"1px solid #c5d0f5",borderRadius:3,padding:"10px 14px",fontSize:12,color:"#444",marginTop:4}}>
            💡 <strong>Tip:</strong> You can also start voice chat directly from the PS5 Control Center — swipe down, select the Discord icon, and join any channel without touching your phone.
          </div>
        </div>
      </div>

      {/* Xbox guide */}
      <div style={{background:"#fff",border:"1px solid #e5e5e5",borderRadius:4,overflow:"hidden"}}>
        <div style={{background:"#107C10",padding:"12px 18px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:20}}>🎮</div>
          <div style={{fontSize:14,fontWeight:900,color:"#fff",letterSpacing:0.5}}>Link Discord to Xbox</div>
        </div>
        <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:12}}>
          <Step n="1" text={<>Open the <strong>Discord app</strong> on your phone or PC and go to <strong>User Settings</strong> → <strong>Connections</strong>.</>}/>
          <Step n="2" text={<>Tap <strong>Xbox</strong> and sign in with your Microsoft account to link the two accounts.</>}/>
          <Step n="3" text={<>On your Xbox, press the <strong>Xbox button</strong> to open the guide, go to <strong>Parties &amp; chats</strong>.</>}/>
          <Step n="4" text={<>Select <strong>Discord Voice</strong>, pick the league voice channel, and join. Your voice chat will now run through Discord on your Xbox.</>}/>
          <div style={{background:"#f0fff0",border:"1px solid #b0ddb0",borderRadius:3,padding:"10px 14px",fontSize:12,color:"#444",marginTop:4}}>
            💡 <strong>Tip:</strong> Xbox displays Discord voice activity on your profile so other league members can see when you're in the channel gaming.
          </div>
        </div>
      </div>

      {/* Mobile note */}
      <div style={{background:"#fafafa",border:"1px solid #eee",borderRadius:4,padding:"14px 18px",display:"flex",gap:12,alignItems:"flex-start"}}>
        <div style={{fontSize:20,flexShrink:0}}>📱</div>
        <div>
          <div style={{fontSize:13,fontWeight:800,color:"#111",marginBottom:4}}>On Mobile?</div>
          <div style={{fontSize:12,color:"#555",lineHeight:1.6}}>Just tap <strong>Join Voice Channel</strong> above — it opens directly in the Discord app. Make sure you have Discord installed on your phone.</div>
        </div>
      </div>
    </div>
  );
}

// ── SetupPanel ────────────────────────────────────────────────────────────
function SetupPanel({entries,setup,postSeasonInputs,setPSI,handleStart,setCommissionerUnlocked,season,year,setEntries,setWeekResults,setSetup,saveToDb,history,setHistory,autoLiveStatuses,autoEmbedUrls}) {
  const [setupRows,setSetupRows] = useState(setup?.rows?.length?setup.rows.map(r=>({userId:r.userId||"",userName:r.userName,teamName:r.teamName,aliases:r.aliases||""})):Array.from({length:4},()=>({userId:"",userName:"",teamName:"",aliases:""})));
  const skipRowsSync = useRef(false);
  useEffect(()=>{if(skipRowsSync.current){skipRowsSync.current=false;return;}if(setup?.rows?.length)setSetupRows(setup.rows.map(r=>({userId:r.userId||"",userName:r.userName,teamName:r.teamName,aliases:r.aliases||""})));},[setup?.rows]);
  const [setupLeague,setSetupLeague] = useState(setup?.leagueName||"");
  const [rosterSeason,setRosterSeason] = useState(season+1);
  const [rosterEdits,setRosterEdits] = useState({});
  const [rosterSaved,setRosterSaved] = useState(false);
  const [rosterRows,setRosterRows] = useState(null); // null = not yet initialized for current season
  const [newRosterCoach,setNewRosterCoach] = useState("");
  const [newRosterTeam,setNewRosterTeam] = useState("");
  const [ptsSaved,setPtsSaved] = useState(false);
  const [ptsEdit,setPtsEdit] = useState(null); // null = closed, object = editing
  function openPtsEditor(){const base={...DEFAULT_PTS_CONFIG,...(setup?.pointsConfig||{})};if(!base.customCategories)base.customCategories=[];setPtsEdit(base);setPtsSaved(false);}
  function savePtsConfig(){const updated={...setup,pointsConfig:ptsEdit};setSetup(updated);saveToDb({setup:updated});setPtsSaved(true);setTimeout(()=>setPtsSaved(false),2000);}
  function setPE(key,val){setPtsEdit(p=>({...p,[key]:val}));}
  function deletePtsCat(cat){if(cat.items){const p={};cat.items.forEach(it=>{p[it.k]=0;});setPtsEdit(prev=>({...prev,...p}));}else setPtsEdit(prev=>({...prev,[cat.arrayKey]:[]}));}
  function restorePtsCat(cat){if(cat.items){const p={};cat.items.forEach(it=>{p[it.k]=DEFAULT_PTS_CONFIG[it.k]||0;});setPtsEdit(prev=>({...prev,...p}));}else setPtsEdit(prev=>({...prev,[cat.arrayKey]:[...(DEFAULT_PTS_CONFIG[cat.arrayKey]||[])]}));}
  function deletePtsAward(k){setPtsEdit(p=>({...p,[k]:0}));}
  function deleteArrayPos(arrayKey,i){setPtsEdit(p=>({...p,[arrayKey]:p[arrayKey].filter((_,idx)=>idx!==i)}));}
  function addArrayPos(arrayKey){setPtsEdit(p=>({...p,[arrayKey]:[...(p[arrayKey]||[]),0]}));}
  function addCustomCat(){setPtsEdit(p=>({...p,customCategories:[...(p.customCategories||[]),{name:"New Category",awards:[]}]}));}
  function deleteCustomCat(ci){setPtsEdit(p=>({...p,customCategories:p.customCategories.filter((_,i)=>i!==ci)}));}
  function setCustomCatName(ci,name){setPtsEdit(p=>({...p,customCategories:p.customCategories.map((c,i)=>i===ci?{...c,name}:c)}));}
  function addCustomAward(ci){setPtsEdit(p=>({...p,customCategories:p.customCategories.map((c,i)=>i===ci?{...c,awards:[...c.awards,{label:"New Award",pts:0}]}:c)}));}
  function deleteCustomAward(ci,ai){setPtsEdit(p=>({...p,customCategories:p.customCategories.map((c,i)=>i===ci?{...c,awards:c.awards.filter((_,j)=>j!==ai)}:c)}));}
  function setCustomAward(ci,ai,field,val){setPtsEdit(p=>({...p,customCategories:p.customCategories.map((c,i)=>i===ci?{...c,awards:c.awards.map((a,j)=>j===ai?{...a,[field]:val}:a)}:c)}));}
  // League rules editor
  const [leagueRules,setLeagueRules] = useState(setup?.leagueRules||[]);
  const [rulesSaved,setRulesSaved] = useState(false);
  const [newRuleTitle,setNewRuleTitle] = useState("");
  const [newRuleBody,setNewRuleBody] = useState("");
  const [editingRule,setEditingRule] = useState(null); // index being edited
  useEffect(()=>{if(setup?.leagueRules)setLeagueRules(setup.leagueRules);},[setup?.leagueRules]);
  function saveLeagueRules(rules){const updated={...setup,leagueRules:rules};setSetup(updated);saveToDb({setup:updated});setRulesSaved(true);setTimeout(()=>setRulesSaved(false),2000);}
  function addRule(){if(!newRuleTitle.trim()||!newRuleBody.trim())return;const updated=[...leagueRules,{title:newRuleTitle.trim(),body:newRuleBody.trim()}];setLeagueRules(updated);saveLeagueRules(updated);setNewRuleTitle("");setNewRuleBody("");}
  function deleteRule(i){if(!window.confirm("Delete this rule?"))return;const updated=leagueRules.filter((_,idx)=>idx!==i);setLeagueRules(updated);saveLeagueRules(updated);}
  function moveRule(i,dir){const updated=[...leagueRules];const j=i+dir;if(j<0||j>=updated.length)return;[updated[i],updated[j]]=[updated[j],updated[i]];setLeagueRules(updated);saveLeagueRules(updated);}
  function startEditRule(i){setEditingRule(i);setNewRuleTitle(leagueRules[i].title);setNewRuleBody(leagueRules[i].body);}
  function saveEditRule(){if(!newRuleTitle.trim()||!newRuleBody.trim())return;const updated=leagueRules.map((r,i)=>i===editingRule?{title:newRuleTitle.trim(),body:newRuleBody.trim()}:r);setLeagueRules(updated);saveLeagueRules(updated);setEditingRule(null);setNewRuleTitle("");setNewRuleBody("");}
  function cancelEditRule(){setEditingRule(null);setNewRuleTitle("");setNewRuleBody("");}
  function setPEArr(key,idx,val){setPtsEdit(p=>({...p,[key]:p[key].map((v,i)=>i===idx?val:v)}));}
  const setSR=(i,f,v)=>setSetupRows(p=>p.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const addRow=()=>setSetupRows(p=>[...p,{userId:"",userName:"",teamName:""}]);
  const removeRow=(i)=>{if(setupRows.length<=2)return alert("Minimum 2 teams.");setSetupRows(p=>p.filter((_,idx)=>idx!==i));};
  function applySetup(){const valid=setupRows.filter(r=>r.userName.trim()&&r.teamName.trim());if(valid.length<2)return alert("Enter at least 2 users.");if(entries.length>0&&!window.confirm("This resets all standings. Continue?"))return;handleStart(setupLeague||"Dynasty League",valid);setCommissionerUnlocked(false);}
  function addMidSeason(){const last=setupRows[setupRows.length-1];if(!last?.userName?.trim()||!last?.teamName?.trim())return alert("Fill in the last row first.");if(entries.find(e=>e.teamName===last.teamName))return alert("That team is already in the dynasty.");const uid=last.userId||genId();const newE=INITIAL_ENTRY(last.userName.trim(),last.teamName.trim(),uid);setEntries(prev=>[...prev,newE]);setWeekResults(prev=>[...prev,{teamName:newE.teamName,userName:newE.userName,result:"none",ranked25:false,ranked10:false}]);if(postSeasonInputs)setPSI(prev=>({...prev,confStandings:[...prev.confStandings,{teamName:newE.teamName,rank:prev.confStandings.length+1}],bowls:[...prev.bowls,{teamName:newE.teamName,bowl:"none"}],recruiting:[...prev.recruiting,{teamName:newE.teamName,rank:prev.recruiting.length+1}]}));const newRow={userId:uid,userName:newE.userName,teamName:newE.teamName};const pUser={id:uid,defaultName:newE.userName};setSetup(prev=>{const updated={...prev,rows:[...(prev?.rows||[]),newRow],permanentUsers:[...(prev?.permanentUsers||[]),pUser]};setTimeout(()=>saveToDb({setup:updated}),100);return updated;});alert(`${newE.userName} (${newE.teamName}) added!`);}
  const [permSaved,setPermSaved] = useState(false);
  function savePermNames(){
    const valid=setupRows.filter(r=>r.userName.trim()&&r.teamName.trim());
    if(valid.length<2)return alert("Need at least 2 users.");
    // Detect old→new name/team changes by comparing with current setup.rows
    const oldNameMap={}, oldTeamMap={}, userIdToName={};
    valid.forEach(sr=>{
      // Match existing row by userId, then by teamName as fallback
      const ex=(setup?.rows||[]).find(r=>r.userId&&r.userId===sr.userId)||(setup?.rows||[]).find(r=>!sr.userId&&r.teamName===sr.teamName);
      const newName=sr.userName.trim();
      const newTeam=sr.teamName.trim();
      if(sr.userId) userIdToName[sr.userId]=newName;
      if(ex){
        if(newName&&newName!==ex.userName) oldNameMap[ex.userName]=newName;
        if(newTeam&&newTeam!==ex.teamName) oldTeamMap[ex.teamName]=newTeam;
      }
      // aliases as old names
      (sr.aliases||"").split(",").map(a=>a.trim()).filter(Boolean).forEach(alias=>{oldNameMap[alias]=newName;});
    });
    // Build new rows directly from setupRows (source of truth), preserving active/metadata from existing rows
    const updatedRows=valid.map(sr=>{
      const ex=(setup?.rows||[]).find(r=>r.userId&&r.userId===sr.userId)||(setup?.rows||[]).find(r=>r.teamName===sr.teamName)||(setup?.rows||[]).find(r=>oldTeamMap[r.teamName]===sr.teamName.trim());
      return {...(ex||{}),userId:sr.userId||ex?.userId||"",userName:sr.userName.trim(),teamName:sr.teamName.trim(),aliases:sr.aliases||""};
    });
    const updatedPerm=(setup?.permanentUsers||[]).map(p=>{const n=userIdToName[p.id];return n?{...p,defaultName:n}:p;});
    const updated={...setup,rows:updatedRows,permanentUsers:updatedPerm};
    // Skip the rows sync effect for this one update — we own these values
    skipRowsSync.current=true;
    setSetup(updated);
    // Build set of active userIds/teamNames from the new rows so we can remove orphaned entries
    const activeUserIds=new Set(updatedRows.map(r=>r.userId).filter(Boolean));
    const activeTeamNames=new Set(updatedRows.map(r=>r.teamName));
    // Update live entries: rename + remove entries no longer in the roster
    const updatedEntries=entries.map(e=>{
      const newName=userIdToName[e.userId]||oldNameMap[e.userName]||e.userName;
      const newTeam=oldTeamMap[e.teamName]||e.teamName;
      return (newName!==e.userName||newTeam!==e.teamName)?{...e,userName:newName,teamName:newTeam}:e;
    }).filter(e=>(e.userId&&activeUserIds.has(e.userId))||(!e.userId&&activeTeamNames.has(e.teamName)));
    setEntries(updatedEntries);
    if(history?.length){
      const updatedHistory=history.map(s=>({...s,finalStandings:s.finalStandings.map(t=>{
        const newName=userIdToName[t.userId]||oldNameMap[t.userName]||t.userName;
        const newTeam=oldTeamMap[t.teamName]||t.teamName;
        return (newName!==t.userName||newTeam!==t.teamName)?{...t,userName:newName,teamName:newTeam}:t;
      }),champion:oldNameMap[s.champion]||s.champion,heisman:oldNameMap[s.heisman]||s.heisman}));
      setHistory(updatedHistory);
      saveToDb({setup:updated,entries:updatedEntries,history:updatedHistory});
    } else {
      saveToDb({setup:updated,entries:updatedEntries});
    }
    setPermSaved(true);
    setTimeout(()=>setPermSaved(false),2000);
  }
  function toggleActive(teamName){setSetup(prev=>{const rows=(prev?.rows||[]).map(r=>r.teamName===teamName?{...r,active:r.active===false?true:false}:r);const updated={...prev,rows};setTimeout(()=>saveToDb({setup:updated}),100);return updated;});}

  // Season roster management
  const permanentUsers = setup?.permanentUsers||[];
  // Build the editable row list for the selected season, initialized from saved roster or permanentUsers defaults
  function buildDefaultRosterRows(season){
    const saved = setup?.seasonRosters?.[season]||[];
    if(saved.length>0) return saved.map(r=>({...r}));
    return permanentUsers.map(u=>{const cur=(setup?.rows||[]).find(r=>r.userId===u.id);return {userId:u.id,userName:u.defaultName,teamName:cur?.teamName||""};});
  }
  // Initialize rosterRows when season changes
  const effectiveRosterRows = rosterRows !== null ? rosterRows : buildDefaultRosterRows(rosterSeason);
  function changeRosterSeason(s){setRosterSeason(s);setRosterRows(null);setRosterEdits({});setRosterSaved(false);setNewRosterCoach("");setNewRosterTeam("");}
  function setRosterRowField(idx,field,val){setRosterRows(prev=>(prev||buildDefaultRosterRows(rosterSeason)).map((r,i)=>i===idx?{...r,[field]:val}:r));setRosterSaved(false);}
  function deleteRosterRow(idx){setRosterRows(prev=>(prev||buildDefaultRosterRows(rosterSeason)).filter((_,i)=>i!==idx));setRosterSaved(false);}
  function addRosterRow(){if(!newRosterCoach.trim()||!newRosterTeam.trim())return;const matchedUser=permanentUsers.find(u=>u.defaultName.toLowerCase()===newRosterCoach.trim().toLowerCase());const userId=matchedUser?.id||genId();setRosterRows(prev=>[...(prev||buildDefaultRosterRows(rosterSeason)),{userId,userName:newRosterCoach.trim(),teamName:newRosterTeam.trim()}]);setNewRosterCoach("");setNewRosterTeam("");setRosterSaved(false);}
  function saveSeasonRoster(){
    const roster = effectiveRosterRows.filter(r=>r.userName.trim()&&r.teamName.trim());
    const rosterYear = START_YEAR + rosterSeason - 1;
    const curYear = year || (START_YEAR + season - 1);
    const updated = {
      ...setup,
      seasonRosters:{...(setup?.seasonRosters||{}), [rosterSeason]:roster},
      yearRosters:{...(setup?.yearRosters||{}), [rosterYear]:roster},
    };
    setSetup(updated);
    if(rosterYear===curYear){
      // Resolve userId for each roster member from setup.rows, falling back to genId
      const resolvedRoster = roster.map(r=>{
        const setupRow=(setup?.rows||[]).find(sr=>sr.userId===r.userId||sr.userName===r.userName);
        const uid=setupRow?.userId||r.userId||genId();
        return {...r, userId:uid};
      });
      // Ensure all roster members are in setup.rows as active so activeEntries includes them
      let updatedRows=[...(updated.rows||[])];
      resolvedRoster.forEach(r=>{
        const idx=updatedRows.findIndex(sr=>sr.userId===r.userId||sr.userName===r.userName);
        if(idx===-1){
          updatedRows.push({userId:r.userId,userName:r.userName,teamName:r.teamName,active:true});
        } else {
          updatedRows[idx]={...updatedRows[idx],userId:r.userId,active:true};
        }
      });
      const updatedWithRows={...updated,rows:updatedRows};
      setSetup(updatedWithRows);
      // Rebuild entries exactly from the resolved roster (preserving stats for existing members)
      const updatedEntries = resolvedRoster.map(r=>{
        const existing=entries.find(e=>e.userId===r.userId||e.userName===r.userName);
        if(existing) return {...existing, userId:r.userId, userName:r.userName, teamName:r.teamName};
        return INITIAL_ENTRY(r.userName, r.teamName, r.userId);
      });
      setEntries(updatedEntries);
      saveToDb({setup:updatedWithRows, entries:updatedEntries});
    } else {
      saveToDb({setup:updated});
    }
    setRosterRows(roster);
    setRosterEdits({});
    setRosterSaved(true);
    setTimeout(()=>setRosterSaved(false),2000);
  }

  const isLive=entries.length>0;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {isLive&&<div style={{background:"#fff8f8",border:"1px solid #ffcccc",borderRadius:2,padding:"12px 14px",fontSize:13,color:RED,fontWeight:600}}>⚠️ Dynasty is live. "Add Team Mid-Season" adds a player without resetting. "Launch" resets everything.</div>}
      <Card><CardHead>League Name</CardHead><div style={{padding:"12px 14px"}}><input value={setupLeague} onChange={e=>setSetupLeague(e.target.value)} placeholder="e.g. Chrome Horn Dynasty 2025" style={{background:"#fff",border:"1px solid #ccc",borderRadius:2,padding:"9px 12px",color:"#111",fontFamily:ff,fontSize:14,width:"100%",boxSizing:"border-box"}}/></div></Card>
      <Card><CardHead bg={RED}>Users & Teams</CardHead>
        <div style={{padding:"0 0 8px"}}>
          <div style={{padding:"6px 14px 4px",fontSize:11,color:"#888"}}>These are the permanent player accounts. IDs are assigned automatically and persist across all seasons.</div>
          <div style={{padding:"4px 14px 6px",fontSize:11,color:"#888"}}>Add old names in "Also known as" to merge historical stats under this username.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 32px",padding:"8px 14px 6px",borderBottom:"1px solid #f0f0f0"}}>
            <div style={{fontSize:10,color:"#999",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Username</div>
            <div style={{fontSize:10,color:"#999",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Team</div>
            <div style={{fontSize:10,color:"#999",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Also known as</div>
            <div/>
          </div>
          {setupRows.map((row,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 32px",borderBottom:"1px solid #f5f5f5",alignItems:"center"}}>
              <input value={row.userName} onChange={e=>setSR(i,"userName",e.target.value)} placeholder={"User "+(i+1)} style={{background:"transparent",border:"none",borderRight:"1px solid #f0f0f0",padding:"9px 14px",color:"#111",fontFamily:ff,fontSize:13,outline:"none"}}/>
              <input value={row.teamName} onChange={e=>setSR(i,"teamName",e.target.value)} placeholder="e.g. Troy" style={{background:"transparent",border:"none",borderRight:"1px solid #f0f0f0",padding:"9px 14px",color:"#111",fontFamily:ff,fontSize:13,outline:"none"}}/>
              <input value={row.aliases||""} onChange={e=>setSR(i,"aliases",e.target.value)} placeholder="old name, other name" style={{background:"transparent",border:"none",borderRight:"1px solid #f0f0f0",padding:"9px 14px",color:"#777",fontFamily:ff,fontSize:12,outline:"none"}}/>
              <button onClick={()=>removeRow(i)} style={{background:"transparent",border:"none",color:"#ccc",cursor:"pointer",fontSize:18,padding:"0 8px"}}>×</button>
            </div>
          ))}
          <div style={{padding:"10px 14px"}}><button onClick={addRow} style={{background:"transparent",border:"1px dashed #ccc",borderRadius:2,padding:"7px 14px",color:"#888",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:600,width:"100%"}}>+ Add Player</button></div>
          <div style={{padding:"0 14px 12px"}}><button onClick={savePermNames} style={{background:permSaved?"#007a00":"#333",color:"#fff",border:"none",borderRadius:2,padding:"8px 16px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase"}}>{permSaved?"✓ Saved":"Save Permanent Names"}</button></div>
        </div>
      </Card>

      {isLive&&permanentUsers.length>0&&<Card><CardHead bg="#1a3a6b">Season Rosters</CardHead>
        <div style={{padding:"12px 14px"}}>
          <div style={{fontSize:11,color:"#888",marginBottom:10,lineHeight:1.5}}>Set each player's team for this season. Usernames stay permanent — only teams change year to year.</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <span style={{fontSize:12,color:"#555",fontWeight:700}}>Year:</span>
            <select value={rosterSeason} onChange={e=>changeRosterSeason(Number(e.target.value))} style={{padding:"6px 10px",border:"1px solid #ccc",borderRadius:2,fontFamily:ff,fontSize:13,color:"#111",background:"#fff"}}>
              {(()=>{const FIRST_YEAR=2020;const startS=FIRST_YEAR-START_YEAR+1;const endS=season+5;const arr=[];for(let s=startS;s<=endS;s++)arr.push(s);return arr;})().map(s=>{const dispYear=START_YEAR+s-1;const curYear=year||START_YEAR+season-1;return(<option key={s} value={s}>{dispYear}{dispYear===curYear?" (current)":dispYear===curYear+1?" (next)":""}</option>);})}
            </select>
          </div>
          <div style={{border:"1px solid #eee",borderRadius:2,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 32px",background:"#f5f5f5",borderBottom:"1px solid #eee"}}>
              <div style={{padding:"6px 10px",fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase"}}>Coach</div>
              <div style={{padding:"6px 10px",fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase",borderLeft:"1px solid #eee"}}>Team</div>
              <div/>
            </div>
            {effectiveRosterRows.map((row,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 32px",borderBottom:i<effectiveRosterRows.length-1?"1px solid #f0f0f0":"none",alignItems:"center"}}>
                <input value={row.userName||""} onChange={e=>setRosterRowField(i,"userName",e.target.value)} placeholder="Coach name" style={{padding:"8px 10px",border:"none",fontFamily:ff,fontSize:13,color:"#111",outline:"none",background:"#fff",width:"100%",boxSizing:"border-box"}}/>
                <input value={row.teamName||""} onChange={e=>setRosterRowField(i,"teamName",e.target.value)} placeholder="e.g. Troy" style={{padding:"8px 10px",border:"none",borderLeft:"1px solid #eee",fontFamily:ff,fontSize:13,color:"#111",outline:"none",background:"#fff",width:"100%",boxSizing:"border-box"}}/>
                <button onClick={()=>deleteRosterRow(i)} style={{background:"transparent",border:"none",color:"#ccc",cursor:"pointer",fontSize:18,padding:"0 8px",lineHeight:1}}>×</button>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 32px",borderTop:"1px dashed #e0e0e0",background:"#fafafa"}}>
              <input value={newRosterCoach} onChange={e=>setNewRosterCoach(e.target.value)} placeholder="+ Coach name" style={{padding:"8px 10px",border:"none",background:"transparent",fontFamily:ff,fontSize:13,color:"#111",outline:"none"}}/>
              <input value={newRosterTeam} onChange={e=>setNewRosterTeam(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addRosterRow()} placeholder="Team name" style={{padding:"8px 10px",border:"none",borderLeft:"1px solid #eee",background:"transparent",fontFamily:ff,fontSize:13,color:"#111",outline:"none"}}/>
              <button onClick={addRosterRow} style={{background:"transparent",border:"none",color:RED,cursor:"pointer",fontSize:20,padding:"0 8px",lineHeight:1,fontWeight:700}}>+</button>
            </div>
          </div>
          <button onClick={saveSeasonRoster} style={{marginTop:10,background:rosterSaved?"#007a00":RED,color:"#fff",border:"none",borderRadius:2,padding:"9px 18px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase"}}>{rosterSaved?"✓ Saved":"Save Season Roster"}</button>
        </div>
      </Card>}

      {isLive&&setup?.rows?.length>0&&<Card><CardHead bg="#333">Active Teams</CardHead>
        <div style={{padding:"8px 0"}}>
          <div style={{padding:"4px 14px 8px",fontSize:11,color:"#888",lineHeight:1.5}}>Deactivated teams are hidden from current season standings, schedule, and results. They still appear in past season history and player profiles.</div>
          {setup.rows.map(r=>{const isActive=r.active!==false;return(
            <div key={r.teamName} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",borderBottom:"1px solid #f5f5f5"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:isActive?"#111":"#aaa"}}>{r.teamName}</div>
                <div style={{fontSize:11,color:isActive?"#888":"#bbb"}}>{r.userName}</div>
              </div>
              <button onClick={()=>toggleActive(r.teamName)} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:isActive?"#007a00":RED,background:isActive?"#f0f8f0":"#fff8f8",color:isActive?"#007a00":RED,cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:800,textTransform:"uppercase",minWidth:80}}>{isActive?"Active":"Inactive"}</button>
            </div>
          );})}
        </div>
      </Card>}
      <Card><CardHead bg="#333">⚙️ Points Configuration</CardHead>
        <div style={{padding:"12px 14px"}}>
          {!ptsEdit?(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,color:"#555"}}>Customize which actions earn points and how many.</div>
              <button onClick={openPtsEditor} style={{background:"#333",color:"#fff",border:"none",borderRadius:2,padding:"7px 16px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>Edit Points</button>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {/* Fixed categories */}
              {FIXED_CATS.map(cat=>{
                const isItems=!!cat.items;
                const allZero=isItems?cat.items.every(it=>!ptsEdit[it.k]):(ptsEdit[cat.arrayKey]||[]).length===0||(ptsEdit[cat.arrayKey]||[]).every(v=>!v);
                return(
                  <div key={cat.key} style={{border:"1px solid #e0e0e0",borderRadius:3,overflow:"hidden"}}>
                    <div style={{background:allZero?"#f0f0f0":"#fafafa",padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:11,fontWeight:800,color:allZero?"#aaa":"#444",textTransform:"uppercase",letterSpacing:0.4}}>{cat.label}</div>
                      <div style={{display:"flex",gap:6}}>
                        {allZero?(
                          <button onClick={()=>restorePtsCat(cat)} style={{background:"#e8f5e9",border:"none",borderRadius:2,padding:"3px 9px",cursor:"pointer",fontSize:11,fontWeight:700,color:"#007a00",fontFamily:ff}}>Restore</button>
                        ):(
                          <button onClick={()=>deletePtsCat(cat)} style={{background:"#fdecea",border:"none",borderRadius:2,padding:"3px 9px",cursor:"pointer",fontSize:11,fontWeight:700,color:RED,fontFamily:ff}}>Delete Category</button>
                        )}
                      </div>
                    </div>
                    {!allZero&&<div style={{padding:"10px 12px"}}>
                      {isItems?(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:6}}>
                          {cat.items.map(it=>ptsEdit[it.k]===0?null:(
                            <div key={it.k}>
                              <div style={{fontSize:9,color:"#999",marginBottom:2,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                <span>{it.label}</span>
                                <span onClick={()=>deletePtsAward(it.k)} style={{cursor:"pointer",color:RED,fontWeight:800,fontSize:10,marginLeft:4,lineHeight:1}}>✕</span>
                              </div>
                              <NumField value={ptsEdit[it.k]} onChange={v=>setPE(it.k,v)} width="100%" style={{width:"100%",boxSizing:"border-box"}}/>
                            </div>
                          ))}
                        </div>
                      ):(
                        <div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(64px,1fr))",gap:6,marginBottom:8}}>
                            {(ptsEdit[cat.arrayKey]||[]).map((v,i)=>(
                              <div key={i}>
                                <div style={{fontSize:9,color:"#999",marginBottom:2,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                  <span style={{fontSize:8}}>{cat.posLabel(i)}</span>
                                  <span onClick={()=>deleteArrayPos(cat.arrayKey,i)} style={{cursor:"pointer",color:RED,fontWeight:800,fontSize:10,lineHeight:1}}>✕</span>
                                </div>
                                <NumField value={v} onChange={val=>setPEArr(cat.arrayKey,i,val)} width="100%" style={{width:"100%",boxSizing:"border-box"}}/>
                              </div>
                            ))}
                          </div>
                          <button onClick={()=>addArrayPos(cat.arrayKey)} style={{background:"#f0f0f0",border:"none",borderRadius:2,padding:"4px 10px",cursor:"pointer",fontFamily:ff,fontSize:11,fontWeight:700,color:"#555"}}>+ Add Position</button>
                        </div>
                      )}
                    </div>}
                  </div>
                );
              })}
              {/* Custom categories */}
              {(ptsEdit.customCategories||[]).map((cat,ci)=>(
                <div key={ci} style={{border:"1px solid #c5d0e8",borderRadius:3,overflow:"hidden",background:"#f5f7ff"}}>
                  <div style={{padding:"8px 12px",background:"#e8ecf8",display:"flex",gap:8,alignItems:"center"}}>
                    <input value={cat.name} onChange={e=>setCustomCatName(ci,e.target.value)} style={{flex:1,border:"1px solid #c0c8e0",borderRadius:2,padding:"4px 8px",fontSize:12,fontFamily:ff,fontWeight:800,color:"#333",background:"#fff"}}/>
                    <button onClick={()=>deleteCustomCat(ci)} style={{background:"#fdecea",border:"none",borderRadius:2,padding:"3px 9px",cursor:"pointer",fontSize:11,fontWeight:700,color:RED,fontFamily:ff}}>Delete</button>
                  </div>
                  <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
                    {cat.awards.map((award,ai)=>(
                      <div key={ai} style={{display:"flex",gap:8,alignItems:"center"}}>
                        <input value={award.label} onChange={e=>setCustomAward(ci,ai,"label",e.target.value)} style={{flex:1,border:"1px solid #dde",borderRadius:2,padding:"5px 8px",fontSize:12,fontFamily:ff,color:"#333",background:"#fff"}} placeholder="Award name"/>
                        <NumField value={award.pts} onChange={v=>setCustomAward(ci,ai,"pts",v)} style={{width:64}}/>
                        <span onClick={()=>deleteCustomAward(ci,ai)} style={{cursor:"pointer",color:RED,fontWeight:800,fontSize:14,padding:"0 4px",lineHeight:1}}>✕</span>
                      </div>
                    ))}
                    <button onClick={()=>addCustomAward(ci)} style={{background:"#dce3f8",border:"none",borderRadius:2,padding:"5px 10px",cursor:"pointer",fontFamily:ff,fontSize:11,fontWeight:700,color:"#446",alignSelf:"flex-start"}}>+ Add Award</button>
                  </div>
                </div>
              ))}
              <button onClick={addCustomCat} style={{background:"#f5f5f5",border:"1px dashed #bbb",borderRadius:3,padding:"8px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:700,color:"#666",width:"100%",textAlign:"center"}}>+ Add Custom Category</button>
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={savePtsConfig} style={{flex:1,background:ptsSaved?"#007a00":RED,color:"#fff",border:"none",borderRadius:2,padding:"9px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>{ptsSaved?"✓ Saved":"Save Points Config"}</button>
                <button onClick={()=>setPtsEdit({...DEFAULT_PTS_CONFIG,customCategories:[]})} style={{background:"#888",color:"#fff",border:"none",borderRadius:2,padding:"9px 14px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>Reset Defaults</button>
                <button onClick={()=>setPtsEdit(null)} style={{background:"#eee",color:"#555",border:"none",borderRadius:2,padding:"9px 14px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHead bg="#1a3a6b">🖼️ Player Images</CardHead>
        <div style={{padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#666",marginBottom:4}}>Set a profile picture and team logo for each player. Paste a direct image URL (upload to Imgur, Discord, etc. and copy the image link).</div>
          <div style={{fontSize:11,color:"#888",marginBottom:12}}>Profile picture shows on their profile page. Team logo appears next to their team name across the site.</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(setup?.rows||[]).map(r=>{
              const key=r.userId||r.userName;
              function setImg(field,val){const updatedRows=(setup.rows||[]).map(row=>(row.userId||row.userName)===key?{...row,[field]:val}:row);const updated={...setup,rows:updatedRows};setSetup(updated);saveToDb({setup:updated});}
              return(
                <div key={key} style={{background:"#fafafa",border:"1px solid #e5e5e5",borderRadius:3,padding:"10px 12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    {r.profilePicUrl?<img src={r.profilePicUrl} alt="" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #ddd"}} onError={e=>{e.target.style.display="none";}}/>:<div style={{width:36,height:36,borderRadius:"50%",background:"#ddd",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#888",flexShrink:0}}>{(r.userName||"?")[0].toUpperCase()}</div>}
                    {r.teamLogoUrl?<img src={r.teamLogoUrl} alt="" style={{width:36,height:36,objectFit:"contain",border:"1px solid #ddd",borderRadius:2,background:"#fff"}} onError={e=>{e.target.style.display="none";}}/>:<div style={{width:36,height:36,border:"1px dashed #ccc",borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#bbb",flexShrink:0,textAlign:"center",lineHeight:1.2}}>NO<br/>LOGO</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#111"}}>{r.userName}</div>
                      <div style={{fontSize:11,color:"#888"}}>{r.teamName}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:10,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:0.5,width:80,flexShrink:0}}>Profile Pic</span>
                      <input value={r.profilePicUrl||""} onChange={e=>setImg("profilePicUrl",e.target.value)} placeholder="Paste image URL…" style={{flex:1,border:"1px solid #ddd",borderRadius:2,padding:"6px 8px",fontSize:11,fontFamily:ff,color:"#111",background:"#fff"}}/>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:10,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:0.5,width:80,flexShrink:0}}>Team Logo</span>
                      <input value={r.teamLogoUrl||""} onChange={e=>setImg("teamLogoUrl",e.target.value)} placeholder="Paste image URL…" style={{flex:1,border:"1px solid #ddd",borderRadius:2,padding:"6px 8px",fontSize:11,fontFamily:ff,color:"#111",background:"#fff"}}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <Card>
        <CardHead bg="#111">📺 Dynasty RedZone — Stream Links</CardHead>
        <div style={{padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#666",marginBottom:4}}>Set each player's channel URL. Streams are auto-detected when live — no manual toggling needed. Use Force Live as an override.</div>
          <div style={{fontSize:11,color:"#888",marginBottom:12}}>YouTube: paste channel URL (e.g. youtube.com/@handle) &nbsp;|&nbsp; Twitch: paste channel URL (e.g. twitch.tv/username)</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(setup?.rows||[]).map(r=>{
              const key=r.userId||r.userName;
              const s=(setup?.streamLinks||{})[key]||{url:"",isLive:false};
              const autoLive=(autoLiveStatuses||{})[key];
              const hasAutoCheck=key in (autoLiveStatuses||{});
              const effectiveLive=hasAutoCheck?autoLive:s.isLive;
              function setStream(field,val){const updated={...setup,streamLinks:{...(setup.streamLinks||{}),[key]:{...s,[field]:val}}};setSetup(updated);saveToDb({setup:updated});}
              return(
                <div key={key} style={{background:"#fafafa",border:`1px solid ${effectiveLive?"#cc0000":"#e5e5e5"}`,borderRadius:3,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:800,color:"#111"}}>{r.userName}</div>
                      <div style={{fontSize:11,color:"#888"}}>{r.teamName}</div>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                      {hasAutoCheck&&(
                        <div style={{background:autoLive?"#cc0000":"#1e1e1e",color:"#fff",borderRadius:2,padding:"3px 8px",fontSize:10,fontWeight:800,letterSpacing:0.5}}>
                          {autoLive?"● AUTO LIVE":"○ AUTO OFF"}
                        </div>
                      )}
                      <button onClick={()=>setStream("isLive",!s.isLive)} title="Force Live override — use if auto-detection isn't working" style={{background:s.isLive?"#7a0000":"#444",color:"#fff",border:"none",borderRadius:2,padding:"3px 9px",cursor:"pointer",fontSize:10,fontWeight:800,fontFamily:ff,letterSpacing:0.3}}>
                        {s.isLive?"⚡ FORCED":"⚡ Force Live"}
                      </button>
                    </div>
                  </div>
                  <input
                    value={s.url||""}
                    onChange={e=>setStream("url",e.target.value)}
                    placeholder="youtube.com/@channelname or twitch.tv/username"
                    style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:2,padding:"7px 10px",fontSize:12,fontFamily:ff,color:"#111",background:"#fff"}}
                  />
                  {s.url&&!getEmbedUrl(s.url)&&!toYouTubeChannelLiveUrl(s.url)&&<div style={{fontSize:11,color:"#e67e00",marginTop:4}}>⚠ URL not recognized — paste a YouTube channel or Twitch channel link</div>}
                  {s.url&&(getEmbedUrl(s.url)||toYouTubeChannelLiveUrl(s.url))&&<div style={{fontSize:11,color:"#007a00",marginTop:4}}>✓ {getPlatform(s.url)==="twitch"?"Twitch — auto-detecting via embed events":"YouTube — auto-detecting every 90 seconds"}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <Card>
        <CardHead bg="#333">📋 League Rules</CardHead>
        <div style={{padding:"14px 16px"}}>
          <div style={{fontSize:12,color:"#666",marginBottom:12}}>Add custom rules that all league members can see on the Rules page.</div>
          {leagueRules.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {leagueRules.map((rule,i)=>(
              <div key={i} style={{background:"#f7f7f7",border:"1px solid #e5e5e5",borderRadius:3,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{fontWeight:800,fontSize:13,color:"#111",flex:1}}>{rule.title}</div>
                  <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"center"}}>
                    <button onClick={()=>moveRule(i,-1)} disabled={i===0} style={{background:"#eee",border:"none",borderRadius:2,padding:"3px 6px",cursor:i===0?"default":"pointer",fontSize:11,fontWeight:700,color:i===0?"#bbb":"#444",fontFamily:ff}}>▲</button>
                    <button onClick={()=>moveRule(i,1)} disabled={i===leagueRules.length-1} style={{background:"#eee",border:"none",borderRadius:2,padding:"3px 6px",cursor:i===leagueRules.length-1?"default":"pointer",fontSize:11,fontWeight:700,color:i===leagueRules.length-1?"#bbb":"#444",fontFamily:ff}}>▼</button>
                    <button onClick={()=>startEditRule(i)} style={{background:"#eee",border:"none",borderRadius:2,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700,color:"#444",fontFamily:ff}}>Edit</button>
                    <button onClick={()=>deleteRule(i)} style={{background:"#fdecea",border:"none",borderRadius:2,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700,color:RED,fontFamily:ff}}>✕</button>
                  </div>
                </div>
                <div style={{fontSize:12,color:"#555",marginTop:5,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{rule.body}</div>
              </div>
            ))}
          </div>}
          <div style={{borderTop:leagueRules.length>0?"1px solid #eee":"none",paddingTop:leagueRules.length>0?12:0}}>
            <div style={{fontSize:11,fontWeight:800,color:"#444",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>{editingRule!==null?"Edit Rule":"Add Rule"}</div>
            <input value={newRuleTitle} onChange={e=>setNewRuleTitle(e.target.value)} placeholder="Rule title (e.g. Trade Deadline)" style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:2,padding:"8px 10px",fontSize:13,fontFamily:ff,marginBottom:6,color:"#111"}}/>
            <textarea value={newRuleBody} onChange={e=>setNewRuleBody(e.target.value)} placeholder="Rule details..." rows={3} style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:2,padding:"8px 10px",fontSize:13,fontFamily:ff,resize:"vertical",lineHeight:1.5,color:"#111"}}/>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              {editingRule!==null?(
                <>
                  <button onClick={saveEditRule} style={{flex:1,background:rulesSaved?"#007a00":RED,color:"#fff",border:"none",borderRadius:2,padding:"8px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800}}>{rulesSaved?"✓ Saved":"Save Changes"}</button>
                  <button onClick={cancelEditRule} style={{flex:1,background:"#eee",color:"#444",border:"none",borderRadius:2,padding:"8px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:700}}>Cancel</button>
                </>
              ):(
                <button onClick={addRule} style={{flex:1,background:newRuleTitle.trim()&&newRuleBody.trim()?RED:"#ccc",color:"#fff",border:"none",borderRadius:2,padding:"8px",cursor:newRuleTitle.trim()&&newRuleBody.trim()?"pointer":"default",fontFamily:ff,fontSize:12,fontWeight:800}}>+ Add Rule</button>
              )}
            </div>
          </div>
        </div>
      </Card>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button onClick={applySetup} style={{flex:1,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"13px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",minWidth:140}}>{isLive?"↺ Reset & Relaunch":"Launch Dynasty →"}</button>
        {isLive&&<button onClick={addMidSeason} style={{flex:1,background:"#007a00",color:"#fff",border:"none",borderRadius:2,padding:"13px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",minWidth:140}}>+ Add Team Mid-Season</button>}
      </div>
    </div>
  );
}

// ── BulkResultsUploader ───────────────────────────────────────────────────
function fuzzyMatchTeam(parsed, knownTeams) {
  if (!parsed) return {team:"",confidence:"none"};
  const p = parsed.toLowerCase().trim();
  const exact = knownTeams.find(t=>t.toLowerCase()===p);
  if (exact) return {team:exact,confidence:"exact"};
  const contains = knownTeams.find(t=>p.includes(t.toLowerCase())||t.toLowerCase().includes(p));
  if (contains) return {team:contains,confidence:"fuzzy"};
  function lev(a,b){const m=a.length,n=b.length;const d=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>j===0?i:i===0?j:0));for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=a[i-1]===b[j-1]?d[i-1][j-1]:1+Math.min(d[i-1][j],d[i][j-1],d[i-1][j-1]);return d[m][n];}
  let best=null,bestDist=Infinity;
  knownTeams.forEach(t=>{const dist=lev(p,t.toLowerCase());if(dist<bestDist){bestDist=dist;best=t;}});
  if(best&&bestDist<=Math.max(3,Math.floor(p.length*0.4)))return{team:best,confidence:"fuzzy"};
  return {team:"",confidence:"none"};
}

function BulkResultsUploader({entries,week,teamNames,onConfirm}) {
  const isMobile = useIsMobile();
  const [files,setFiles]=useState([]);
  const [imgStatuses,setImgStatuses]=useState([]);
  const [phase,setPhase]=useState("upload");
  const [gameRows,setGameRows]=useState([]);
  const [successInfo,setSuccessInfo]=useState(null);


  function handleFileChange(e) {
    const chosen=Array.from(e.target.files).slice(0,16);
    setFiles(chosen);
    setImgStatuses(chosen.map(f=>({name:f.name,status:"pending",raw:null,error:null})));
    setPhase("upload");setGameRows([]);setSuccessInfo(null);
  }

  async function processAll() {
    if(!files.length)return;
    setPhase("processing");
    const allGames=[];
    for(let i=0;i<files.length;i++){
      setImgStatuses(prev=>prev.map((s,idx)=>idx===i?{...s,status:"processing"}:s));
      try{
        const file=files[i];
        const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
        const resp=await fetch("https://dynasty-api.brockdrury.workers.dev/api/parse-screenshot",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({image:b64,mediaType:file.type||"image/jpeg",teams:teamNames}),
        });
        if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e?.error||`API error ${resp.status}`);}
        const parsed=await resp.json();
        setImgStatuses(prev=>prev.map((s,idx)=>idx===i?{...s,status:"done",raw:parsed}:s));
        allGames.push(parsed);
      }catch(e){
        setImgStatuses(prev=>prev.map((s,idx)=>idx===i?{...s,status:"error",error:e.message}:s));
      }
    }
    const rows=allGames.map((g,idx)=>{
      const hm=fuzzyMatchTeam(g.home_team,teamNames);
      const am=fuzzyMatchTeam(g.away_team,teamNames);
      return{id:idx,homeRaw:g.home_team||"",awayRaw:g.away_team||"",homeTeam:hm.team,awayTeam:am.team,homeConf:hm.confidence,awayConf:am.confidence,homeScore:parseInt(g.home_score)||0,awayScore:parseInt(g.away_score)||0,homeStats:g.home_stats||{passing_yards:0,rushing_yards:0,total_yards:0,turnovers:0,interceptions:0},awayStats:g.away_stats||{passing_yards:0,rushing_yards:0,total_yards:0,turnovers:0,interceptions:0},ranked25:false,ranked10:false};
    });
    setGameRows(rows);
    setPhase("review");
  }

  function updateRow(id,field,val){setGameRows(prev=>prev.map(r=>r.id===id?{...r,[field]:val}:r));}

  function handleConfirm(){
    const results=[];
    gameRows.forEach(row=>{
      const hScore=parseInt(row.homeScore)||0,aScore=parseInt(row.awayScore)||0,hWon=hScore>aScore;
      const hLeague=teamNames.includes(row.homeTeam),aLeague=teamNames.includes(row.awayTeam);
      if(hLeague)results.push({leagueTeam:row.homeTeam,result:hWon?"win":"loss",opponent:row.awayTeam||row.awayRaw||"Unknown",ranked25:hWon?row.ranked25:false,ranked10:hWon?row.ranked10:false,stats:row.homeStats});
      if(aLeague&&row.awayTeam!==row.homeTeam)results.push({leagueTeam:row.awayTeam,result:!hWon?"win":"loss",opponent:row.homeTeam||row.homeRaw||"Unknown",ranked25:!hWon?row.ranked25:false,ranked10:!hWon?row.ranked10:false,stats:row.awayStats});
    });
    onConfirm(results);
    setSuccessInfo({count:results.length,week});
    setPhase("done");
  }

  const confC=c=>c==="exact"?"#007a00":c==="fuzzy"?"#cc7700":RED;
  const confL=c=>c==="exact"?"✓ Exact":c==="fuzzy"?"~ Fuzzy":"✗ No match";
  const rowConf=row=>row.homeConf==="none"&&row.awayConf==="none"?"none":(row.homeConf==="exact"||row.awayConf==="exact")?"exact":"fuzzy";

  return (
    <Card><div style={{padding:16}}>
      <SL>Bulk Game Result Import</SL>
      <p style={{fontSize:13,color:"#888",marginBottom:12,lineHeight:1.5}}>Upload up to 16 scoreboard screenshots. Claude reads each one and builds a confirmation table — nothing is saved until you click Confirm.</p>

      {phase!=="done"&&<>
        <input type="file" accept="image/*" multiple onChange={handleFileChange} style={{color:"#111",fontSize:13,marginBottom:10,display:"block"}}/>
        {imgStatuses.length>0&&<div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:12}}>
          {imgStatuses.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:s.status==="done"?"#f0f8f0":s.status==="error"?"#fff8f8":s.status==="processing"?"#fffbf0":"#f9f9f9",border:`1px solid ${s.status==="done"?"#cce5cc":s.status==="error"?"#ffcccc":s.status==="processing"?"#ffe88a":"#eee"}`,borderRadius:2,fontSize:12}}>
              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#333"}}>{s.name}</span>
              <span style={{color:s.status==="done"?"#007a00":s.status==="error"?RED:s.status==="processing"?"#cc7700":"#aaa",fontWeight:700,flexShrink:0,fontSize:11}}>
                {s.status==="done"?"✓ Done":s.status==="error"?("✗ "+(s.error||"Error")):s.status==="processing"?"⏳ Reading...":"⏸ Pending"}
              </span>
            </div>
          ))}
        </div>}
        {phase==="upload"&&files.length>0&&<button onClick={processAll} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"10px 20px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Read {files.length} Screenshot{files.length>1?"s":""} →</button>}
        {phase==="processing"&&<div style={{color:"#cc7700",fontSize:13,fontWeight:700,padding:"8px 0"}}>⏳ Processing images — do not close this tab.</div>}
      </>}

      {phase==="review"&&gameRows.length===0&&<div style={{color:RED,fontSize:13,marginTop:8}}>No games could be parsed. Try clearer screenshots.</div>}

      {phase==="review"&&gameRows.length>0&&<>
        <div style={{fontSize:11,fontWeight:800,color:"#555",letterSpacing:1,textTransform:"uppercase",marginTop:12,marginBottom:8}}>Review & Edit — {gameRows.length} game{gameRows.length>1?"s":""} found</div>
        {isMobile ? (
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {gameRows.map(row=>{
              const hScore=parseInt(row.homeScore)||0,aScore=parseInt(row.awayScore)||0,hWon=hScore>aScore;
              const hLeague=teamNames.includes(row.homeTeam),aLeague=teamNames.includes(row.awayTeam);
              const conf=rowConf(row);
              const winnerIsLeague=hWon?hLeague:aLeague;
              return(
                <div key={row.id} style={{border:`1px solid ${conf==="none"?"#ffcccc":conf==="exact"?"#cce5cc":"#ffe88a"}`,borderRadius:2,padding:"10px 12px",background:conf==="none"?"#fff8f8":conf==="exact"?"#f9fff9":"#fffbf0"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <select value={row.homeTeam} onChange={e=>updateRow(row.id,"homeTeam",e.target.value)} style={{flex:1,border:"1px solid #ddd",borderRadius:2,padding:"4px 6px",fontFamily:ff,fontSize:12,background:"#fff",color:hLeague?"#111":"#999"}}>
                      <option value="">{row.homeRaw||"?"}</option>
                      {teamNames.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <span style={{fontSize:10,fontWeight:800,color:hWon?"#007a00":RED,flexShrink:0}}>{hWon?"WIN":"LOSS"}</span>
                    <NumField value={row.homeScore} onChange={v=>updateRow(row.id,"homeScore",v)} width={42} fontSize={14} style={{padding:"4px",color:hWon?"#007a00":RED,background:"transparent",border:"1px solid #ddd"}}/>
                    <span style={{color:"#bbb",fontWeight:700}}>—</span>
                    <NumField value={row.awayScore} onChange={v=>updateRow(row.id,"awayScore",v)} width={42} fontSize={14} style={{padding:"4px",color:!hWon?"#007a00":RED,background:"transparent",border:"1px solid #ddd"}}/>
                    <span style={{fontSize:10,fontWeight:800,color:!hWon?"#007a00":RED,flexShrink:0}}>{!hWon?"WIN":"LOSS"}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <select value={row.awayTeam} onChange={e=>updateRow(row.id,"awayTeam",e.target.value)} style={{flex:1,border:"1px solid #ddd",borderRadius:2,padding:"4px 6px",fontFamily:ff,fontSize:12,background:"#fff",color:aLeague?"#111":"#999"}}>
                      <option value="">{row.awayRaw||"?"}</option>
                      {teamNames.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <span style={{fontSize:10,fontWeight:700,color:confC(conf),background:conf==="exact"?"#f0f8f0":conf==="fuzzy"?"#fffbf0":"#fff8f8",padding:"2px 6px",borderRadius:2,border:`1px solid ${confC(conf)}`,whiteSpace:"nowrap",flexShrink:0}}>{confL(conf)}</span>
                  </div>
                  {winnerIsLeague&&<div style={{display:"flex",gap:12,marginTop:8,paddingTop:8,borderTop:"1px solid #eee"}}>
                    <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,color:"#888",cursor:"pointer"}}>
                      <input type="checkbox" checked={row.ranked25} onChange={e=>{updateRow(row.id,"ranked25",e.target.checked);if(e.target.checked)updateRow(row.id,"ranked10",false);}}/>Winner vs Top 25
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,color:RED,cursor:"pointer",fontWeight:700}}>
                      <input type="checkbox" checked={row.ranked10} onChange={e=>{updateRow(row.id,"ranked10",e.target.checked);if(e.target.checked)updateRow(row.id,"ranked25",false);}}/>vs Top 10
                    </label>
                  </div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{overflowX:"auto",marginBottom:14,border:"1px solid #eee",borderRadius:2}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:600}}>
              <thead><tr style={{background:"#f7f7f7",borderBottom:`2px solid ${RED}`}}>
                {["Home Team","","Score","—","Score","","Away Team","Confidence","Winner Ranked?"].map((h,i)=>(
                  <th key={i} style={{padding:"7px 8px",textAlign:"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap",borderRight:"1px solid #eee"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {gameRows.map(row=>{
                  const hScore=parseInt(row.homeScore)||0,aScore=parseInt(row.awayScore)||0,hWon=hScore>aScore;
                  const hLeague=teamNames.includes(row.homeTeam),aLeague=teamNames.includes(row.awayTeam);
                  const conf=rowConf(row);
                  const winnerIsLeague=hWon?hLeague:aLeague;
                  return(
                    <tr key={row.id} style={{borderBottom:"1px solid #eee",background:conf==="none"?"#fff8f8":conf==="exact"?"#f9fff9":"#fffbf0"}}>
                      <td style={{padding:"7px 6px",borderRight:"1px solid #eee"}}>
                        <select value={row.homeTeam} onChange={e=>updateRow(row.id,"homeTeam",e.target.value)} style={{border:"1px solid #ddd",borderRadius:2,padding:"3px 5px",fontFamily:ff,fontSize:11,background:"#fff",color:hLeague?"#111":"#999",width:100}}>
                          <option value="">{row.homeRaw||"?"}</option>
                          {teamNames.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{padding:"4px 2px",textAlign:"center",fontSize:9,color:hWon?"#007a00":RED,fontWeight:800,borderRight:"1px solid #eee",whiteSpace:"nowrap"}}>{hWon?"WIN":"LOSS"}</td>
                      <td style={{padding:"7px 6px",borderRight:"1px solid #eee"}}>
                        <NumField value={row.homeScore} onChange={v=>updateRow(row.id,"homeScore",v)} width={44} fontSize={14} style={{padding:"3px 5px",color:hWon?"#007a00":RED,background:"transparent",border:"1px solid #ddd"}}/>
                      </td>
                      <td style={{padding:"4px",textAlign:"center",color:"#bbb",fontWeight:700,borderRight:"1px solid #eee"}}>—</td>
                      <td style={{padding:"7px 6px",borderRight:"1px solid #eee"}}>
                        <NumField value={row.awayScore} onChange={v=>updateRow(row.id,"awayScore",v)} width={44} fontSize={14} style={{padding:"3px 5px",color:!hWon?"#007a00":RED,background:"transparent",border:"1px solid #ddd"}}/>
                      </td>
                      <td style={{padding:"4px 2px",textAlign:"center",fontSize:9,color:!hWon?"#007a00":RED,fontWeight:800,borderRight:"1px solid #eee",whiteSpace:"nowrap"}}>{!hWon?"WIN":"LOSS"}</td>
                      <td style={{padding:"7px 6px",borderRight:"1px solid #eee"}}>
                        <select value={row.awayTeam} onChange={e=>updateRow(row.id,"awayTeam",e.target.value)} style={{border:"1px solid #ddd",borderRadius:2,padding:"3px 5px",fontFamily:ff,fontSize:11,background:"#fff",color:aLeague?"#111":"#999",width:100}}>
                          <option value="">{row.awayRaw||"?"}</option>
                          {teamNames.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{padding:"7px 8px",textAlign:"center",borderRight:"1px solid #eee"}}>
                        <span style={{fontSize:10,fontWeight:700,color:confC(conf),background:conf==="exact"?"#f0f8f0":conf==="fuzzy"?"#fffbf0":"#fff8f8",padding:"2px 6px",borderRadius:2,border:`1px solid ${confC(conf)}`,whiteSpace:"nowrap"}}>{confL(conf)}</span>
                      </td>
                      <td style={{padding:"7px 8px"}}>
                        {winnerIsLeague&&<div style={{display:"flex",gap:8,justifyContent:"center"}}>
                          <label style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:"#888",cursor:"pointer",whiteSpace:"nowrap"}}>
                            <input type="checkbox" checked={row.ranked25} onChange={e=>{updateRow(row.id,"ranked25",e.target.checked);if(e.target.checked)updateRow(row.id,"ranked10",false);}}/>T25
                          </label>
                          <label style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:RED,cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>
                            <input type="checkbox" checked={row.ranked10} onChange={e=>{updateRow(row.id,"ranked10",e.target.checked);if(e.target.checked)updateRow(row.id,"ranked25",false);}}/>T10
                          </label>
                        </div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{background:"#fffbf0",border:"1px solid #ffe88a",borderRadius:2,padding:"10px 14px",fontSize:12,color:"#665500",marginBottom:14}}>
          Clicking <strong>Confirm</strong> records all results, updates dynasty points, and advances to Week {week+1}. This cannot be undone.
        </div>
        <button onClick={handleConfirm} style={{background:"#007a00",color:"#fff",border:"none",borderRadius:2,padding:"12px 26px",cursor:"pointer",fontFamily:ff,fontSize:14,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5}}>✓ Confirm & Record All Results</button>
      </>}

      {successInfo&&<div style={{marginTop:12,background:"#f0f8f0",border:"1px solid #cce5cc",borderRadius:2,padding:"12px 16px",fontSize:13,color:"#007a00",fontWeight:700}}>✅ {successInfo.count} result{successInfo.count!==1?"s":""} recorded for Week {successInfo.week}! Dynasty points calculated and season advanced.</div>}
    </div></Card>
  );
}

// ── HistoricalImportPanel ─────────────────────────────────────────────────
function HistoricalImportPanel({setupRows, history, onImport}) {
  const currentCalYear = new Date().getFullYear();
  const YEARS = Array.from({length: currentCalYear - 2009}, (_, i) => currentCalYear - 1 - i);
  const [year, setYear] = useState(YEARS[0]);
  const [pts, setPts] = useState({});
  const [nattyWinners, setNattyWinners] = useState([]);
  const [nattyRunners, setNattyRunners] = useState([]);
  const [confWinners, setConfWinners] = useState([]);
  const [confRunners, setConfRunners] = useState([]);
  function toggleArr(arr, setArr, val) { setArr(prev=>prev.includes(val)?prev.filter(x=>x!==val):[...prev,val]); }
  const [heisman, setHeisman] = useState("");
  const [teamDetails, setTeamDetails] = useState({});
  const [expanded, setExpanded] = useState({});
  const [saved, setSaved] = useState(false);
  const teamRows = (setupRows||[]).filter(r=>r.userName&&r.teamName);
  const alreadyImported = (y) => history.some(s=>s.isHistorical&&s.year===y);

  function setDetail(teamName, field, val) {
    setTeamDetails(prev=>({...prev,[teamName]:{...(prev[teamName]||{}),[field]:val}}));
  }
  function getDetail(teamName, field, def="") {
    return teamDetails[teamName]?.[field]??def;
  }

  function handleSave() {
    if (!teamRows.length) return alert("No teams configured yet.");
    const standings = teamRows.map(r=>{
      const d = teamDetails[r.teamName]||{};
      return {
        userName: r.userName, teamName: r.teamName,
        historicalTotal: parseInt(pts[r.teamName])||0,
        wins: parseInt(d.wins)||0,
        losses: parseInt(d.losses)||0,
        confWins:0, confLosses:0,
        gamePts:0, rankedBonusPts:0, confStandPts:0, confChampPts:0,
        bowlPts:0, recruitingPts:0, prestigePts:0, heismanPts:0,
        weekLog:[], h2h:{},
        // Extended historical stats
        playoffWins: parseInt(d.playoffWins)||0,
        playoffLosses: parseInt(d.playoffLosses)||0,
        bowlWins: parseInt(d.bowlWins)||0,
        bowlLosses: parseInt(d.bowlLosses)||0,
        nattyWins: parseInt(d.nattyWins)||0,
        nattyLosses: parseInt(d.nattyLosses)||0,
        confChampWins: parseInt(d.confChampWins)||0,
        confChampLosses: parseInt(d.confChampLosses)||0,
        top25Wins: parseInt(d.top25Wins)||0,
        top25Losses: parseInt(d.top25Losses)||0,
        top10Wins: parseInt(d.top10Wins)||0,
        top10Losses: parseInt(d.top10Losses)||0,
        // Championship flags
        nattyWinner: nattyWinners.includes(r.teamName),
        confChampion: confWinners.includes(r.teamName),
      };
    });
    const sortedByPts=[...standings].sort((a,b)=>b.historicalTotal-a.historicalTotal);
    onImport({
      year, seasonNum:null, isHistorical:true, finalStandings:standings,
      champion:sortedByPts[0]?.userName||"",
      nattyWinner: nattyWinners.join(", "),
      nattyWinners,
      nattyRunnerUp: nattyRunners.join(", "),
      confChampion: confWinners.join(", "),
      confWinners,
      confRunnerUp: confRunners.join(", "),
      heisman,
    });
    setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  const inp = (val, onChange, w=70, extra={}) => (
    <NumField value={val} onChange={onChange} width={w} fontSize={14} style={{padding:"5px 8px",border:"1px solid #ccc",...extra}}/>
  );
  const TeamSel = ({value, onChange, placeholder="-- None --"}) => (
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{padding:"6px 8px",border:"1px solid #ccc",borderRadius:2,fontSize:13,fontFamily:"'Helvetica Neue',Arial,sans-serif",background:"#fff",color:"#111",minWidth:120}}>
      <option value="">{placeholder}</option>
      {teamRows.map(r=><option key={r.teamName} value={r.teamName}>{r.teamName} ({r.userName})</option>)}
    </select>
  );

  return (
    <Card>
      <CardHead bg="#333">📥 Historical Season Import</CardHead>
      <div style={{padding:16}}>
        <div style={{fontSize:12,color:"#888",marginBottom:14,lineHeight:1.5}}>Import a past season with final standings, championships, and per-team records. These appear in Season History and player profiles.</div>

        {/* Year selector */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Season Year</div>
            <select value={year} onChange={e=>{setYear(Number(e.target.value));setSaved(false);}} style={{fontSize:15,fontWeight:700,padding:"7px 10px",border:`2px solid ${alreadyImported(year)?"#cc7700":"#cc0000"}`,borderRadius:2,background:"#fff",fontFamily:"'Helvetica Neue',Arial,sans-serif",cursor:"pointer"}}>
              {YEARS.map(y=><option key={y} value={y}>{y}{alreadyImported(y)?" (imported)":""}</option>)}
            </select>
          </div>
          {alreadyImported(year)&&<div style={{padding:"6px 12px",background:"#fffbf0",border:"1px solid #f0c040",borderRadius:2,fontSize:12,color:"#886600",fontWeight:600}}>⚠ Already imported — saving will add a second entry for this year</div>}
        </div>

        {/* Team Points */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:10,borderLeft:"3px solid #cc0000",paddingLeft:8}}>Dynasty Points per Team</div>
          {teamRows.length===0&&<div style={{color:"#aaa",fontSize:13,padding:"10px 0"}}>No teams found. Set up the league first.</div>}
          {teamRows.map(r=>(
            <div key={r.teamName} style={{borderBottom:"1px solid #f0f0f0"}}>
              {/* Team row header */}
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0"}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#111"}}>{r.userName}</div>
                  <div style={{fontSize:10,color:"#aaa",textTransform:"uppercase",letterSpacing:0.5}}>{r.teamName}</div>
                </div>
                {inp(pts[r.teamName]||"", val=>setPts(p=>({...p,[r.teamName]:val})), 80)}
                <div style={{fontSize:11,color:"#888",width:24,flexShrink:0}}>pts</div>
                <button onClick={()=>setExpanded(p=>({...p,[r.teamName]:!p[r.teamName]}))}
                  style={{padding:"4px 10px",borderRadius:2,border:"1px solid #ddd",background:expanded[r.teamName]?"#f0f0f0":"#fff",color:"#555",cursor:"pointer",fontSize:11,fontFamily:"'Helvetica Neue',Arial,sans-serif",fontWeight:700,flexShrink:0}}>
                  {expanded[r.teamName]?"▲ Less":"▼ Details"}
                </button>
              </div>
              {/* Expanded per-team detail */}
              {expanded[r.teamName]&&(
                <div style={{background:"#f9f9f9",border:"1px solid #eee",borderRadius:2,padding:"12px 14px",marginBottom:10,display:"flex",flexDirection:"column",gap:10}}>
                  {/* Season W/L */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>Season Record</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"wins"), v=>setDetail(r.teamName,"wins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"losses"), v=>setDetail(r.teamName,"losses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                    <div style={{fontSize:11,color:"#888"}}>(counts toward all-time record)</div>
                  </div>
                  {/* Playoff record */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>Playoff Record</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"playoffWins"), v=>setDetail(r.teamName,"playoffWins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"playoffLosses"), v=>setDetail(r.teamName,"playoffLosses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                  </div>
                  {/* Bowl result */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>Bowl Game</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"bowlWins"), v=>setDetail(r.teamName,"bowlWins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"bowlLosses"), v=>setDetail(r.teamName,"bowlLosses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                  </div>
                  {/* National Championship */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>Natl Champ</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"nattyWins"), v=>setDetail(r.teamName,"nattyWins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"nattyLosses"), v=>setDetail(r.teamName,"nattyLosses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                    <div style={{fontSize:11,color:"#888"}}>(titles won counted in Awards below)</div>
                  </div>
                  {/* Conference Championship */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>Conf Champ</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"confChampWins"), v=>setDetail(r.teamName,"confChampWins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"confChampLosses"), v=>setDetail(r.teamName,"confChampLosses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                    <div style={{fontSize:11,color:"#888"}}>(titles won counted in Awards below)</div>
                  </div>
                  {/* vs Top 25 */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>vs Top 25</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"top25Wins"), v=>setDetail(r.teamName,"top25Wins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"top25Losses"), v=>setDetail(r.teamName,"top25Losses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                  </div>
                  {/* vs Top 10 */}
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#333",width:120}}>vs Top 10</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {inp(getDetail(r.teamName,"top10Wins"), v=>setDetail(r.teamName,"top10Wins",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>W</span>
                      {inp(getDetail(r.teamName,"top10Losses"), v=>setDetail(r.teamName,"top10Losses",v), 50)}
                      <span style={{color:"#888",fontWeight:700}}>L</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Awards & Championships */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:12,borderLeft:"3px solid #cc0000",paddingLeft:8}}>Awards & Championships</div>
          {/* Multi-select helper */}
          {(()=>{
            const MultiCheck = ({label, selected, onToggle}) => (
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#888",marginBottom:6}}>{label}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {teamRows.map(r=>{const on=selected.includes(r.teamName);return(
                    <button key={r.teamName} onClick={()=>onToggle(r.teamName)}
                      style={{padding:"4px 10px",borderRadius:2,border:`1px solid ${on?"#cc0000":"#ddd"}`,background:on?"#cc0000":"#fff",color:on?"#fff":"#555",cursor:"pointer",fontSize:12,fontFamily:"'Helvetica Neue',Arial,sans-serif",fontWeight:700}}>
                      {r.teamName}
                    </button>
                  );})}
                </div>
                {selected.length>0&&<div style={{fontSize:11,color:"#cc0000",marginTop:4,fontWeight:600}}>{selected.join(", ")}</div>}
              </div>
            );
            return (
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <MultiCheck label="🏈 National Championship Winner(s)" selected={nattyWinners} onToggle={v=>toggleArr(nattyWinners,setNattyWinners,v)}/>
                <MultiCheck label="National Championship Runner-Up(s)" selected={nattyRunners} onToggle={v=>toggleArr(nattyRunners,setNattyRunners,v)}/>
                <MultiCheck label="🏅 Conference Championship Winner(s)" selected={confWinners} onToggle={v=>toggleArr(confWinners,setConfWinners,v)}/>
                <MultiCheck label="Conference Championship Runner-Up(s)" selected={confRunners} onToggle={v=>toggleArr(confRunners,setConfRunners,v)}/>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:"#888",marginBottom:5}}>🏆 Heisman Winner</div>
                  <TeamSel value={heisman} onChange={setHeisman} placeholder="-- None --"/>
                </div>
              </div>
            );
          })()}
        </div>

        <button onClick={handleSave} style={{background:saved?"#007a00":"#cc0000",color:"#fff",border:"none",borderRadius:2,padding:"12px 28px",cursor:"pointer",fontFamily:"'Helvetica Neue',Arial,sans-serif",fontSize:14,fontWeight:800,textTransform:"uppercase"}}>
          {saved?"✓ Season Saved!":"Save Season →"}
        </button>
      </div>
    </Card>
  );
}

// ── EnterResultsPanel ─────────────────────────────────────────────────────
function EnterResultsPanel({entries,weekResults,setWeekResults,week,setWeek,applyBulkResults,applyWeekResults,postSeasonInputs,setPSI,applyPostSeason,finalizeSeason,season,setSeason,year,setYear,teamNames,schedule,history,onImportHistory,setupRows,saveToDb,setup,setSetup,postWeekRecapToGroupMe,postGameOfWeekPreview}) {
  const pc = {...DEFAULT_PTS_CONFIG,...(setup?.pointsConfig||{})}; // live points config, for accurate in-progress point hints below
  const [entryWeek,setEntryWeek] = useState(week);
  const [resultsTab,setResultsTab] = useState("weekly");
  const [scanning,setScanning] = useState(null);
  const [scanErrors,setScanErrors] = useState({});
  const [submitMsg,setSubmitMsg] = useState("");
  const [expandedBox,setExpandedBox] = useState({});
  const [gmStatus,setGmStatus] = useState({});
  const [gmResendStatus,setGmResendStatus] = useState(null);
  const fileRefs = useRef({});

  // Manual fallback for the auto GroupMe post that's supposed to fire on week advance — resends
  // the just-completed week's recap/standings, then (after the same stagger gap used
  // automatically) the upcoming week's Game of the Week preview. Both post functions already
  // catch and alert() their own failures, so there's nothing more to report here on completion —
  // just clear the "Sending..." state either way.
  async function resendGroupMeUpdate(){
    if(!window.confirm(`Resend to GroupMe: Week ${week-1} recap + standings, then the Week ${week} Game of the Week preview?\nThis will use the Claude API multiple times.`))return;
    setGmResendStatus("sending");
    await postWeekRecapToGroupMe(week-1, entries);
    await sleep(GOTW_STAGGER_MS);
    await postGameOfWeekPreview(week, entries);
    setGmResendStatus(null);
  }

  async function submitScoreToGroupMe(key,team1,team2){
    if(!window.confirm(`Post ${team1.name} ${team1.score} - ${team2.score} ${team2.name} to GroupMe with an AI recap?\nThis will use the Claude API.`))return;
    setGmStatus(p=>({...p,[key]:"sending"}));
    try{
      const statLine=t=>`${t.name}: ${t.passing?.comp??0}/${t.passing?.att??0}, ${t.passing?.yds??0} pass yds, ${t.passing?.tds??0} pass TD | ${t.rushing?.yds??0} rush yds, ${t.rushing?.tds??0} rush TD | ${t.misc?.turnovers??0} turnovers`;
      const prompt=`Write a 4-5 sentence game recap for a dynasty college football league group chat. Be punchy and conversational, like a quick update to friends in a group chat — not a formal news article. No headline, no markdown, just the recap paragraph.\n\nFinal score: ${team1.name} ${team1.score} - ${team2.score} ${team2.name}\n\n${statLine(team1)}\n${statLine(team2)}`;
      const recap=(await callClaude(prompt)).trim();
      if(!recap||recap==="No content returned.")throw new Error("Claude didn't return a recap — try again");
      const text=`🏈 FINAL: ${team1.name} ${team1.score} - ${team2.score} ${team2.name}\n\n${recap}`;
      await postToGroupMe(text);
      setGmStatus(p=>({...p,[key]:"sent"}));
      setTimeout(()=>setGmStatus(p=>{const n={...p};delete n[key];return n;}),4000);
    }catch(e){
      setGmStatus(p=>{const n={...p};delete n[key];return n;});
      alert("Failed to post to GroupMe: "+e.message);
    }
  }

  const setWR=(teamName,field,val)=>setWeekResults(prev=>prev.map(r=>r.teamName===teamName?{...r,[field]:val}:r));
  const getWR=(teamName)=>weekResults.find(r=>r.teamName===teamName)||{result:"none",ranked25:false,ranked10:false,forfeit:false};
  const thisWeekSchedule = schedule?.[entryWeek]||{};

  // weekResults (pending, un-submitted win/loss picks) isn't persisted to the DB —
  // it resets to "none" on every page load. If a box score was already scanned and
  // archived for this week but never submitted, re-derive the win/loss from the
  // archived score so the Override buttons (and the Submit button) reflect it
  // instead of silently treating the game as if nothing had been entered.
  useEffect(()=>{
    const archive=(setup?.gameArchive||[]).filter(g=>g.year===Number(year)&&g.week===Number(entryWeek));
    if(!archive.length) return;
    setWeekResults(prev=>{
      let changed=false;
      const next=prev.map(r=>{
        if(r.result!=="none") return r;
        const game=archive.find(g=>g.team1.name===r.teamName||g.team2.name===r.teamName);
        if(!game) return r;
        const mine=game.team1.name===r.teamName?game.team1:game.team2;
        const opp=game.team1.name===r.teamName?game.team2:game.team1;
        if(mine.score===opp.score) return r;
        changed=true;
        return {...r,result:mine.score>opp.score?"win":"loss"};
      });
      return changed?next:prev;
    });
  },[setup?.gameArchive,entryWeek,year]);

  // Instant Classic — a lightweight tag on a specific game (year/week/team pair), independent
  // of gameArchive so it can be set whether or not a box score has been scanned for the game.
  const classicKey=(y,w,t1,t2)=>`${y}|${w}|${[t1,t2].sort().join("||")}`;
  const isClassic=(t1,t2)=>(setup?.classicGames||[]).some(c=>classicKey(c.year,c.week,c.teamA,c.teamB)===classicKey(Number(year),Number(entryWeek),t1,t2));
  function toggleClassic(t1,t2){
    const k=classicKey(Number(year),Number(entryWeek),t1,t2);
    const cur=setup?.classicGames||[];
    const exists=cur.some(c=>classicKey(c.year,c.week,c.teamA,c.teamB)===k);
    const next=exists?cur.filter(c=>classicKey(c.year,c.week,c.teamA,c.teamB)!==k):[...cur,{year:Number(year),week:Number(entryWeek),season:Number(season),teamA:t1,teamB:t2,markedAt:new Date().toISOString()}];
    const updatedSetup={...setup,classicGames:next};
    setSetup(updatedSetup); saveToDb({setup:updatedSetup});
  }

  // Build matchup pairs from schedule
  const isCPUval=isCPUOpp;
  const getCPUName=(v)=>cpuOppName(v)||"CPU";
  const confPairs=[], cpuTeams=[], byeTeams=[];
  const seen=new Set();
  for(const [team,opp] of Object.entries(thisWeekSchedule)){
    if(opp==="BYE"){byeTeams.push(team);continue;}
    if(isCPUval(opp)){cpuTeams.push({teamName:team,cpuName:getCPUName(opp)});continue;}
    if(!opp)continue;
    const key=[team,opp].sort().join("|");
    if(!seen.has(key)){seen.add(key);confPairs.push([team,opp]);}
  }
  // Teams with no schedule entry (if schedule not fully set)
  const scheduledNames=new Set([...Object.keys(thisWeekSchedule),...byeTeams,...cpuTeams.map(c=>c.teamName),...confPairs.flat()]);
  entries.filter(e=>!scheduledNames.has(e.teamName)).forEach(e=>byeTeams.push(e.teamName));
  const unscheduled=[];

  async function handleBoxScoreUpload(t1Name,t2Name,e){
    const files=Array.from(e.target.files||[]).slice(0,2); if(!files.length) return;
    const key=[t1Name,t2Name].sort().join("|");
    if(!window.confirm(`Scan box score for ${t1Name} vs ${t2Name}?\nThis will use the Claude Vision API.`)){
      if(fileRefs.current[key])fileRefs.current[key].value=""; return;
    }
    setScanning(key); setScanErrors(p=>({...p,[key]:null}));
    try {
      const images=await Promise.all(files.map(file=>downscaleImage(file)));
      const parsed=await scanBoxScoreBothSides(images);
      const json={...parsed, ...reconcileBoxScoreTeams(parsed,t1Name,t2Name)};
      const e1=entries.find(e=>e.teamName===t1Name); const e2=entries.find(e=>e.teamName===t2Name);
      json.team1.name=t1Name; json.team1.userId=e1?.userId||"";
      json.team2.name=t2Name; json.team2.userId=e2?.userId||"";
      // Set week results from score
      const t1wins=json.team1.score>json.team2.score;
      setWeekResults(prev=>prev.map(r=>{
        if(r.teamName===t1Name) return{...r,result:t1wins?"win":"loss"};
        if(r.teamName===t2Name) return{...r,result:t1wins?"loss":"win"};
        return r;
      }));
      // Save to game archive
      if(setup&&setSetup){
        const newGame={id:genId(),year:Number(year),week:Number(entryWeek),season:Number(season),team1:json.team1,team2:json.team2};
        const archive=setup?.gameArchive||[];
        const filtered=archive.filter(g=>!(g.year===Number(year)&&g.week===Number(entryWeek)&&
          ((g.team1.name===t1Name&&g.team2.name===t2Name)||(g.team1.name===t2Name&&g.team2.name===t1Name))));
        const newArchive=[...filtered,newGame];
        const newPlayerStats=recomputePlayerStatsFromArchive(newArchive,setup?.playerStats||{},year);
        const updatedSetup={...setup,gameArchive:newArchive,playerStats:newPlayerStats};
        setSetup(updatedSetup); saveToDb({setup:updatedSetup});
      }
    } catch(err){setScanErrors(p=>({...p,[key]:"Scan failed: "+err.message}));}
    finally{setScanning(null); if(fileRefs.current[key])fileRefs.current[key].value="";}
  }

  // The vision scan occasionally reads both teams' stat columns correctly but attaches the
  // whole block to the wrong team name (see buildBoxScoreSidePrompt's comment on this failure
  // mode) — most often when the two names are similar enough (e.g. "Oregon" vs "Oregon State")
  // that reconcileBoxScoreTeams' name-similarity check picks the wrong side too. This swaps the
  // stat content between team1/team2 while keeping each side's real name/userId pinned in place,
  // so the commissioner can fix a mismatched scan without re-scanning from scratch.
  function swapBoxScoreSides(archivedGame){
    if(!window.confirm(`Swap ${archivedGame.team1.name} and ${archivedGame.team2.name}'s stats?\nUse this if the box score scan attached the wrong team's stats to each side.`)) return;
    const {name:n1,userId:u1,...rest1}=archivedGame.team1;
    const {name:n2,userId:u2,...rest2}=archivedGame.team2;
    const team1={name:n1,userId:u1,...rest2};
    const team2={name:n2,userId:u2,...rest1};
    const archive=setup?.gameArchive||[];
    const newArchive=archive.map(g=>g.id===archivedGame.id?{...g,team1,team2}:g);
    const newPlayerStats=recomputePlayerStatsFromArchive(newArchive,setup?.playerStats||{},year);
    const updatedSetup={...setup,gameArchive:newArchive,playerStats:newPlayerStats};
    setSetup(updatedSetup); saveToDb({setup:updatedSetup});
    const t1wins=team1.score>team2.score;
    setWeekResults(prev=>prev.map(r=>{
      if(r.teamName===team1.name) return{...r,result:t1wins?"win":"loss"};
      if(r.teamName===team2.name) return{...r,result:t1wins?"loss":"win"};
      return r;
    }));
  }

  const btnStyle=(active,color="#007a00")=>({padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:active?color:"#ddd",background:active?`${color}18`:"#fff",color:active?color:"#888",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:800,textTransform:"uppercase"});

  function submitAndFlash(targetWeek,goBack){
    // applyWeekResults advances the shared `week` state whenever targetWeek>=week — mirror that
    // same condition here so this panel's own week cursor doesn't get left behind, which otherwise
    // made Submit Week look like it did nothing (data saved, but the form kept showing the old week).
    const willAdvance = targetWeek>=week;
    applyWeekResults(targetWeek);
    setSubmitMsg(`✓ Week ${targetWeek} results saved`);
    setTimeout(()=>setSubmitMsg(""),3000);
    if(goBack)setEntryWeek(w=>Math.max(0,w-1));
    else if(willAdvance)setEntryWeek(targetWeek+1);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Internal tab switcher */}
      <Card style={{overflow:"hidden"}}>
        <div style={{display:"flex",borderBottom:"2px solid #eee"}}>
          <button onClick={()=>setResultsTab("weekly")} style={{flex:1,padding:"12px 16px",background:"transparent",border:"none",borderBottom:resultsTab==="weekly"?`3px solid ${RED}`:"3px solid transparent",color:resultsTab==="weekly"?"#111":"#888",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5}}>📋 Week Entry</button>
          <button onClick={()=>setResultsTab("historical")} style={{flex:1,padding:"12px 16px",background:"transparent",border:"none",borderBottom:resultsTab==="historical"?`3px solid #333`:"3px solid transparent",color:resultsTab==="historical"?"#111":"#888",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5}}>📥 Historical Import</button>
        </div>
      </Card>

      {resultsTab==="historical"&&<HistoricalImportPanel setupRows={setupRows} history={history||[]} onImport={onImportHistory}/>}
      {resultsTab==="weekly"&&<>

      {/* Week navigation */}
      <Card>
        <div style={{padding:"12px 16px",display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Season</div>
              <select value={season} onChange={e=>{const s=Number(e.target.value);setSeason(s);if(saveToDb)saveToDb({season:s});}} style={{fontSize:14,fontWeight:700,color:"#111",padding:"6px 10px",background:"#fff",border:`2px solid ${RED}`,borderRadius:2,cursor:"pointer",fontFamily:ff,minWidth:55}}>
                {Array.from({length:20},(_,i)=>i+1).map(s=><option key={s} value={s}>S{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Year</div>
              <select value={year} onChange={e=>{const y=Number(e.target.value);setYear(y);if(saveToDb)saveToDb({year:y});}} style={{fontSize:14,fontWeight:700,color:"#111",padding:"6px 10px",background:"#fff",border:`2px solid ${RED}`,borderRadius:2,cursor:"pointer",fontFamily:ff,minWidth:70}}>
                {Array.from({length:20},(_,i)=>2020+i).map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setEntryWeek(w=>Math.max(0,w-1))} disabled={entryWeek<=0} style={{padding:"8px 14px",background:"#f0f0f0",border:"1px solid #ddd",borderRadius:2,cursor:entryWeek<=0?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:entryWeek<=0?"#ccc":"#333",fontFamily:ff}}>← Prev</button>
            <div style={{textAlign:"center",minWidth:80}}>
              <div style={{fontSize:18,fontWeight:900,color:"#111"}}>{({14:"Conf. Champ.",15:"Bowl Games",16:"Playoffs — R1",17:"Playoffs — R2",18:"Playoffs — R3",19:"Natl. Championship",20:"Offseason Awards"})[entryWeek]||`Week ${entryWeek}`}</div>
              {entryWeek===week&&<div style={{fontSize:9,color:"#007a00",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>Current</div>}
              {entryWeek!==week&&<button onClick={()=>{setWeek(entryWeek);saveToDb({week:entryWeek});}} style={{fontSize:9,color:"#1a3a6b",fontWeight:700,textTransform:"uppercase",background:"none",border:"none",cursor:"pointer",fontFamily:ff,letterSpacing:1}}>Set Current</button>}
            </div>
            <button onClick={()=>setEntryWeek(w=>Math.min(20,w+1))} disabled={entryWeek>=20} style={{padding:"8px 14px",background:"#f0f0f0",border:"1px solid #ddd",borderRadius:2,cursor:entryWeek>=20?"not-allowed":"pointer",fontSize:13,fontWeight:700,color:entryWeek>=20?"#ccc":"#333",fontFamily:ff}}>Next →</button>
          </div>
        </div>
      </Card>

      {entryWeek<=13&&<>
        {/* Conference matchups */}
        {confPairs.length>0&&<Card style={{overflow:"hidden"}}>
          <CardHead bg="#1a3a6b">Week {entryWeek} — Conference Matchups</CardHead>
          <div style={{display:"flex",flexDirection:"column"}}>
            {confPairs.map(([t1,t2])=>{
              const key=[t1,t2].sort().join("|");
              const wr1=getWR(t1), wr2=getWR(t2);
              const isScanning=scanning===key;
              const archivedGame=(setup?.gameArchive||[]).find(g=>g.year===Number(year)&&g.week===Number(entryWeek)&&((g.team1.name===t1&&g.team2.name===t2)||(g.team1.name===t2&&g.team2.name===t1)));
              const winner=wr1.result==="win"?t1:wr2.result==="win"?t2:null;
              const e1=entries.find(e=>e.teamName===t1), e2=entries.find(e=>e.teamName===t2);
              return(
                <div key={key} style={{borderBottom:"1px solid #eee"}}>
                  {/* Matchup header */}
                  <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",background:winner?"#f0f8f0":"#fff"}}>
                    {/* Team 1 */}
                    <div style={{flex:1,minWidth:100}}>
                      <div style={{fontSize:13,fontWeight:900,color:wr1.result==="win"?"#007a00":wr1.result==="loss"?"#aaa":"#111"}}>{t1}{wr1.forfeit&&<span style={{marginLeft:6,fontSize:9,fontWeight:800,color:"#b8860b",background:"#fff8e6",border:"1px solid #b8860b44",borderRadius:2,padding:"1px 5px",verticalAlign:"middle"}}>FORFEIT</span>}</div>
                      {e1?.userName&&<div style={{fontSize:10,color:"#888"}}>{e1.userName}</div>}
                      {archivedGame&&<div style={{fontSize:20,fontWeight:900,color:wr1.result==="win"?"#007a00":"#555",marginTop:2}}>{(archivedGame.team1.name===t1?archivedGame.team1:archivedGame.team2).score}</div>}
                    </div>
                    <div style={{fontSize:11,fontWeight:800,color:"#bbb",flexShrink:0}}>VS</div>
                    {/* Team 2 */}
                    <div style={{flex:1,minWidth:100,textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:900,color:wr2.result==="win"?"#007a00":wr2.result==="loss"?"#aaa":"#111"}}>{wr2.forfeit&&<span style={{marginRight:6,fontSize:9,fontWeight:800,color:"#b8860b",background:"#fff8e6",border:"1px solid #b8860b44",borderRadius:2,padding:"1px 5px",verticalAlign:"middle"}}>FORFEIT</span>}{t2}</div>
                      {e2?.userName&&<div style={{fontSize:10,color:"#888"}}>{e2.userName}</div>}
                      {archivedGame&&<div style={{fontSize:20,fontWeight:900,color:wr2.result==="win"?"#007a00":"#555",marginTop:2}}>{(archivedGame.team1.name===t2?archivedGame.team1:archivedGame.team2).score}</div>}
                    </div>
                    {/* Upload button */}
                    <label title="Select both screenshots at once (Ctrl/Cmd-click, or shift-select) if the box score is split across two images" style={{background:archivedGame?"#1a3a6b":RED,color:"#fff",fontSize:11,fontWeight:700,padding:"7px 12px",borderRadius:2,cursor:isScanning?"wait":"pointer",opacity:isScanning?0.6:1,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,flexShrink:0,whiteSpace:"nowrap"}}>
                      {isScanning?"Scanning...":(archivedGame?"Replace":"📷 Box Score")}
                      <input type="file" accept="image/*" multiple style={{display:"none"}} ref={el=>fileRefs.current[key]=el} onChange={e=>handleBoxScoreUpload(t1,t2,e)} disabled={!!scanning}/>
                    </label>
                  </div>
                  {scanErrors[key]&&<div style={{padding:"6px 16px",fontSize:11,color:RED,background:"#fff0f0"}}>{scanErrors[key]}</div>}
                  {/* Manual override + ranked checkboxes */}
                  <div style={{padding:"8px 16px 12px",background:"#fafafa",display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase"}}>Override:</span>
                      {[{label:t1,win:t1,loss:t2},{label:t2,win:t2,loss:t1}].map(opt=>(
                        <button key={opt.label} onClick={()=>{setWR(opt.win,"result","win");setWR(opt.win,"forfeit",false);setWR(opt.loss,"result","loss");setWR(opt.loss,"forfeit",false);}} style={btnStyle(winner===opt.win&&!getWR(opt.win).forfeit)}>{opt.label} W</button>
                      ))}
                      <button onClick={()=>{setWR(t1,"result","none");setWR(t1,"forfeit",false);setWR(t2,"result","none");setWR(t2,"forfeit",false);}} style={btnStyle(!winner,"#888")}>Clear</button>
                      <span style={{width:1,height:16,background:"#ddd",margin:"0 2px"}}/>
                      {[{label:t1,win:t1,loss:t2},{label:t2,win:t2,loss:t1}].map(opt=>(
                        <button key={"f-"+opt.label} onClick={()=>{setWR(opt.win,"result","win");setWR(opt.win,"forfeit",true);setWR(opt.win,"ranked25",false);setWR(opt.win,"ranked10",false);setWR(opt.loss,"result","loss");setWR(opt.loss,"forfeit",true);}} title={`${opt.loss} couldn't play — ${opt.win} gets a forced win, no stats`} style={btnStyle(winner===opt.win&&getWR(opt.win).forfeit,"#b8860b")}>{opt.label} Win by Forfeit</button>
                      ))}
                      <span style={{width:1,height:16,background:"#ddd",margin:"0 2px"}}/>
                      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:isClassic(t1,t2)?"#b8860b":"#888",fontWeight:isClassic(t1,t2)?800:400,cursor:"pointer"}}>
                        <input type="checkbox" checked={isClassic(t1,t2)} onChange={()=>toggleClassic(t1,t2)}/> 🏆 Instant Classic
                      </label>
                    </div>
                    {winner&&!getWR(winner).forfeit&&<div style={{display:"flex",gap:10,marginLeft:"auto"}}>
                      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}>
                        <input type="checkbox" checked={getWR(winner).ranked25||false} onChange={e=>setWR(winner,"ranked25",e.target.checked)}/> vs Top 25
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:RED,cursor:"pointer",fontWeight:700}}>
                        <input type="checkbox" checked={getWR(winner).ranked10||false} onChange={e=>setWR(winner,"ranked10",e.target.checked)}/> vs Top 10
                      </label>
                    </div>}
                    {winner&&getWR(winner).forfeit&&<div style={{marginLeft:"auto",fontSize:11,color:"#b8860b",fontWeight:700,fontStyle:"italic"}}>No box score — forfeit win/loss, no ranked bonus</div>}
                  </div>
                  {/* Archived stats preview */}
                  {archivedGame&&<div style={{padding:"4px 16px 10px",background:"#f0f8f0",fontSize:10,color:"#555"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                      {[archivedGame.team1,archivedGame.team2].map(t=>(
                        <div key={t.name}>
                          <div><strong>{t.name}:</strong> {t.passing.comp}/{t.passing.att} {t.passing.yds}py {t.passing.tds}TD | {t.rushing.yds}ry {t.rushing.tds}TD | Def {t.defense.totalYdsAllowed}yds</div>
                          {t.misc&&<div style={{color:"#888",marginTop:1}}>{t.misc.firstDowns} 1st downs | {t.misc.turnovers} TO | 3rd: {t.misc.thirdDownConv}/{t.misc.thirdDownAtt} | TOP {t.misc.timeOfPossession||"-"}</div>}
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:14,marginTop:6,flexWrap:"wrap"}}>
                      <button onClick={()=>setExpandedBox(p=>({...p,[key]:!p[key]}))} style={{background:"none",border:"none",color:"#1a3a6b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer",padding:0,fontFamily:ff}}>{expandedBox[key]?"▲ Hide full box score":"▼ Full box score"}</button>
                      <button onClick={()=>submitScoreToGroupMe(key,archivedGame.team1,archivedGame.team2)} disabled={gmStatus[key]==="sending"} style={{background:gmStatus[key]==="sent"?"#f0f8f0":"none",border:"1px solid #1a3a6b",color:gmStatus[key]==="sent"?"#007a00":"#1a3a6b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:gmStatus[key]==="sending"?"wait":"pointer",padding:"3px 8px",borderRadius:2,fontFamily:ff}}>{gmStatus[key]==="sending"?"Posting...":gmStatus[key]==="sent"?"✓ Posted to GroupMe":"📢 Submit Score to GroupMe"}</button>
                      <button onClick={()=>swapBoxScoreSides(archivedGame)} title="Use this if the scan attached the wrong team's stats to each side" style={{background:"none",border:"none",color:"#b8860b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer",padding:0,fontFamily:ff}}>🔄 Swap Sides</button>
                    </div>
                    {expandedBox[key]&&<div style={{marginTop:8}}><BoxScoreDetail team1={archivedGame.team1} team2={archivedGame.team2}/></div>}
                  </div>}
                </div>
              );
            })}
          </div>
        </Card>}

        {/* CPU games — rendered as matchup cards */}
        {[...cpuTeams,...unscheduled].length>0&&<Card style={{overflow:"hidden"}}>
          <CardHead bg="#444">Week {entryWeek} — CPU Games</CardHead>
          <div style={{display:"flex",flexDirection:"column"}}>
            {[...cpuTeams,...unscheduled].map(({teamName,cpuName})=>{
              const key=`cpu-${teamName}`;
              const wr=getWR(teamName);
              const isScanning=scanning===key;
              const entry=entries.find(e=>e.teamName===teamName);
              const archivedGame=(setup?.gameArchive||[]).find(g=>g.year===Number(year)&&g.week===Number(entryWeek)&&(g.team1.name===teamName||g.team2.name===teamName));
              const myTeamData=archivedGame?(archivedGame.team1.name===teamName?archivedGame.team1:archivedGame.team2):null;
              const cpuTeamData=archivedGame?(archivedGame.team1.name===teamName?archivedGame.team2:archivedGame.team1):null;
              const winner=wr.result==="win"?teamName:wr.result==="loss"?cpuName:null;
              const displayCPU=cpuName&&cpuName!=="CPU"?cpuName:"CPU";
              return(
                <div key={teamName} style={{borderBottom:"1px solid #eee"}}>
                  <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",background:winner?"#f0f8f0":"#fff"}}>
                    {/* Player team */}
                    <div style={{flex:1,minWidth:100}}>
                      <div style={{fontSize:13,fontWeight:900,color:wr.result==="win"?"#007a00":wr.result==="loss"?"#aaa":"#111"}}>{entry?.userName||teamName}</div>
                      <div style={{fontSize:10,color:"#888",textTransform:"uppercase"}}>{teamName}</div>
                      {myTeamData&&<div style={{fontSize:20,fontWeight:900,color:wr.result==="win"?"#007a00":"#555",marginTop:2}}>{myTeamData.score}</div>}
                    </div>
                    <div style={{fontSize:11,fontWeight:800,color:"#bbb",flexShrink:0}}>VS</div>
                    {/* CPU side */}
                    <div style={{flex:1,minWidth:100,textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:900,color:wr.result==="loss"?"#c00":wr.result==="win"?"#aaa":"#888"}}>{displayCPU}{displayCPU!=="CPU"?" (CPU)":""}</div>
                      <div style={{fontSize:10,color:"#ccc",textTransform:"uppercase"}}>{displayCPU==="CPU"?"CPU":"Computer"}</div>
                      {cpuTeamData&&<div style={{fontSize:20,fontWeight:900,color:wr.result==="loss"?"#c00":"#555",marginTop:2}}>{cpuTeamData.score}</div>}
                    </div>
                    {/* Upload button */}
                    <label title="Select both screenshots at once (Ctrl/Cmd-click, or shift-select) if the box score is split across two images" style={{background:archivedGame?"#1a3a6b":RED,color:"#fff",fontSize:11,fontWeight:700,padding:"7px 12px",borderRadius:2,cursor:isScanning?"wait":"pointer",opacity:isScanning?0.6:1,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,flexShrink:0,whiteSpace:"nowrap"}}>
                      {isScanning?"Scanning...":(archivedGame?"Replace":"📷 Box Score")}
                      <input type="file" accept="image/*" multiple style={{display:"none"}} ref={el=>fileRefs.current[key]=el} onChange={ev=>{
                        const files=Array.from(ev.target.files||[]).slice(0,2); if(!files.length) return;
                        if(!window.confirm(`Scan box score for ${teamName} vs ${displayCPU}?\nThis will use the Claude Vision API.`)){if(fileRefs.current[key])fileRefs.current[key].value="";return;}
                        setScanning(key); setScanErrors(p=>({...p,[key]:null}));
                        (async()=>{
                          try{
                            const images=await Promise.all(files.map(file=>downscaleImage(file)));
                            const parsed=await scanBoxScoreBothSides(images);
                            const json={...parsed, ...reconcileBoxScoreTeams(parsed,teamName,displayCPU)};
                            const e1=entries.find(e=>e.teamName===teamName);
                            json.team1.name=teamName; json.team1.userId=e1?.userId||"";
                            json.team2.name=displayCPU; json.team2.userId="";
                            const t1wins=json.team1.score>json.team2.score;
                            setWeekResults(prev=>prev.map(r=>r.teamName===teamName?{...r,result:t1wins?"win":"loss"}:r));
                            if(setup&&setSetup){
                              const newGame={id:genId(),year:Number(year),week:Number(entryWeek),season:Number(season),team1:json.team1,team2:json.team2};
                              const archive=setup?.gameArchive||[];
                              const filtered=archive.filter(g=>!(g.year===Number(year)&&g.week===Number(entryWeek)&&(g.team1.name===teamName||g.team2.name===teamName)));
                              const newArchive=[...filtered,newGame];
                              const newPlayerStats=recomputePlayerStatsFromArchive(newArchive,setup?.playerStats||{},year);
                              const updatedSetup={...setup,gameArchive:newArchive,playerStats:newPlayerStats};
                              setSetup(updatedSetup); saveToDb({setup:updatedSetup});
                            }
                          }catch(err){setScanErrors(p=>({...p,[key]:"Scan failed: "+err.message}));}
                          finally{setScanning(null);if(fileRefs.current[key])fileRefs.current[key].value="";}
                        })();
                      }} disabled={!!scanning}/>
                    </label>
                  </div>
                  {scanErrors[key]&&<div style={{padding:"6px 16px",fontSize:11,color:RED,background:"#fff0f0"}}>{scanErrors[key]}</div>}
                  <div style={{padding:"8px 16px 12px",background:"#fafafa",display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                    <span style={{fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase"}}>Override:</span>
                    {[{label:`${teamName} W`,res:"win"},{label:`${displayCPU} W`,res:"loss"}].map(opt=>(
                      <button key={opt.res} onClick={()=>setWR(teamName,"result",opt.res)} style={btnStyle(wr.result===opt.res,opt.res==="win"?"#007a00":RED)}>{opt.label}</button>
                    ))}
                    <button onClick={()=>setWR(teamName,"result","none")} style={btnStyle(wr.result==="none","#888")}>Clear</button>
                    <span style={{width:1,height:16,background:"#ddd",margin:"0 2px"}}/>
                    <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:isClassic(teamName,displayCPU)?"#b8860b":"#888",fontWeight:isClassic(teamName,displayCPU)?800:400,cursor:"pointer"}}>
                      <input type="checkbox" checked={isClassic(teamName,displayCPU)} onChange={()=>toggleClassic(teamName,displayCPU)}/> 🏆 Instant Classic
                    </label>
                    {wr.result==="win"&&<div style={{display:"flex",gap:10,marginLeft:"auto"}}>
                      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}><input type="checkbox" checked={wr.ranked25||false} onChange={e=>setWR(teamName,"ranked25",e.target.checked)}/> vs Top 25</label>
                      <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:RED,cursor:"pointer",fontWeight:700}}><input type="checkbox" checked={wr.ranked10||false} onChange={e=>setWR(teamName,"ranked10",e.target.checked)}/> vs Top 10</label>
                    </div>}
                  </div>
                  {archivedGame&&myTeamData&&<div style={{padding:"4px 16px 10px",background:"#f0f8f0",fontSize:10,color:"#555"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                      <div>
                        <div><strong>{teamName}:</strong> {myTeamData.passing.comp}/{myTeamData.passing.att} {myTeamData.passing.yds}py {myTeamData.passing.tds}TD | {myTeamData.rushing.yds}ry {myTeamData.rushing.tds}TD | Def {myTeamData.defense.totalYdsAllowed}yds</div>
                        {myTeamData.misc&&<div style={{color:"#888",marginTop:1}}>{myTeamData.misc.firstDowns} 1st downs | {myTeamData.misc.turnovers} TO | 3rd: {myTeamData.misc.thirdDownConv}/{myTeamData.misc.thirdDownAtt} | TOP {myTeamData.misc.timeOfPossession||"-"}</div>}
                      </div>
                      <div>
                        <div><strong>{displayCPU}:</strong> {cpuTeamData.passing.comp}/{cpuTeamData.passing.att} {cpuTeamData.passing.yds}py {cpuTeamData.passing.tds}TD | {cpuTeamData.rushing.yds}ry {cpuTeamData.rushing.tds}TD</div>
                        {cpuTeamData.misc&&<div style={{color:"#888",marginTop:1}}>{cpuTeamData.misc.firstDowns} 1st downs | {cpuTeamData.misc.turnovers} TO | 3rd: {cpuTeamData.misc.thirdDownConv}/{cpuTeamData.misc.thirdDownAtt} | TOP {cpuTeamData.misc.timeOfPossession||"-"}</div>}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:14,marginTop:6,flexWrap:"wrap"}}>
                      <button onClick={()=>setExpandedBox(p=>({...p,[key]:!p[key]}))} style={{background:"none",border:"none",color:"#1a3a6b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer",padding:0,fontFamily:ff}}>{expandedBox[key]?"▲ Hide full box score":"▼ Full box score"}</button>
                      <button onClick={()=>submitScoreToGroupMe(key,myTeamData,cpuTeamData)} disabled={gmStatus[key]==="sending"} style={{background:gmStatus[key]==="sent"?"#f0f8f0":"none",border:"1px solid #1a3a6b",color:gmStatus[key]==="sent"?"#007a00":"#1a3a6b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:gmStatus[key]==="sending"?"wait":"pointer",padding:"3px 8px",borderRadius:2,fontFamily:ff}}>{gmStatus[key]==="sending"?"Posting...":gmStatus[key]==="sent"?"✓ Posted to GroupMe":"📢 Submit Score to GroupMe"}</button>
                      <button onClick={()=>swapBoxScoreSides(archivedGame)} title="Use this if the scan attached the wrong team's stats to each side" style={{background:"none",border:"none",color:"#b8860b",fontWeight:700,fontSize:10,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer",padding:0,fontFamily:ff}}>🔄 Swap Sides</button>
                    </div>
                    {expandedBox[key]&&<div style={{marginTop:8}}><BoxScoreDetail team1={myTeamData} team2={cpuTeamData}/></div>}
                  </div>}
                </div>
              );
            })}
          </div>
        </Card>}

        {/* BYE teams */}
        {byeTeams.length>0&&<Card style={{overflow:"hidden"}}>
          <CardHead bg="#888">Week {entryWeek} — Bye Teams</CardHead>
          <div style={{padding:14,display:"flex",flexDirection:"column",gap:4}}>
            {byeTeams.map(teamName=>{
              const entry=entries.find(e=>e.teamName===teamName);
              return(<div key={teamName} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}>
                <div style={{minWidth:120}}><div style={{fontSize:13,fontWeight:700,color:"#aaa"}}>{entry?.userName||teamName}</div><div style={{fontSize:10,color:"#ccc",textTransform:"uppercase"}}>{teamName}</div></div>
                <div style={{fontSize:11,color:"#ccc",fontWeight:700,background:"#f5f5f5",padding:"4px 10px",borderRadius:2}}>BYE WEEK</div>
              </div>);
            })}
          </div>
        </Card>}

        {confPairs.length===0&&cpuTeams.length===0&&byeTeams.length===0&&unscheduled.length===0&&<Card><div style={{color:"#bbb",fontSize:12,textAlign:"center",padding:"20px 0"}}>Set the schedule first to see matchups here.</div></Card>}

        {/* Submit */}
        {submitMsg&&<div style={{padding:"8px 14px",background:"#f0f8f0",color:"#007a00",fontWeight:800,fontSize:12,borderRadius:2,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5}}>{submitMsg}</div>}
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {entryWeek>0&&<button onClick={()=>submitAndFlash(entryWeek,true)} style={{padding:"12px 20px",background:"#f0f0f0",border:"1px solid #ddd",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,color:"#555",textTransform:"uppercase"}}>← Submit &amp; Go Back</button>}
          <button onClick={()=>submitAndFlash(entryWeek,false)} style={{flex:1,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"13px 22px",cursor:"pointer",fontFamily:ff,fontSize:14,fontWeight:800,textTransform:"uppercase"}}>
            {entryWeek>=week?`Submit Week ${entryWeek} & Advance to Week ${entryWeek+1} →`:`Submit Week ${entryWeek} →`}
          </button>
        </div>
        {week>0&&<button onClick={resendGroupMeUpdate} disabled={gmResendStatus==="sending"} style={{marginTop:10,background:"none",border:"1px solid #1a3a6b",color:"#1a3a6b",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:0.5,cursor:gmResendStatus==="sending"?"wait":"pointer",padding:"7px 14px",borderRadius:2,fontFamily:ff}}>
          {gmResendStatus==="sending"?"Sending to GroupMe...":`📤 Resend Week ${week-1} GroupMe Update`}
        </button>}
      </>}
      {entryWeek>=14&&postSeasonInputs&&(()=>{
        const psi=postSeasonInputs;
        const ff2="'Helvetica Neue',Arial,sans-serif";
        const addGame=(field)=>setPSI(prev=>({...prev,[field]:[...(prev[field]||[]),{id:Date.now(),teamA:"",teamB:"",winner:""}]}));
        const removeGame=(field,id)=>setPSI(prev=>({...prev,[field]:(prev[field]||[]).filter(g=>g.id!==id)}));
        const setGame=(field,id,key,val)=>setPSI(prev=>({...prev,[field]:(prev[field]||[]).map(g=>g.id===id?{...g,[key]:val}:g)}));
        const setTopGame=(field,key,val)=>setPSI(prev=>({...prev,[field]:{...prev[field],[key]:val}}));
        const TeamSel=({value,onChange,exclude})=><select value={value} onChange={e=>onChange(e.target.value)} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12,maxWidth:140}}><option value="">-- Team --</option>{teamNames.filter(t=>t!==exclude).map(t=><option key={t} value={t}>{t}</option>)}</select>;
        const WinBtns=({teamA,teamB,winner,onWin})=><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{[teamA,teamB].filter(Boolean).map(t=><button key={t} onClick={()=>onWin(winner===t?"":t)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:winner===t?"#007a00":"#ddd",background:winner===t?"#f0f8f0":"#fff",color:winner===t?"#007a00":"#888",cursor:"pointer",fontSize:11,fontFamily:ff2,fontWeight:700}}>{winner===t?"✓ ":""}{t}</button>)}</div>;
        const GameRow=({game,field,onRemove})=><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}><TeamSel value={game.teamA} onChange={v=>setGame(field,game.id,"teamA",v)} exclude={game.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={game.teamB} onChange={v=>setGame(field,game.id,"teamB",v)} exclude={game.teamA}/>{(game.teamA||game.teamB)&&<><span style={{fontSize:11,color:"#555",marginLeft:4}}>Winner:</span><WinBtns teamA={game.teamA} teamB={game.teamB} winner={game.winner} onWin={v=>setGame(field,game.id,"winner",v)}/></>}{onRemove&&<button onClick={onRemove} style={{marginLeft:"auto",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>}</div>;
        const SL2=({children})=><div style={{fontSize:15,fontWeight:900,color:"#111",textTransform:"uppercase",letterSpacing:1,marginBottom:14,borderBottom:"2px solid #eee",paddingBottom:8}}>{children}</div>;
        const navBtn=(label,onClick,primary)=><button onClick={onClick} style={{padding:"12px 20px",background:primary?RED:"#f0f0f0",color:primary?"#fff":"#555",border:primary?"none":"1px solid #ddd",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",...(primary?{flex:1}:{})}}>{label}</button>;
        const NavBtns=({showNext=true})=><div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:4}}>
          {navBtn("← Back",()=>{saveToDb({});setEntryWeek(w=>w-1);},false)}
          {showNext&&navBtn("Save & Next →",()=>{saveToDb({});setEntryWeek(w=>w+1);},true)}
        </div>;

        if(entryWeek===14) return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL2>Conference Championship — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Appear +{pc.confChampApp} · Win +{pc.confChampWin}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}><TeamSel value={psi.confChampGame?.teamA||""} onChange={v=>setTopGame("confChampGame","teamA",v)} exclude={psi.confChampGame?.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={psi.confChampGame?.teamB||""} onChange={v=>setTopGame("confChampGame","teamB",v)} exclude={psi.confChampGame?.teamA}/></div>
            {(psi.confChampGame?.teamA||psi.confChampGame?.teamB)&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#555"}}>Winner:</span><WinBtns teamA={psi.confChampGame?.teamA} teamB={psi.confChampGame?.teamB} winner={psi.confChampGame?.winner||""} onWin={v=>setTopGame("confChampGame","winner",v)}/></div>}
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===15) return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL2>Bowl Games — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Appear +{pc.bowlApp} · Win +{pc.bowlWin}</div>
            {(psi.bowlGames||[]).map(g=><GameRow key={g.id} game={g} field="bowlGames" onRemove={()=>removeGame("bowlGames",g.id)}/>)}
            <button onClick={()=>addGame("bowlGames")} style={{marginTop:8,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add Bowl Game</button>
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===16) return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL2>Playoffs — Round 1 — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Appear +{pc.playoffApp} · Win +{pc.playoffWin}</div>
            {(psi.playoffR1||[]).map(g=><GameRow key={g.id} game={g} field="playoffR1" onRemove={()=>removeGame("playoffR1",g.id)}/>)}
            <button onClick={()=>addGame("playoffR1")} style={{marginTop:8,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add R1 Game</button>
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===17) return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL2>Playoffs — Round 2 — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Win +{pc.playoffSemiWin}</div>
            {(psi.playoffR2||[]).map(g=><GameRow key={g.id} game={g} field="playoffR2" onRemove={()=>removeGame("playoffR2",g.id)}/>)}
            <button onClick={()=>addGame("playoffR2")} style={{marginTop:8,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add R2 Game</button>
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===18) return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL2>Playoffs — Round 3 — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Win +{pc.playoffR3Win}</div>
            {(psi.playoffR3||[]).map(g=><GameRow key={g.id} game={g} field="playoffR3" onRemove={()=>removeGame("playoffR3",g.id)}/>)}
            <button onClick={()=>addGame("playoffR3")} style={{marginTop:8,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add R3 Game</button>
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===19) return(<>
          <Card style={{borderTop:`3px solid #b8860b`}}><div style={{padding:16}}>
            <SL2>National Championship — {year}</SL2>
            <div style={{fontSize:11,color:"#007a00",fontWeight:700,marginBottom:10}}>Win +{pc.nattyWin}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}><TeamSel value={psi.nattyGame?.teamA||""} onChange={v=>setTopGame("nattyGame","teamA",v)} exclude={psi.nattyGame?.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={psi.nattyGame?.teamB||""} onChange={v=>setTopGame("nattyGame","teamB",v)} exclude={psi.nattyGame?.teamA}/></div>
            {(psi.nattyGame?.teamA||psi.nattyGame?.teamB)&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#555"}}>Winner:</span><WinBtns teamA={psi.nattyGame?.teamA} teamB={psi.nattyGame?.teamB} winner={psi.nattyGame?.winner||""} onWin={v=>setTopGame("nattyGame","winner",v)}/></div>}
          </div></Card>
          <NavBtns/>
        </>);

        if(entryWeek===20) return(<>
          <Card style={{borderTop:`3px solid #333`}}><div style={{padding:16}}>
            <SL2>Offseason Awards — {year}</SL2>
            {/* Heisman */}
            <div style={{marginBottom:18}}><div style={{fontSize:13,color:"#333",marginBottom:8,fontWeight:700}}>Heisman Winner (+{pc.heisman})</div><select value={psi.heisman} onChange={e=>setPSI(prev=>({...prev,heisman:e.target.value}))} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"6px 10px",fontFamily:ff2,fontSize:13}}><option value="">-- None --</option>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select></div>
            {/* Recruiting */}
            <div style={{marginBottom:18}}><div style={{fontSize:13,color:"#333",marginBottom:8,fontWeight:700}}>Recruiting Rankings</div>{psi.recruiting.map((r,i)=><div key={r.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<5?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={r.teamName} onChange={e=>{const nv=e.target.value;const si2=psi.recruiting.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.recruiting];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,recruiting:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t}</option>)}</select>{i<5&&<span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{(pc.recruiting||RECRUITING_PTS)[i]||0}</span>}</div>)}</div>
            {/* Final Conference Standings */}
            <div style={{marginBottom:18}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:13,color:"#333",fontWeight:700}}>Final Conference Standings</div><button onClick={()=>{const sorted=[...entries].sort((a,b)=>{const aw=(a.confWins||0),al=(a.confLosses||0),bw=(b.confWins||0),bl=(b.confLosses||0);const apct=aw+al>0?aw/(aw+al):0,bpct=bw+bl>0?bw/(bw+bl):0;if(bpct!==apct)return bpct-apct;if(bw!==aw)return bw-aw;return(b.wins||0)-(a.wins||0);});setPSI(prev=>({...prev,confStandings:sorted.map((e,i)=>({teamName:e.teamName,rank:i+1}))}));}} style={{background:"#1a3a6b",color:"#fff",border:"none",borderRadius:2,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:ff2,fontWeight:700}}>↕ Sort by Conf Record</button></div>{psi.confStandings.map((s,i)=><div key={s.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<3?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={s.teamName} onChange={e=>{const nv=e.target.value;const si2=psi.confStandings.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.confStandings];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,confStandings:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select><span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{(pc.confStand||CONF_STAND_PTS)[i]||0}</span></div>)}</div>
            {/* Dynasty Top 5 */}
            <div style={{marginBottom:18}}><div style={{fontSize:13,color:"#333",marginBottom:8,fontWeight:700}}>Top 5 Teams in Dynasty</div>{(psi.dynastyTop5||[]).slice(0,5).map((r,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<5?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={r.teamName} onChange={e=>{const nv=e.target.value;const si2=(psi.dynastyTop5||[]).findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.dynastyTop5];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,dynastyTop5:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select><span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{(pc.dynastyTop5||[15,10,7,5,3])[i]||0}</span></div>)}</div>
            {/* Prestige */}
            <div style={{marginBottom:18}}><div style={{fontSize:13,color:"#333",marginBottom:6,fontWeight:700}}>Gained Prestige Star (+{pc.prestigeGain})</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{teamNames.map(t=><button key={t} onClick={()=>setPSI(prev=>({...prev,prestigeGains:prev.prestigeGains.includes(t)?prev.prestigeGains.filter(x=>x!==t):[...prev.prestigeGains,t]}))} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:psi.prestigeGains.includes(t)?"#007a00":"#ddd",background:psi.prestigeGains.includes(t)?"#f0f8f0":"#fff",color:psi.prestigeGains.includes(t)?"#007a00":"#888",cursor:"pointer",fontSize:12,fontFamily:ff2,fontWeight:600}}>{t}</button>)}</div></div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>setEntryWeek(w=>w-1)} style={{padding:"12px 20px",background:"#f0f0f0",border:"1px solid #ddd",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,color:"#555",textTransform:"uppercase"}}>← Back</button>
              <button onClick={applyPostSeason} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff2,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Apply All Post-Season Points</button>
              <button onClick={finalizeSeason} style={{background:"#fff",color:"#007a00",border:"2px solid #007a00",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff2,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Finalize & Start Season {season+1} →</button>
            </div>
          </div></Card>
        </>);
        return null;
      })()}

      </>}
    </div>
  );
}

// ── Reporters ─────────────────────────────────────────────────────────────
const REPORTERS = [
  {
    name: "Bill Connelly",
    title: "ESPN Staff Writer · Analytics",
    avatar: "BC",
    color: "#1a3a6b",
    style: "analytical, precise, and data-obsessed. You are one of the leading voices in college football analytics. You reference SP+ ratings, efficiency metrics, explosiveness rates, and predictive models constantly. You build arguments from the numbers up, acknowledge variance, and love finding the statistic that explains what the eye test missed. You coined 'the five factors' and you never let anyone forget it.",
    bio: "ESPN's analytics guru. Invented SP+. Probably has a spreadsheet open right now.",
  },
  {
    name: "Pete Thamel",
    title: "ESPN · National College Football Insider",
    avatar: "PT",
    color: "#cc0000",
    style: "plugged-in, urgent, and scoop-driven. You are ESPN's lead national insider — you break news on transfers, coaching changes, and recruiting before anyone else. You write with authority because your sources are impeccable. You use phrases like 'sources tell ESPN' and 'per multiple sources with knowledge of the situation.' You're never speculating — you know.",
    bio: "If it happened in college football, Pete knew first. Has more sources than anyone alive.",
  },
  {
    name: "Bruce Feldman",
    title: "The Athletic · National Insider",
    avatar: "BF",
    color: "#1a6b3a",
    style: "deeply sourced, inside-football, and obsessed with hidden talent and physical freaks. You are known for the Freaks List and your relationships with coaches and strength staff across the country. You write with insider credibility — coaching search updates, locker room culture, off-the-record quotes that somehow end up in print. You find the story nobody else is chasing.",
    bio: "Author of the Freaks List. Every S&C coach in America has his number saved.",
  },
  {
    name: "Max Olson",
    title: "ESPN · Roster & Transfer Portal Analyst",
    avatar: "MO",
    color: "#5a3a8b",
    style: "thoughtful, roster-obsessed, and transfer-portal savvy. You are ESPN's premier analyst for roster construction, depth chart trends, and portal movement. You think about teams in terms of talent accumulation, positional needs, and roster building strategy. You write with the lens of a GM evaluating a 85-man roster. You love a good portal haul story and never sleep during the December signing period.",
    bio: "Knows every portal entry before the player tweets it. Thinks in depth charts.",
  },
  {
    name: "Tony Vig",
    title: "FanDuel Sportsbook · Betting Insider",
    avatar: "TV",
    color: "#0f7a3d",
    style: "sharp, numbers-obsessed, and allergic to hedging. You set betting lines like a Vegas oddsmaker: a point spread, an over/under total, and a prop bet for every game, each backed by a number and a reason pulled from the data you're given. You call your locks 'locks' without apology, talk in units and confidence stars, and reference 'the field,' 'sharp money,' and line movement even though this is a friends-only dynasty league. You'd rather be loud and wrong than quiet and right, and you never write a pick without a number attached.",
    bio: "Sets the lines your league mates lose money on. Never met a pick he wouldn't lay -3 units on.",
  },
];

// ── Content Hub Tab ───────────────────────────────────────────────────────

async function compressImage(file, maxW=900, quality=0.78) {
  return new Promise(res=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const ratio=Math.min(1,maxW/img.width);
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*ratio);
        canvas.height=Math.round(img.height*ratio);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        res(canvas.toDataURL('image/jpeg',quality));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function FeaturedCarousel({articles, setActiveArticle, RED, ff}) {
  const [idx, setIdx] = useState(0);
  const featured = (articles||[]).filter(a=>a.showOnHome&&a.imageUrl).slice(0,5);
  useEffect(()=>{
    if(featured.length<=1) return;
    const t=setInterval(()=>setIdx(i=>(i+1)%featured.length),5000);
    return()=>clearInterval(t);
  },[featured.length]);
  if(!featured.length) return null;
  const a=featured[idx];
  return (
    <div style={{position:"relative",width:"100%",borderRadius:2,overflow:"hidden",marginBottom:0,cursor:"pointer",background:"#111"}} onClick={()=>setActiveArticle(a)}>
      <img src={a.imageUrl} alt="" style={{width:"100%",maxHeight:340,objectFit:"cover",display:"block"}} onError={e=>{e.target.style.display="none";}}/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,0.88))",padding:"40px 18px 14px"}}>
        <div style={{fontSize:10,color:a.reporterColor||RED,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,marginBottom:5,fontFamily:ff}}>{a.reporter||"Dynasty Central"} · {a.label}</div>
        <div style={{fontSize:20,fontWeight:900,color:"#fff",lineHeight:1.2,fontFamily:ff}}>{articleHeadline(a.text)}</div>
      </div>
      {featured.length>1&&<>
        <button onClick={e=>{e.stopPropagation();setIdx(i=>(i-1+featured.length)%featured.length);}} style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:18,lineHeight:"34px",textAlign:"center"}}>‹</button>
        <button onClick={e=>{e.stopPropagation();setIdx(i=>(i+1)%featured.length);}} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,0.45)",color:"#fff",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:18,lineHeight:"34px",textAlign:"center"}}>›</button>
        <div style={{position:"absolute",bottom:10,right:14,display:"flex",gap:5}}>
          {featured.map((_,i)=><div key={i} onClick={e=>{e.stopPropagation();setIdx(i);}} style={{width:7,height:7,borderRadius:"50%",background:i===idx?"#fff":"rgba(255,255,255,0.35)",cursor:"pointer",transition:"background 0.2s"}}/>)}
        </div>
      </>}
    </div>
  );
}

function ContentHub({sorted,entries,week,season,year,leagueName,history,leader,articles,setArticles,setActiveArticle,schedule,setup,setSetup,saveToDb}) {
  const [generating,setGenerating] = useState(null);
  const [genError,setGenError] = useState(null);
  const [selectedReporter,setSelectedReporter] = useState(0);
  const [contentType,setContentType] = useState("powerrankings");
  const [breakingSubject,setBreakingSubject] = useState("");
  const [breakingGuidance,setBreakingGuidance] = useState("");
  const [articleGuidance,setArticleGuidance] = useState("");
  const [articleLength,setArticleLength] = useState("medium");
  const [customLabel,setCustomLabel] = useState("");
  const [draftArticle,setDraftArticle] = useState(null);
  const [draftText,setDraftText] = useState("");
  const [revisionNote,setRevisionNote] = useState("");
  const [revising,setRevising] = useState(false);
  const [articleImage,setArticleImage] = useState(null);
  const [showOnHome,setShowOnHome] = useState(false);
  const articleImgRef = useRef();
  const [selArticleId,setSelArticleId] = useState(null);
  const manageImgRef = useRef();
  const [bibleProfiles,setBibleProfiles] = useState(()=>(setup?.leagueBible?.profiles||[]).length>0?setup.leagueBible.profiles:entries.map(e=>({name:e.userName||e.teamName,bio:""})));
  const [bibleStorylines,setBibleStorylines] = useState(setup?.leagueBible?.storylines||"");
  const [bibleSaved,setBibleSaved] = useState(false);
  const [extracting,setExtracting] = useState(false);
  useEffect(()=>{if(setup?.leagueBible?.profiles?.length)setBibleProfiles(setup.leagueBible.profiles);if(setup?.leagueBible?.storylines!==undefined)setBibleStorylines(setup.leagueBible.storylines);},[setup?.leagueBible]);

  async function publishArticle(finalArticle) {
    if(!window.confirm("Publish this article?\n\nThis will also run a brief Claude API call to extract storyline highlights for the League Bible.")) return;
    const newArticles=[finalArticle,...articles].slice(0,30);
    setArticles(newArticles);
    dbSave({articles:newArticles});
    setDraftArticle(null);
    setDraftText("");
    // Extract storyline developments from the article
    setExtracting(true);
    try {
      const chronicle = setup?.leagueBible?.chronicle||[];
      const extractPrompt = `You are a dynasty league historian. Read this article and extract 1-2 sentences of meaningful story developments — rivalries that escalated, upsets that matter, momentum shifts, character moments, or ongoing narrative threads. Be specific (name names, mention stakes). If nothing noteworthy happened, write "Quiet week — no major developments."\n\nArticle:\n${finalArticle.text}\n\nRespond with ONLY the 1-2 sentence summary. No preamble.`;
      const summary = (await callClaude(extractPrompt)).trim();
      const entry = {id:Date.now(),week:finalArticle.week,season:finalArticle.season,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),summary};
      const newChronicle = [entry,...chronicle].slice(0,40);
      const updatedSetup = {...setup,leagueBible:{...(setup?.leagueBible||{}),chronicle:newChronicle}};
      setSetup(updatedSetup);
      saveToDb({setup:updatedSetup,articles:newArticles});
    } catch(e) {
      // Chronicle extraction failing silently is fine
    } finally {
      setExtracting(false);
    }
  }

  async function requestRevision() {
    if(!revisionNote.trim())return;
    if(!window.confirm("Send revision request to Claude API?\n\nThis will use the Claude API.")) return;
    setRevising(true);
    const r = reporter;
    try {
      const revisionPrompt = `You are ${r.name}, ${r.title}. You wrote the following article and the editor has requested changes.\n\nORIGINAL ARTICLE:\n${draftText}\n\nEDITOR NOTES — make ONLY these corrections, keep everything else the same:\n${revisionNote}\n\nReturn the full revised article only. No preamble.`;
      const revised = cleanArticle(await callClaude(revisionPrompt));
      setDraftText(revised);
      setRevisionNote("");
    } catch(e) {
      setGenError(e.message);
    } finally {
      setRevising(false);
    }
  }

  function saveBible(){
    const bible={...(setup?.leagueBible||{}),profiles:bibleProfiles,storylines:bibleStorylines};
    const updatedSetup={...setup,leagueBible:bible};
    setSetup(updatedSetup);
    saveToDb({setup:updatedSetup});
    setBibleSaved(true);
    setTimeout(()=>setBibleSaved(false),2000);
  }

  function deleteChronicleEntry(id){
    const chronicle=(setup?.leagueBible?.chronicle||[]).filter(e=>e.id!==id);
    const updatedSetup={...setup,leagueBible:{...(setup?.leagueBible||{}),chronicle}};
    setSetup(updatedSetup);
    saveToDb({setup:updatedSetup});
  }

  const bibleContext = (()=>{
    const profiles=(setup?.leagueBible?.profiles||[]).filter(p=>p.bio?.trim());
    const storylines=(setup?.leagueBible?.storylines||"").trim();
    const chronicle=(setup?.leagueBible?.chronicle||[]).slice(0,20);
    if(!profiles.length&&!storylines&&!chronicle.length)return "";
    let ctx="";
    if(profiles.length){ctx+=`\n\nLEAGUE PERSONALITIES — use these character details to add color, storylines, and personality to your writing. Reference them naturally and with humor where appropriate:\n${profiles.map(p=>`${p.name}: ${p.bio}`).join("\n")}`;}
    if(storylines){ctx+=`\n\nLEAGUE STORYLINES — weave these season narratives into your writing naturally:\n${storylines}`;}
    if(chronicle.length){ctx+=`\n\nLEAGUE CHRONICLE — recent story developments (most recent first). Build on these threads:\n${chronicle.map(e=>`S${e.season} Wk${e.week} (${e.date}): ${e.summary}`).join("\n")}`;}
    return ctx;
  })();

  const coachTeamMap = sorted.map(t=>t.userName&&t.userName!==t.teamName?`${t.userName} (head coach of ${t.teamName})`:`${t.teamName}`).join(", ");
  const standingsText = sorted.map((t,i)=>{const tot=calcTotal(t);const coach=t.userName&&t.userName!==t.teamName?`${t.userName}/${t.teamName}`:`${t.teamName}`;return `${i+1}. ${coach} — ${t.wins}W ${t.losses}L — ${tot} pts${i===0?" [LEADER]":` (-${leader-tot})`}`;}).join("\n");

  // Build schedule context for AI
  const teamToCoach = Object.fromEntries(sorted.filter(t=>t.userName&&t.userName!==t.teamName).map(t=>[t.teamName,t.userName]));
  const fmt = (team,opp) => {
    const c1=teamToCoach[team]; const c2=teamToCoach[opp];
    const t1=c1?`${c1} (${team})`:team; const t2=c2?`${c2} (${opp})`:opp;
    if(opp==="BYE")return `${t1}: BYE`;
    if(isCPUOpp(opp))return `${t1} vs ${formatOpp(opp)} (non-conf)`;
    return `${t1} vs ${t2}`;
  };
  const thisWeekMatchups = schedule[week] ? (() => {
    const seen = new Set(); const games = [];
    Object.entries(schedule[week]).forEach(([team,opp])=>{
      const key = [team,opp].sort().join("vs");
      if(!seen.has(key)){seen.add(key);games.push(fmt(team,opp));}
    });
    return games.join("\n");
  })() : "Schedule not yet set";

  const lastWeekMatchups = schedule[week-1] ? (() => {
    const seen = new Set(); const games = [];
    Object.entries(schedule[week-1]).forEach(([team,opp])=>{
      const key = [team,opp].sort().join("vs");
      if(!seen.has(key)){seen.add(key);games.push(fmt(team,opp));}
    });
    return games.join("\n");
  })() : "Schedule not available";

  const upcomingSchedule = [week,week+1,week+2].map(w=>{
    if(!schedule[w])return null;
    const seen=new Set();const games=[];
    Object.entries(schedule[w]).forEach(([team,opp])=>{const key=[team,opp].sort().join("vs");if(!seen.has(key)){seen.add(key);games.push(opp==="BYE"?`${team}:BYE`:isCPUOpp(opp)?`${team} vs ${formatOpp(opp)}`:`${team} vs ${opp}`);}});
    return `Week ${w}: ${games.join(", ")}`;
  }).filter(Boolean).join("\n");

  // Season data for the sportsbook writer's lines — built from whatever's accumulated so far.
  const scoringTrendsText = (()=>{
    const archive = (setup?.gameArchive||[]).filter(g=>g.year===Number(year));
    if(!archive.length) return "";
    const byTeam = {};
    archive.forEach(g=>{
      [[g.team1,g.team2],[g.team2,g.team1]].forEach(([t,opp])=>{
        if(!t?.name) return;
        if(!byTeam[t.name]) byTeam[t.name]={for:0,against:0,g:0};
        byTeam[t.name].for+=t.score||0;
        byTeam[t.name].against+=opp?.score||0;
        byTeam[t.name].g++;
      });
    });
    const lines = Object.entries(byTeam).map(([name,s])=>`${name}: ${(s.for/s.g).toFixed(1)} PPG scored, ${(s.against/s.g).toFixed(1)} PPG allowed (${s.g} game${s.g!==1?"s":""} of box scores)`);
    return lines.length ? `\n\nSEASON SCORING TRENDS (from uploaded box scores so far):\n${lines.join("\n")}` : "";
  })();
  const recentFormText = sorted.map(t=>{
    const log=(t.weekLog||[]).slice(-3);
    if(!log.length) return null;
    return `${t.teamName}: ${log.map(l=>l.result==="win"?"W":l.result==="loss"?"L":"-").join("")} last ${log.length}`;
  }).filter(Boolean).join("\n");

  const reporter = REPORTERS[selectedReporter];

  async function generate(type) {
    if(type==="breaking"&&!breakingSubject){setGenError("Select a coach for the breaking news.");return;}
    if(type==="breaking"&&!breakingGuidance.trim()){setGenError("Add some guidance — what's the breaking news about?");return;}
    const typeLabels = {powerrankings:"Power Rankings",preview:"Week Preview",recap:"Weekly Recap",seasonpreview:"Season Preview",hotakes:"Hot Takes",breaking:"Breaking News",bettinglines:"Betting Lines"};
    if(!window.confirm(`Generate ${typeLabels[type]||"article"}?\n\nThis will use the Claude API.`)) return;
    setGenerating(type);
    setGenError(null);
    const r = reporter;
    const leagueAge = history.length > 0 ? `This is year ${year} of the league (its ${year===2024?"1st":year===2025?"2nd":year===2026?"3rd":year===2027?"4th":year===2028?"5th":(year-2023)+"th"} year of existence, founded in 2024). ` : "";
    const pastChamps = history.length > 0 ? `Past dynasty champions: ${[...history].reverse().slice(0,5).map(s=>`${s.year} S${s.seasonNum||"?"}: ${s.champion}`).join(", ")}. ` : "";
    const rosterContext = sorted.some(t=>t.userName&&t.userName!==t.teamName) ? `\n\nCOACH ROSTER — these coaches and their programs are the same entity, never separate. Vary how you refer to them throughout the piece — mix and match naturally: "Big Johnson's Texas State," "Texas State under Big Johnson," "Big Johnson and the Bobcats," "the Big Johnson era at Texas State," just "Big Johnson," just "Texas State," etc. Never introduce them the same way twice. Never list coaches and teams as if they're different people/things:\n${sorted.filter(t=>t.userName&&t.userName!==t.teamName).map(t=>`${t.userName} → ${t.teamName}`).join("\n")}` : "";
    const byline = `You are ${r.name}, ${r.title} for Dynasty Central covering the "${leagueName}" dynasty. Your writing style is ${r.style}\n\n${leagueAge}${pastChamps}This is NOT the inaugural season — the league has history and established rivalries.${rosterContext}${bibleContext}\n\nAlways sign your articles with your name and title at the end.\n\n`;

    const subjectProfile = (setup?.leagueBible?.profiles||[]).find(p=>p.name===breakingSubject);
    const subjectEntry = entries.find(e=>e.userName===breakingSubject||e.teamName===breakingSubject);
    const subjectContext = subjectProfile?.bio ? `\n\nABOUT ${breakingSubject.toUpperCase()}: ${subjectProfile.bio}` : "";
    const subjectRecord = subjectEntry ? ` (currently ${subjectEntry.wins}W-${subjectEntry.losses}L, ${calcTotal(subjectEntry)} pts)` : "";

    const scheduleContext = upcomingSchedule ? `\n\nUPCOMING SCHEDULE:\n${upcomingSchedule}` : "";
    const lengthMap = {short:"150-200 words",medium:"350-450 words",long:"650-800 words"};
    const wordTarget = lengthMap[articleLength]||"350-450 words";
    const prompts = {
      powerrankings: `${byline}Write weekly power rankings after Season ${season} Week ${week-1}.\n\nCurrent points standings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}${scheduleContext}${articleGuidance.trim()?`\n\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. Rank all ${entries.length} teams 1-${entries.length} with punchy blurbs. Reference actual matchups and upcoming schedules. Rankings can differ from points based on momentum and schedule difficulty. Be opinionated. Format as:\n1. [Team] — [blurb]\n2. etc.`,

      preview: `${byline}Write a Week ${week} game preview article for the "${leagueName}" dynasty, Season ${season}.\n\nCurrent standings:\n${standingsText}\n\nTHIS WEEK'S ACTUAL MATCHUPS:\n${thisWeekMatchups}${articleGuidance.trim()?`\n\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. Preview the actual scheduled matchups. Discuss storylines, what's at stake for each team, who has the edge. Reference the real games — do not make up different matchups. Write in your distinct voice.`,

      recap: `${byline}Write a dramatic weekly recap for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings after this week:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}${articleGuidance.trim()?`\n\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. Recap last week's actual games. Make up exciting scores and game details for the real matchups listed above. Highlight upsets, dominant performances, and dynasty implications. Write in your distinct voice.`,

      seasonpreview: `${byline}Write a Season ${season} (${year}) preview for the "${leagueName}" dynasty.\n\nTeams:\n${entries.map(e=>e.teamName).join("\n")}\n${history.length>0?`\nDefending champion: ${history[history.length-1].champion}`:"This is the inaugural season."}\n${upcomingSchedule?`\nEarly schedule:\n${upcomingSchedule}`:""}\n${articleGuidance.trim()?`\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. Give each team a one-line outlook, predict a champion, name dark horses and sleepers, and build excitement. Write in your distinct voice.`,

      hotakes: `${byline}Write a spicy hot takes column for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}${articleGuidance.trim()?`\n\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. Write bold, controversial hot takes. Reference real matchups and team names. Each take 2-3 sentences, provocative and specific. Number them. Write in your distinct voice.`,

      breaking: `${byline}Write a BREAKING NEWS article for the "${leagueName}" dynasty, Season ${season} Week ${week}.${subjectContext}\n\nSUBJECT: ${breakingSubject}${subjectRecord}\nBREAKING NEWS ANGLE: ${breakingGuidance}\n\nCurrent standings context:\n${standingsText}\n\nTarget length: ${wordTarget}. Write in a breathless breaking-news style — urgent, dramatic, with a punchy headline in ALL CAPS. Let the subject's personality and known traits color the narrative heavily. Be wild, irreverent, and entertaining. Reference their standing in the league and what this news means for the dynasty season. Make it feel like a legitimate sports scandal or bombshell dropped mid-season. Write in your distinct voice.`,

      bettinglines: `${byline}Write a Week ${week} betting lines and best bets column for the "${leagueName}" dynasty, Season ${season}.\n\nCurrent standings:\n${standingsText}\n\nTHIS WEEK'S ACTUAL MATCHUPS:\n${thisWeekMatchups}${scoringTrendsText}${recentFormText?`\n\nRECENT FORM (last 3 results, most recent last):\n${recentFormText}`:""}${articleGuidance.trim()?`\n\nEDITOR'S DIRECTION: ${articleGuidance.trim()}`:""}\n\nTarget length: ${wordTarget}. For every real matchup listed above (skip BYEs), set a line: a point spread, an over/under total, and one team prop bet — justify each with the season data given, leaning on scoring trends and recent form where available and on record/dynasty points where it isn't. Close with your "Best Bets of the Week" — 2-3 locks, each with a confidence level (star rating or units). Write with total conviction, like a sportsbook, not a fan. Reference the real matchups only, never invent different ones. Write in your distinct voice.`,
    };

    try {
      const text = cleanArticle(await callClaude(prompts[type]));
      const labels = {powerrankings:"📊 Power Rankings",preview:"🔭 Week Preview",recap:"📰 Weekly Recap",seasonpreview:"🏈 Season Preview",hotakes:"🔥 Hot Takes",breaking:"🚨 Breaking News",bettinglines:"💰 Betting Lines"};
      const label = labels[type]||"📰 Article";
      const draft = {id:Date.now(),type,label,week,season,text,reporter:r.name,reporterColor:r.color,reporterAvatar:r.avatar};
      setDraftArticle(draft);
      setDraftText(text);
    } catch(e) {
      setGenError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  // Weekly recap from box scores
  const [recapGenerating,setRecapGenerating] = useState(false);
  const [recapError,setRecapError] = useState(null);
  async function generateBoxScoreRecap() {
    const weekGames=(setup?.gameArchive||[]).filter(g=>g.year===Number(year)&&g.week===Number(week));
    if(!weekGames.length){setRecapError("No box scores uploaded for this week yet. Upload them in Enter Results first.");return;}
    const reporter=REPORTERS[selectedReporter];
    if(!window.confirm(`Generate Week ${week} Recap from ${weekGames.length} box score(s)?\nThis will use the Claude API.`)) return;
    setRecapGenerating(true); setRecapError(null);
    try {
      const awards=pickWeeklyAwards(weekGames);
      const prompt=buildRecapPrompt(weekGames,awards,leagueName,week,season,year,reporter);
      const text=cleanArticle(await callClaude(prompt));
      const article={id:Date.now(),type:"recap",label:"📰 Weekly Recap",week:Number(week),season:Number(season),text,reporter:reporter.name,reporterColor:reporter.color,reporterAvatar:reporter.avatar};
      const newArticles=[article,...articles].slice(0,30);
      setArticles(newArticles); saveToDb({articles:newArticles}); setActiveArticle(article);
    } catch(e){setRecapError(e.message);}
    finally{setRecapGenerating(false);}
  }
  const weekGamesForRecap=(setup?.gameArchive||[]).filter(g=>g.year===Number(year)&&g.week===Number(week));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Box score recap shortcut */}
      {weekGamesForRecap.length>0&&(()=>{
        const awards=pickWeeklyAwards(weekGamesForRecap);
        const w=g=>g.team1.score>g.team2.score?g.team1:g.team2;
        const l=g=>g.team1.score>g.team2.score?g.team2:g.team1;
        return(
          <Card style={{overflow:"hidden",borderLeft:`4px solid #1a3a6b`}}>
            <CardHead bg="#1a3a6b">Week {week} Box Scores Ready — {weekGamesForRecap.length} game{weekGamesForRecap.length!==1?"s":""}</CardHead>
            <div style={{padding:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
              {[
                ["🏆 GOTW",awards.gotw?`${w(awards.gotw.game).name} def. ${l(awards.gotw.game).name} (${awards.gotw.margin})`:"-"],
                ["💥 Blowout",awards.blowout?`${w(awards.blowout.game).name} +${awards.blowout.margin}`:"-"],
                ["🔥 Top Off.",awards.offMvp?`${awards.offMvp.team.name} ${awards.offMvp.yds}yds`:"-"],
                ["🛡️ Top Def.",awards.defMvp?`${awards.defMvp.team.name} ${awards.defMvp.ydsAllowed}yds`:"-"],
              ].map(([label,val])=>(
                <div key={label} style={{background:"#f0f4ff",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#666",textTransform:"uppercase",letterSpacing:1,marginBottom:2}}>{label}</div>
                  <div style={{fontSize:11,fontWeight:700,color:"#111"}}>{val}</div>
                </div>
              ))}
            </div>
            {recapError&&<div style={{margin:"0 12px 8px",background:"#fff0f0",border:"1px solid #ffcccc",borderRadius:2,padding:"8px 12px",fontSize:12,color:RED}}>{recapError}</div>}
            <div style={{padding:"0 12px 12px"}}>
              <button onClick={generateBoxScoreRecap} disabled={recapGenerating} style={{width:"100%",background:recapGenerating?"#ccc":"#1a3a6b",color:"#fff",border:"none",borderRadius:2,padding:"10px",cursor:recapGenerating?"not-allowed":"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>
                {recapGenerating?"Generating...":"📰 Generate Week "+week+" Recap from Box Scores"}
              </button>
            </div>
          </Card>
        );
      })()}

      {/* Reporter selector */}
      <Card style={{overflow:"hidden"}}>
        <CardHead bg="#111">Select Reporter</CardHead>
        <div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
          {REPORTERS.map((r,i)=>(
            <div key={r.name} onClick={()=>setSelectedReporter(i)} style={{border:`2px solid ${selectedReporter===i?r.color:"#ddd"}`,borderRadius:4,padding:12,cursor:"pointer",background:selectedReporter===i?`${r.color}08`:"#fff",transition:"all 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:r.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff",flexShrink:0}}>{r.avatar}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"#111"}}>{r.name}</div>
                  <div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:0.5}}>{r.title}</div>
                </div>
              </div>
              <div style={{fontSize:11,color:"#666",lineHeight:1.4,fontStyle:"italic"}}>"{r.bio}"</div>
            </div>
          ))}
        </div>
        {/* Selected reporter style preview */}
        <div style={{borderTop:"1px solid #eee",padding:"10px 14px",background:"#f9f9f9",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,borderRadius:"50%",background:reporter.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{reporter.avatar}</div>
          <div style={{fontSize:11,color:"#555"}}><strong style={{color:"#111"}}>{reporter.name}</strong> is writing — {reporter.style.split(".")[0]}.</div>
        </div>
      </Card>

      {/* Article type selector */}
      <Card style={{padding:16}}>
        <SL>Generate Article</SL>
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {[["powerrankings","📊 Power Rankings"],["preview","🔭 Week Preview"],["recap","📰 Weekly Recap"],["seasonpreview","🏈 Season Preview"],["hotakes","🔥 Hot Takes"],["breaking","🚨 Breaking News"],["bettinglines","💰 Betting Lines"]].map(([val,label])=>(
            <button key={val} onClick={()=>setContentType(val)} style={{padding:"8px 14px",borderRadius:2,border:"1px solid",borderColor:contentType===val?(val==="breaking"?RED:reporter.color):"#ddd",background:contentType===val?(val==="breaking"?RED:reporter.color):"#fff",color:contentType===val?"#fff":"#555",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:700,textTransform:"uppercase"}}>{label}</button>
          ))}
        </div>

        {contentType==="breaking"&&(
          <div style={{background:"#fff8f8",border:`1px solid ${RED}33`,borderRadius:2,padding:14,marginBottom:14,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:RED}}>Breaking News Setup</div>
            <div>
              <div style={{fontSize:11,color:"#555",marginBottom:5,fontWeight:600}}>Who is this about?</div>
              <select value={breakingSubject} onChange={e=>setBreakingSubject(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:13,fontFamily:ff,color:breakingSubject?"#111":"#999",background:"#fff"}}>
                <option value="">— Select a coach —</option>
                {entries.map(e=><option key={e.userId||e.userName} value={e.userName||e.teamName}>{e.userName||e.teamName} ({e.teamName})</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:11,color:"#555",marginBottom:5,fontWeight:600}}>What's the story? <span style={{color:"#999",fontWeight:400}}>(give the AI direction — wild, specific, or both)</span></div>
              <textarea value={breakingGuidance} onChange={e=>setBreakingGuidance(e.target.value)} placeholder={`e.g. "Got caught trying to poach a recruit at a Waffle House" or "Called out the entire league in a post-game rant" or "Mysteriously benched his entire starting lineup in Week 3"`} style={{width:"100%",minHeight:72,padding:"8px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,lineHeight:1.5,resize:"vertical",boxSizing:"border-box",color:"#222"}}/>
            </div>
          </div>
        )}

        {contentType!=="breaking"&&(
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:"#555",marginBottom:5,fontWeight:600}}>Direction <span style={{color:"#999",fontWeight:400}}>(optional — give the writer a specific angle, storyline, or focus)</span></div>
            <textarea value={articleGuidance} onChange={e=>setArticleGuidance(e.target.value)} placeholder={contentType==="powerrankings"?"e.g. \"Focus on the surprising rise of Jelly Roll\" or \"Hammer whoever is in last place\"":contentType==="recap"?"e.g. \"Big Johnson's blowout loss was the story of the week\"":contentType==="preview"?"e.g. \"Hype up the rivalry game between Dirt McSquirt and Jeff Fisher\"":contentType==="hotakes"?"e.g. \"Go hard on the team that keeps scheduling cupcakes\"":contentType==="bettinglines"?"e.g. \"Make the rivalry game your Best Bet of the Week\" or \"Fade Jelly Roll after that blowout loss\"":"e.g. \"Pick Jelly Roll as a dark horse\"" } style={{width:"100%",minHeight:60,padding:"8px 10px",border:`1px solid ${reporter.color}44`,borderRadius:2,fontSize:12,fontFamily:ff,lineHeight:1.5,resize:"vertical",boxSizing:"border-box",color:"#222"}}/>
          </div>
        )}

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <span style={{fontSize:11,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:0.5}}>Length:</span>
          {[["short","Short","~175 words"],["medium","Medium","~400 words"],["long","Long","~700 words"]].map(([val,label,hint])=>(
            <button key={val} onClick={()=>setArticleLength(val)} title={hint} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:articleLength===val?(contentType==="breaking"?RED:reporter.color):"#ddd",background:articleLength===val?(contentType==="breaking"?RED:reporter.color):"#fff",color:articleLength===val?"#fff":"#666",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700,textTransform:"uppercase"}}>{label}</button>
          ))}
          <span style={{fontSize:10,color:"#aaa"}}>{articleLength==="short"?"~175 words":articleLength==="long"?"~700 words":"~400 words"}</span>
        </div>
        {genError&&<div style={{background:"#fff0f0",border:"1px solid #ffcccc",borderRadius:2,padding:"10px 14px",fontSize:12,color:RED,marginBottom:4}}><strong>Error:</strong> {genError}</div>}
        <button onClick={()=>generate(contentType)} disabled={!!generating} style={{background:generating?"#ccc":contentType==="breaking"?RED:reporter.color,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:generating?"not-allowed":"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",display:"flex",alignItems:"center",gap:8}}>
          {generating?<>Generating...</>:contentType==="breaking"?<>🚨 Break the Story</>:<><span style={{background:"rgba(255,255,255,0.2)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{reporter.avatar}</span> Generate as {reporter.name.split(" ")[0]}</>}
        </button>
      </Card>

      {/* Write your own article */}
      <Card style={{padding:16}}>
        <SL>Write Your Own Article</SL>
        <div style={{fontSize:12,color:"#666",lineHeight:1.5,marginBottom:12}}>Skip the AI entirely and write something yourself — opens the same editor below with an empty page, image upload, and homepage toggle.</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:"#555",marginBottom:5,fontWeight:600}}>Label <span style={{color:"#999",fontWeight:400}}>(optional — shown as the article's badge)</span></div>
          <input value={customLabel} onChange={e=>setCustomLabel(e.target.value)} placeholder="📝 Commissioner's Note" style={{width:"100%",padding:"8px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:13,fontFamily:ff,color:"#222",boxSizing:"border-box"}}/>
        </div>
        <button onClick={()=>{setDraftArticle({id:Date.now(),type:"custom",label:customLabel.trim()||"📝 Commissioner's Note",week,season,text:"",reporter:"Dynasty Central",reporterColor:"#111",reporterAvatar:"DC"});setDraftText("");}} style={{background:"#111",color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>✏️ Start Writing</button>
      </Card>

      {/* League Bible */}
      <Card style={{overflow:"hidden"}}>
        <CardHead bg="#1a3a6b">League Bible</CardHead>
        <div style={{padding:14,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontSize:12,color:"#666",lineHeight:1.5}}>Character profiles and storylines are injected into every AI writer's system prompt automatically. The more detail you add, the better the articles.</div>

          <div>
            <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:"#333",marginBottom:8}}>Character Profiles</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {bibleProfiles.map((p,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"160px 1fr auto",gap:8,alignItems:"start"}}>
                  <input value={p.name} onChange={e=>{const next=[...bibleProfiles];next[i]={...next[i],name:e.target.value};setBibleProfiles(next);}} placeholder="Name" style={{padding:"7px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,color:"#111"}}/>
                  <input value={p.bio} onChange={e=>{const next=[...bibleProfiles];next[i]={...next[i],bio:e.target.value};setBibleProfiles(next);}} placeholder="Personality, backstory, traits, quirks…" style={{padding:"7px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,color:"#111"}}/>
                  <button onClick={()=>setBibleProfiles(bibleProfiles.filter((_,j)=>j!==i))} style={{background:"transparent",border:"1px solid #ddd",borderRadius:2,padding:"7px 10px",cursor:"pointer",fontSize:13,color:"#aaa",fontFamily:ff}}>×</button>
                </div>
              ))}
              <button onClick={()=>setBibleProfiles([...bibleProfiles,{name:"",bio:""}])} style={{alignSelf:"flex-start",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:2,padding:"7px 14px",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:700,color:"#555",textTransform:"uppercase"}}>+ Add Character</button>
            </div>
          </div>

          <div>
            <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:"#333",marginBottom:6}}>League Storylines</div>
            <div style={{fontSize:11,color:"#888",marginBottom:6}}>Season-wide narratives — rivalries, vendettas, redemption arcs, ongoing drama.</div>
            <textarea value={bibleStorylines} onChange={e=>setBibleStorylines(e.target.value)} placeholder="e.g. Jeff Fisher and Dirt McSquirt have an ongoing rivalry after the controversial Week 4 game last season. Jelly Roll is on a redemption arc after his dynasty collapse in 2025…" style={{width:"100%",minHeight:100,padding:"9px 11px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,lineHeight:1.6,resize:"vertical",boxSizing:"border-box",color:"#222"}}/>
          </div>

          <button onClick={saveBible} style={{alignSelf:"flex-start",background:bibleSaved?"#007a00":"#1a3a6b",color:"#fff",border:"none",borderRadius:2,padding:"10px 20px",cursor:"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase",transition:"background 0.2s"}}>{bibleSaved?"✓ Saved":"Save League Bible"}</button>

          {/* Chronicle */}
          <div style={{borderTop:"1px solid #e8e8e8",paddingTop:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
              <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:"#333"}}>Story Chronicle</div>
              {extracting&&<span style={{fontSize:10,color:"#888",fontStyle:"italic"}}>Extracting developments…</span>}
            </div>
            <div style={{fontSize:11,color:"#888",marginBottom:10}}>Auto-updated every time you publish an article. Writers read this to build on past storylines.</div>
            {(setup?.leagueBible?.chronicle||[]).length===0&&<div style={{fontSize:12,color:"#aaa",fontStyle:"italic",padding:"10px 0"}}>No chronicle entries yet. Publish an article to start building the history.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(setup?.leagueBible?.chronicle||[]).map(e=>(
                <div key={e.id} style={{display:"flex",gap:10,alignItems:"flex-start",background:"#f7f9ff",border:"1px solid #dde4f0",borderRadius:2,padding:"8px 10px"}}>
                  <div style={{flexShrink:0,fontSize:10,color:"#6677aa",fontWeight:700,whiteSpace:"nowrap",paddingTop:1}}>S{e.season} W{e.week}<br/><span style={{fontWeight:400,color:"#aaa"}}>{e.date}</span></div>
                  <div style={{flex:1,fontSize:12,color:"#333",lineHeight:1.5}}>{e.summary}</div>
                  <button onClick={()=>deleteChronicleEntry(e.id)} style={{background:"transparent",border:"none",color:"#ccc",cursor:"pointer",fontSize:14,padding:"0 2px",flexShrink:0}} title="Remove entry">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Draft preview */}
      {draftArticle&&(
        <Card style={{overflow:"hidden",border:`2px solid ${reporter.color}`}}>
          <div style={{background:draftArticle.reporterColor||"#111",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff"}}>{draftArticle.reporterAvatar}</div>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:"#fff"}}>{draftArticle.reporter}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.7)"}}>{draftArticle.label} · S{draftArticle.season} Wk{draftArticle.week} · DRAFT PREVIEW</div>
              </div>
            </div>
          </div>
          <div style={{padding:14}}>
            <div style={{fontSize:11,color:"#888",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Review &amp; Edit Before Publishing</div>
            <textarea value={draftText} onChange={e=>setDraftText(e.target.value)} style={{width:"100%",minHeight:300,fontSize:13,fontFamily:"Georgia,serif",lineHeight:1.7,padding:12,border:"1px solid #ddd",borderRadius:2,resize:"vertical",boxSizing:"border-box",color:"#222"}}/>

            {/* Revision request */}
            <div style={{marginTop:12,background:"#f9f9f9",border:"1px solid #e8e8e8",borderRadius:2,padding:12}}>
              <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:"#555",marginBottom:6}}>Request Changes</div>
              <textarea value={revisionNote} onChange={e=>setRevisionNote(e.target.value)} placeholder={`Tell ${draftArticle.reporter?.split(" ")[0]||"the writer"} what to fix — be specific. e.g. "Jelly Roll only won 2 of those 3 conference championship games, not all 3. Fix that stat." or "Make the tone less formal and more chaotic."`} style={{width:"100%",minHeight:64,padding:"8px 10px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontFamily:ff,lineHeight:1.5,resize:"vertical",boxSizing:"border-box",color:"#222",background:"#fff"}}/>
              <button onClick={requestRevision} disabled={revising||!revisionNote.trim()} style={{marginTop:8,background:revising||!revisionNote.trim()?"#ccc":"#444",color:"#fff",border:"none",borderRadius:2,padding:"8px 16px",cursor:revising||!revisionNote.trim()?"not-allowed":"pointer",fontFamily:ff,fontSize:12,fontWeight:800,textTransform:"uppercase"}}>{revising?"Revising…":"✏ Revise Article"}</button>
            </div>

            {/* Featured image + homepage toggle */}
            <div style={{borderTop:"1px solid #eee",marginTop:10,paddingTop:10,display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:"#555",fontFamily:ff}}>Featured Image</div>
              <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                <input ref={articleImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{const f=e.target.files?.[0];if(!f)return;const compressed=await compressImage(f);setArticleImage(compressed);if(articleImgRef.current)articleImgRef.current.value="";}}/>
                <button onClick={()=>articleImgRef.current?.click()} style={{padding:"7px 14px",border:"1px dashed #ccc",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:11,fontWeight:700,background:"#fafafa",color:"#555"}}>{articleImage?"Replace Image":"Upload Image"}</button>
                {articleImage&&<><img src={articleImage} alt="" style={{height:52,borderRadius:2,objectFit:"cover"}}/><button onClick={()=>setArticleImage(null)} style={{padding:"4px 8px",border:"1px solid #eee",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:10,background:"#fff",color:"#888"}}>Remove</button></>}
              </div>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none",fontSize:12,fontWeight:600,color:"#333",fontFamily:ff}}>
                <input type="checkbox" checked={showOnHome} onChange={e=>setShowOnHome(e.target.checked)} style={{width:14,height:14,accentColor:draftArticle.reporterColor||RED}}/>
                Show on Homepage carousel
              </label>
            </div>

            <div style={{display:"flex",gap:10,marginTop:10,alignItems:"center"}}>
              <button onClick={()=>{publishArticle({...draftArticle,text:draftText,imageUrl:articleImage||undefined,showOnHome});setArticleImage(null);setShowOnHome(false);}} disabled={extracting||revising||!draftText.trim()} style={{background:(extracting||revising||!draftText.trim())?"#ccc":(draftArticle.reporterColor||"#111"),color:"#fff",border:"none",borderRadius:2,padding:"10px 20px",cursor:(extracting||revising||!draftText.trim())?"not-allowed":"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Publish</button>
              <button onClick={()=>{setDraftArticle(null);setDraftText("");setRevisionNote("");setArticleImage(null);setShowOnHome(false);}} style={{background:"#fff",color:"#666",border:"1px solid #ccc",borderRadius:2,padding:"10px 20px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:700,textTransform:"uppercase"}}>Discard</button>
              {(extracting||revising)&&<span style={{fontSize:11,color:"#888",fontStyle:"italic"}}>{revising?"Revising…":"Updating Chronicle…"}</span>}
            </div>
          </div>
        </Card>
      )}

      {/* Article Images & Homepage Control */}
      {articles.length>0&&(()=>{
        function saveArticleField(id, fields) {
          const updated = articles.map(a=>a.id===id?{...a,...fields}:a);
          setArticles(updated);
          dbSave({articles:updated});
        }
        return (
          <Card style={{overflow:"hidden"}}>
            <CardHead bg="#1a3a6b">Article Images &amp; Homepage</CardHead>
            <div style={{padding:14,display:"flex",flexDirection:"column",gap:0}}>
              <div style={{fontSize:11,color:"#888",marginBottom:10}}>Upload featured images and control which articles appear in the homepage carousel.</div>
              <input ref={manageImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
                const f=e.target.files?.[0];if(!f||!selArticleId)return;
                const compressed=await compressImage(f);
                saveArticleField(selArticleId,{imageUrl:compressed});
                if(manageImgRef.current)manageImgRef.current.value="";
              }}/>
              {articles.slice(0,15).map(a=>(
                <div key={a.id} style={{display:"flex",gap:10,alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f0f0f0",flexWrap:"wrap"}}>
                  <div style={{width:70,height:48,borderRadius:2,overflow:"hidden",background:"#f0f0f0",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {a.imageUrl?<img src={a.imageUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:9,color:"#bbb",textAlign:"center",fontFamily:ff}}>No image</span>}
                  </div>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{fontSize:10,color:a.reporterColor||RED,fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,fontFamily:ff}}>{a.label} · S{a.season} Wk{a.week}</div>
                    <div style={{fontSize:12,fontWeight:700,color:"#111",lineHeight:1.3,fontFamily:ff,marginTop:2}}>{articleHeadline(a.text)}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
                    <button onClick={()=>{setSelArticleId(a.id);manageImgRef.current?.click();}} style={{padding:"5px 11px",border:"1px solid #ccc",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:10,fontWeight:700,background:"#fff",color:"#333",textTransform:"uppercase"}}>{a.imageUrl?"Replace":"Upload"}</button>
                    {a.imageUrl&&<button onClick={()=>saveArticleField(a.id,{imageUrl:undefined,showOnHome:false})} style={{padding:"5px 8px",border:"1px solid #eee",borderRadius:2,cursor:"pointer",fontFamily:ff,fontSize:10,background:"#fff",color:"#888"}}>Remove</button>}
                    {a.imageUrl&&<label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",userSelect:"none",fontSize:11,fontWeight:600,color:"#333",fontFamily:ff}}>
                      <input type="checkbox" checked={!!a.showOnHome} onChange={e=>saveArticleField(a.id,{showOnHome:e.target.checked})} style={{accentColor:RED}}/>
                      Homepage
                    </label>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Articles */}
      {articles.length===0&&<Card style={{padding:"32px 20px",textAlign:"center"}}><div style={{fontSize:28,marginBottom:10}}>📰</div><div style={{fontSize:14,color:"#888"}}>No articles yet. Select a reporter and article type above.</div></Card>}
      {articles.map(a=>(
        <Card key={a.id} style={{overflow:"hidden",cursor:"pointer"}} onClick={()=>setActiveArticle&&setActiveArticle(a)}>
          <div style={{background:a.reporterColor||"#111",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff"}}>{a.reporterAvatar||"DC"}</div>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:"#fff"}}>{a.reporter||"Dynasty Central"}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.7)"}}>{a.label} · S{a.season} Wk{a.week}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.8)",fontWeight:700}}>READ →</span>
              <button onClick={e=>{e.stopPropagation();const na=articles.filter(x=>x.id!==a.id);setArticles(na);dbSave({articles:na});}} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:16,padding:"0 4px"}}>×</button>
            </div>
          </div>
          <div style={{padding:"12px 16px",fontSize:14,fontWeight:700,color:"#111",lineHeight:1.5}}>{articleHeadline(a.text)}</div>
        </Card>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
// Right Rail Component
function RightRail({sorted,articles,entries,week,season,leader,setActiveArticle,setupRows}) {
  const RED = "#cc0000";
  const ff  = "'Helvetica Neue',Arial,sans-serif";
  const calcT = (t) => (t.gamePts||0)+(t.rankedBonusPts||0)+(t.confStandPts||0)+(t.confChampPts||0)+(t.bowlPts||0)+(t.recruitingPts||0)+(t.prestigePts||0)+(t.heismanPts||0);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>

          <Card><CardHead>Top Headlines</CardHead><div style={{padding:"4px 0"}}>
            {sorted.length===0&&<div style={{padding:"12px",fontSize:12,color:"#888",fontStyle:"italic"}}>No standings yet.</div>}
            {articles.slice(0,4).map(a=>(
              <div key={a.id} onClick={()=>setActiveArticle(a)} style={{padding:"10px 12px",borderBottom:"1px solid #f0f0f0",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="#f7f7f7"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  {a.reporterAvatar&&<div style={{width:18,height:18,borderRadius:"50%",background:a.reporterColor||RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:800,color:"#fff",flexShrink:0}}>{a.reporterAvatar}</div>}
                  <div style={{fontSize:10,color:a.reporterColor||RED,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{a.reporter||"Dynasty Central"} · {a.label}</div>
                </div>
                <div style={{fontSize:13,fontWeight:700,color:"#111",lineHeight:1.4}}>{articleHeadline(a.text)}</div>
              </div>
            ))}
            {articles.length===0&&<>
              {sorted.slice(0,3).map((t,i)=><div key={t.teamName} style={{padding:"9px 12px",borderBottom:"1px solid #f0f0f0"}}><div style={{fontSize:12,fontWeight:700,color:"#111",lineHeight:1.4}}>{i===0?"🏆":i===1?"📈":"📊"} {t.teamName} leads with {calcT(t)} pts</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{t.wins}W - {t.losses}L</div></div>)}
              <div style={{padding:"9px 12px",borderBottom:"1px solid #f0f0f0"}}><div style={{fontSize:11,color:"#888",fontStyle:"italic"}}>Generate content to see articles here</div></div>
            </>}
            <div style={{padding:"9px 12px"}}><div style={{fontSize:12,fontWeight:700,color:"#111"}}>📅 {week>13?"Post-Season":"Week "+week} · Season {season}</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{entries.length} teams</div></div>
          </div></Card>
          <Card><CardHead bg={RED}>Full Standings</CardHead><div style={{padding:"4px 0"}}>
            {sorted.length===0&&<div style={{padding:"12px",fontSize:12,color:"#888",fontStyle:"italic"}}>No standings yet.</div>}
            {sorted.map((t,i)=>{const imgs=getPlayerImages(setupRows,t.userId,t.userName);return(<div key={t.teamName} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,fontWeight:800,color:i===0?RED:"#bbb",width:18,textAlign:"right"}}>{i+1}</span>{imgs.teamLogo&&<img src={imgs.teamLogo} alt="" style={{width:20,height:20,objectFit:"contain",flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>}<div style={{flex:1,minWidth:0}}><Name userId={t.userId} userName={t.userName} style={{fontSize:12,fontWeight:700,color:"#111",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"block"}}>{t.teamName}</Name></div><span style={{fontSize:13,fontWeight:900,color:i===0?RED:"#333",flexShrink:0}}>{calcT(t)}</span></div>);})}
          </div></Card>
    </div>
  );
}


export default function App() {
  const [setup,setSetup] = useState(null);
  const pc = {...DEFAULT_PTS_CONFIG,...(setup?.pointsConfig||{})};
  const [tab,setTab] = useState("Home");
  const [profileSel,setProfileSel] = useState(null);
  const [profilePTab,setProfilePTab] = useState("overview");
  const goToProfile = useCallback((userId, userName)=>{
    const key = userId || userName;
    setProfileSel(key);
    setProfilePTab("overview");
    setTab("Profiles");
  },[]);
  const [season,setSeason] = useState(1);
  const [year,setYear] = useState(2024);
  const [week,setWeek] = useState(1);
  const [entries,setEntries] = useState([]);
  const [history,setHistory] = useState([]);
  const [weekResults,setWeekResults] = useState([]);
  const [postSeasonInputs,setPSI] = useState(null);
  const [commUnlocked,setCommUnlocked] = useState(false);
  const [showPw,setShowPw] = useState(false);
  const [pwInput,setPwInput] = useState("");
  const [pwErr,setPwErr] = useState(false);
  const [clicks,setClicks] = useState(0);
  const [commTab,setCommTab] = useState("Enter Results");
  const [schedule,setSchedule] = useState({}); // {week: {teamName: opponent}}
  const isMobile = useIsMobile();
  const [articles,setArticles] = useState([]);
  const [activeArticle,setActiveArticle] = useState(null);
  const [isEditingArticle,setIsEditingArticle] = useState(false);
  const [articleEditText,setArticleEditText] = useState("");
  const [shareCopied,setShareCopied] = useState(false);
  useEffect(()=>{setIsEditingArticle(false);setShareCopied(false);},[activeArticle?.id]);
  function saveArticleEdit() {
    const updated = articles.map(a=>a.id===activeArticle.id?{...a,text:articleEditText}:a);
    setArticles(updated);
    dbSave({articles:updated});
    setActiveArticle(prev=>prev?{...prev,text:articleEditText}:prev);
    setIsEditingArticle(false);
  }
  async function shareArticle(article) {
    const shareUrl = `${window.location.origin}/a/${article.id}`;
    const headline = articleHeadline(article.text);
    if (navigator.share) {
      try { await navigator.share({title:headline, url:shareUrl}); } catch(e) { /* user dismissed the share sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(()=>setShareCopied(false),2000);
    } catch(e) {
      window.prompt("Copy this link to share:", shareUrl);
    }
  }
  // Deep link: /?article=<id> opens that article directly (used by the /a/:id share-preview page)
  const didAutoOpenArticle = useRef(false);
  useEffect(()=>{
    if (didAutoOpenArticle.current) return;
    const targetId = new URLSearchParams(window.location.search).get("article");
    if (!targetId) { didAutoOpenArticle.current = true; return; }
    if (!articles.length) return;
    const found = articles.find(a=>String(a.id)===targetId);
    if (found) setActiveArticle(found);
    didAutoOpenArticle.current = true;
    window.history.replaceState({}, "", window.location.pathname);
  },[articles]);
  // Deep link: /?tab=<name> jumps straight to that tab (used by the /redzone share-preview page)
  useEffect(()=>{
    const targetTab = new URLSearchParams(window.location.search).get("tab");
    const validTabs = ["Home","Standings","Schedule","History","YearStats","Profiles","Rules","Redzone","Discord"];
    if (targetTab && validTabs.includes(targetTab)) {
      setTab(targetTab);
      window.history.replaceState({}, "", window.location.pathname);
    }
  },[]);
  const [dbLoading,setDbLoading] = useState(true);
  const [dbError,setDbError] = useState(null);
  const [lastSaved,setLastSaved] = useState(null);
  // Stream auto-detection
  const [autoLiveStatuses,setAutoLiveStatuses] = useState({}); // {userKey: bool}
  const [autoEmbedUrls,setAutoEmbedUrls] = useState({}); // {userKey: embedUrl}
  const twitchPlayersRef = useRef({});
  const twitchScriptRef = useRef(false);

  // ── Load from Supabase on mount ──
  useEffect(function() {
    dbLoad().then(function(row) {
      if (row) {
        // Migration: add userIds to setup.rows and entries if missing
        let migratedSetup = row.setup;
        let migratedEntries = row.entries;
        if (row.setup?.rows && !row.setup?.permanentUsers) {
          const updatedRows = row.setup.rows.map(r => ({...r, userId: r.userId || genId()}));
          const idByName = {};
          updatedRows.forEach(r => { idByName[r.userName] = r.userId; });
          if (row.entries?.length) {
            migratedEntries = row.entries.map(e => ({...e, userId: e.userId || idByName[e.userName] || genId()}));
          }
          const permanentUsers = updatedRows.map(r => ({id: r.userId, defaultName: r.userName}));
          migratedSetup = {...row.setup, rows: updatedRows, permanentUsers};
          // Save migration back
          setTimeout(() => dbSave({setup: migratedSetup, entries: migratedEntries}), 500);
        }
        if (migratedSetup) setSetup(migratedSetup);
        if (row.season) setSeason(row.season);
        if (row.setup?.currentYear) setYear(row.setup.currentYear);
        if (row.week != null) setWeek(row.week);
        if (migratedEntries) { if (migratedEntries.length) setEntries(migratedEntries); }
        if (row.history) { if (row.history.length) setHistory(row.history); }
        if (row.post_season_inputs) setPSI(row.post_season_inputs);
        if (row.articles) { if (row.articles.length) setArticles(row.articles); }
        if (row.schedule) setSchedule(row.schedule);
        const hasEntries = migratedEntries ? migratedEntries.length > 0 : false;
        if (hasEntries) {
          setWeekResults((migratedEntries||[]).map(function(e) { return {teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false}; }));
        }
      }
      setDbLoading(false);
    }).catch(function(err) {
      setDbError("Could not connect to database. Check your connection.");
      setDbLoading(false);
    });
  }, []);

  // ── YouTube live auto-detection (poll oEmbed every 90s) ──
  useEffect(()=>{
    const rows=setup?.rows||[];
    const streamLinks=setup?.streamLinks||{};
    const ytRows=rows.filter(r=>{const s=streamLinks[r.userId||r.userName];return s?.url&&getPlatform(s.url)==="youtube";});
    if(!ytRows.length)return;
    async function checkYT(){
      for(const r of ytRows){
        const key=r.userId||r.userName;
        const url=streamLinks[key]?.url;
        const liveUrl=toYouTubeChannelLiveUrl(url);
        if(!liveUrl)continue;
        try{
          const resp=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(liveUrl)}&format=json`);
          if(resp.ok){
            const data=await resp.json();
            const vidMatch=data.html?.match(/embed\/([A-Za-z0-9_-]{11})/);
            const embedUrl=vidMatch?`https://www.youtube.com/embed/${vidMatch[1]}?autoplay=1&rel=0`:null;
            setAutoLiveStatuses(p=>({...p,[key]:true}));
            if(embedUrl)setAutoEmbedUrls(p=>({...p,[key]:embedUrl}));
          }else{
            setAutoLiveStatuses(p=>({...p,[key]:false}));
            setAutoEmbedUrls(p=>{const n={...p};delete n[key];return n;});
          }
        }catch{setAutoLiveStatuses(p=>({...p,[key]:false}));}
      }
    }
    checkYT();
    const iv=setInterval(checkYT,90000);
    return()=>clearInterval(iv);
  },[setup?.streamLinks,setup?.rows]);

  // ── Twitch live auto-detection (Twitch embed player events) ──
  useEffect(()=>{
    const rows=setup?.rows||[];
    const streamLinks=setup?.streamLinks||{};
    const tRows=rows.filter(r=>{const s=streamLinks[r.userId||r.userName];return s?.url&&getPlatform(s.url)==="twitch";});
    if(!tRows.length)return;
    function initPlayers(){
      if(!window.Twitch)return;
      tRows.forEach(r=>{
        const key=r.userId||r.userName;
        const url=streamLinks[key]?.url;
        const m=url?.match(/twitch\.tv\/([^/?#\s]+)/i);
        if(!m)return;
        const channel=m[1];
        // Clean up old player for this key
        if(twitchPlayersRef.current[key]){try{twitchPlayersRef.current[key].destroy();}catch{}}
        let div=document.getElementById(`tz-hidden-${key}`);
        if(!div){div=document.createElement("div");div.id=`tz-hidden-${key}`;div.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;";document.body.appendChild(div);}
        try{
          const parent=window.location.hostname||"localhost";
          const player=new window.Twitch.Player(`tz-hidden-${key}`,{channel,width:400,height:300,muted:true,autoplay:true,parent:[parent]});
          const setLive=v=>{setAutoLiveStatuses(p=>({...p,[key]:v}));if(v)setAutoEmbedUrls(p=>({...p,[key]:getEmbedUrl(url)}));};
          player.addEventListener(window.Twitch.Player.ONLINE,()=>setLive(true));
          player.addEventListener(window.Twitch.Player.OFFLINE,()=>setLive(false));
          // Check initial state after player loads
          player.addEventListener(window.Twitch.Player.READY,()=>{setTimeout(()=>setLive(!player.isPaused()),4000);});
          twitchPlayersRef.current[key]=player;
        }catch(e){console.warn("Twitch player init failed",e);}
      });
    }
    if(window.Twitch){initPlayers();}
    else if(!twitchScriptRef.current){
      twitchScriptRef.current=true;
      const s=document.createElement("script");
      s.src="https://embed.twitch.tv/embed/v1.js";
      s.onload=initPlayers;
      document.head.appendChild(s);
    }
    return()=>{
      Object.entries(twitchPlayersRef.current).forEach(([k,p])=>{
        try{p.destroy();}catch{}
        const d=document.getElementById(`tz-hidden-${k}`);
        if(d)d.remove();
      });
      twitchPlayersRef.current={};
    };
  },[setup?.streamLinks,setup?.rows]);

  // ── Save to Supabase whenever key state changes ──
  // saveToDb defined after render to access latest state
  const stateRef = { setup, season, year, week, entries, history, postSeasonInputs, articles, schedule };
  async function saveToDb(overrides) {
    // Never save while DB is still loading — could overwrite real data with empty state
    if (dbLoading) return;
    var ovr = overrides || {};
    // Embed year into setup.currentYear so it persists in existing JSONB column
    const currentYear = ovr.year !== undefined ? ovr.year : stateRef.year;
    const baseSetup = ovr.setup !== undefined ? ovr.setup : stateRef.setup;
    const setupWithYear = baseSetup ? {...baseSetup, currentYear} : {currentYear};
    var data = {
      setup: setupWithYear,
      season: ovr.season !== undefined ? ovr.season : stateRef.season,
      week: ovr.week !== undefined ? ovr.week : stateRef.week,
      entries: ovr.entries !== undefined ? ovr.entries : stateRef.entries,
      // Never overwrite history with empty array unless explicitly passing an empty array via override
      history: ovr.history !== undefined ? ovr.history : (stateRef.history.length > 0 ? stateRef.history : undefined),
      post_season_inputs: ovr.post_season_inputs !== undefined ? ovr.post_season_inputs : stateRef.postSeasonInputs,
      articles: ovr.articles !== undefined ? ovr.articles : stateRef.articles,
      schedule: ovr.schedule !== undefined ? ovr.schedule : stateRef.schedule,
    };
    // Remove undefined keys so they're excluded from the PATCH
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    try { await dbSave(data); setLastSaved(new Date()); }
    catch(err) { console.error("Save failed:", err); }
  }

  function handleStart(leagueName,rows) {
    // Preserve existing userIds by matching on userName
    const existingIdMap = {};
    (setup?.rows||[]).forEach(r => { if(r.userId) existingIdMap[r.userName] = r.userId; });
    // Also check permanentUsers by defaultName
    (setup?.permanentUsers||[]).forEach(u => { if(!existingIdMap[u.defaultName]) existingIdMap[u.defaultName] = u.id; });
    const rowsWithIds = rows.map(r => ({...r, userId: r.userId || existingIdMap[r.userName.trim()] || genId()}));
    const permanentUsers = rowsWithIds.map(r => ({id: r.userId, defaultName: r.userName.trim()}));
    const initial = rowsWithIds.map(r => INITIAL_ENTRY(r.userName.trim(), r.teamName.trim(), r.userId));
    const newSetup = {leagueName, rows:rowsWithIds, permanentUsers, seasonRosters:setup?.seasonRosters||{}};
    const newPSI=FRESH_PSI(initial);
    setSetup(newSetup);setEntries(initial);setSeason(1);setWeek(1);
    setWeekResults(initial.map(e=>({teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false})));
    setPSI(newPSI);
    dbSave({setup:newSetup,season:1,week:1,entries:initial,history:[],post_season_inputs:newPSI,articles:[]});
  }

  const activeUserIds=new Set((setup?.rows||[]).filter(r=>r.active!==false&&r.userId).map(r=>r.userId));
  const activeUserNames=new Set((setup?.rows||[]).filter(r=>r.active!==false).map(r=>r.userName));
  const activeEntries=entries.filter(e=>(e.userId&&activeUserIds.has(e.userId))||(!e.userId&&activeUserNames.has(e.userName)));
  const sorted=[...activeEntries].sort((a,b)=>calcTotal(b)-calcTotal(a));
  const leader=sorted[0]?calcTotal(sorted[0]):0;
  const teamNames=activeEntries.map(e=>e.teamName);
  const leagueName=setup?.leagueName||"Dynasty Central";

  // Auto-generates the Week News / Week Review / Week Preview articles the moment
  // a week's results are submitted and the schedule advances. Fire-and-forget from
  // the caller; every Claude call is individually try/caught so one failure never
  // blocks the others, and the 3s inter-call cooldown enforced by callClaude's
  // safeguards is respected with explicit spacing instead of racing it.
  async function triggerAutoWeeklyArticles(completedWeek, newWeek, entriesAfter) {
    if (articles.some(a=>a.autoWeek===completedWeek && a.autoSeason===season)) return;
    const activeAfter = entriesAfter.filter(e=>(e.userId&&activeUserIds.has(e.userId))||(!e.userId&&activeUserNames.has(e.userName)));
    const sortedAfter = [...activeAfter].sort((a,b)=>calcTotal(b)-calcTotal(a));
    const leaderAfter = sortedAfter[0]?calcTotal(sortedAfter[0]):0;
    const leagueNameLocal = setup?.leagueName||"Dynasty Central";
    const cameoSlot = completedWeek % 3;
    const r0 = REPORTERS[completedWeek%REPORTERS.length];
    const r1 = REPORTERS[(completedWeek+1)%REPORTERS.length];
    const r2 = REPORTERS[(completedWeek+2)%REPORTERS.length];
    const sleep = ms => new Promise(res=>setTimeout(res,ms));
    const newArticles = [];

    try {
      const prompt = buildAutoNewsPrompt({reporter:r0, leagueName:leagueNameLocal, season, completedWeek, year, history, sorted:sortedAfter, leader:leaderAfter, setup, cameoNote: cameoSlot===0?PERSONALITY_CAMEO_NOTE:""});
      const text = cleanArticle(await callClaude(prompt));
      if(text) newArticles.push({id:Date.now(), type:"weeknews", label:`📰 Week ${completedWeek} News`, week:completedWeek, season, text, reporter:r0.name, reporterColor:r0.color, reporterAvatar:r0.avatar, autoWeek:completedWeek, autoSeason:season});
    } catch(e) { console.error("Auto news article failed:", e); }

    await sleep(3200);

    try {
      const weekGames = (setup?.gameArchive||[]).filter(g=>g.year===Number(year)&&g.week===Number(completedWeek));
      let text;
      if (weekGames.length) {
        const awards = pickWeeklyAwards(weekGames);
        const prompt = buildRecapPrompt(weekGames, awards, leagueNameLocal, completedWeek, season, year, r1) + (cameoSlot===1?PERSONALITY_CAMEO_NOTE:"");
        text = cleanArticle(await callClaude(prompt));
      } else {
        const prompt = buildAutoWeekReviewFallbackPrompt({reporter:r1, leagueName:leagueNameLocal, season, completedWeek, year, history, sorted:sortedAfter, leader:leaderAfter, setup, schedule, cameoNote: cameoSlot===1?PERSONALITY_CAMEO_NOTE:""});
        text = cleanArticle(await callClaude(prompt));
      }
      if(text) newArticles.push({id:Date.now()+1, type:"recap", label:`📰 Week ${completedWeek} Review`, week:completedWeek, season, text, reporter:r1.name, reporterColor:r1.color, reporterAvatar:r1.avatar, autoWeek:completedWeek, autoSeason:season});
    } catch(e) { console.error("Auto week review failed:", e); }

    await sleep(3200);

    try {
      const prompt = buildAutoWeekPreviewPrompt({reporter:r2, leagueName:leagueNameLocal, season, newWeek, year, history, sorted:sortedAfter, leader:leaderAfter, setup, schedule, cameoNote: cameoSlot===2?PERSONALITY_CAMEO_NOTE:""});
      const text = cleanArticle(await callClaude(prompt));
      if(text) newArticles.push({id:Date.now()+2, type:"preview", label:`🔭 Week ${newWeek} Preview`, week:newWeek, season, text, reporter:r2.name, reporterColor:r2.color, reporterAvatar:r2.avatar, autoWeek:completedWeek, autoSeason:season});
    } catch(e) { console.error("Auto week preview failed:", e); }

    if (newArticles.length) {
      setArticles(prev=>{
        const merged=[...newArticles.reverse(),...prev].slice(0,30);
        saveToDb({articles:merged});
        return merged;
      });
    }
  }

  // Posts a week recap + full points standings to GroupMe. Called after triggerAutoWeeklyArticles
  // resolves (rather than concurrently) so the two don't fight over callClaude's single in-flight slot.
  async function postWeekRecapToGroupMe(completedWeek, entriesAfter) {
    try {
      const activeAfter = entriesAfter.filter(e=>(e.userId&&activeUserIds.has(e.userId))||(!e.userId&&activeUserNames.has(e.userName)));
      const sortedAfter = [...activeAfter].sort((a,b)=>calcTotal(b)-calcTotal(a));
      const weekGames = (setup?.gameArchive||[]).filter(g=>g.year===Number(year)&&g.week===Number(completedWeek));
      const gameLines = weekGames.length
        ? weekGames.map(g=>`${g.team1.name} ${g.team1.score}-${g.team2.score} ${g.team2.name}`).join("; ")
        : activeAfter.map(e=>{const log=(e.weekLog||[]).find(l=>l.week===completedWeek);return log&&log.result==="win"?`${e.teamName} beat ${log.opponent}`:null;}).filter(Boolean).join("; ");
      const prompt = `Write a punchy 3-4 sentence recap of Week ${completedWeek} for a dynasty college football league group chat. Conversational, like a quick group chat update — not a formal article. No headline, no markdown, just the recap paragraph.\n\nGames this week: ${gameLines||"No games logged."}\n\nStandings leader: ${sortedAfter[0]?.teamName||"—"} with ${sortedAfter[0]?calcTotal(sortedAfter[0]):0} pts.`;
      const recap = (await callClaude(prompt)).trim();
      const leaderPts = sortedAfter[0]?calcTotal(sortedAfter[0]):0;
      const standingsLines = sortedAfter.map((e,i)=>{
        const pts = calcTotal(e);
        const back = i===0 ? "" : `, -${leaderPts-pts}`;
        return `${i+1}. ${e.teamName} — ${pts}pts (${e.wins}-${e.losses}${back})`;
      }).join("\n");
      const text = `🏈 WEEK ${completedWeek} RESULTS — ${leagueName}\n\n${recap&&recap!=="No content returned."?recap:"Results are in."}\n\n📊 STANDINGS\n${standingsLines}`;
      await postToGroupMe(text);
    } catch(e) {
      console.error("GroupMe week recap failed:", e);
      alert("GroupMe week recap failed to post: "+e.message);
    }
  }

  // Posts the upcoming week's marquee matchup with odds (spread/total/moneyline) to GroupMe.
  // Reuses the same deterministic pricing math as the in-app Game of the Week card (pickGOTW,
  // estimateSpread, estimateTotal, estimateWinProb/probToAmericanOdds) instead of asking Claude
  // to invent numbers — only the hype blurb around them comes from Claude.
  async function postGameOfWeekPreview(newWeek, entriesAfter) {
    try {
      const activeAfter = entriesAfter.filter(e=>(e.userId&&activeUserIds.has(e.userId))||(!e.userId&&activeUserNames.has(e.userName)));
      const sortedAfter = [...activeAfter].sort((a,b)=>calcTotal(b)-calcTotal(a));
      const games = buildGamesList(schedule, newWeek);
      const confGames = games.filter(g=>g.opp!=="BYE"&&!isCPUOpp(g.opp));
      const gotw = pickGOTW(confGames, sortedAfter);
      if (!gotw) return; // no dynasty-vs-dynasty game this week (bye/CPU-only or post-season) — nothing to preview
      const t1 = sortedAfter.find(t=>t.teamName===gotw.team1);
      const t2 = sortedAfter.find(t=>t.teamName===gotw.team2);
      const trend1 = teamScoringTrend(setup?.gameArchive, year, gotw.team1);
      const trend2 = teamScoringTrend(setup?.gameArchive, year, gotw.team2);
      const prob1 = (t1&&t2) ? estimateWinProb(t1,t2,history,trend1,trend2) : 0.5;
      const ml1 = probToAmericanOdds(prob1), ml2 = probToAmericanOdds(1-prob1);
      const spread1 = (t1&&t2) ? estimateSpread(t1,t2,trend1,trend2) : -3.5;
      const spread2 = -spread1;
      const total = estimateTotal(trend1,trend2);
      const fmtSpread = n => n>0?`+${n}`:`${n}`;
      const prompt = `You are a sharp Vegas-style sportsbook analyst hyping up the Game of the Week for a dynasty college football league group chat. Write a punchy 2-3 sentence tease — mention the stakes, talk your line with confidence, no hedging. No headline, no markdown, just the blurb.\n\nGame of the Week (Week ${newWeek}): ${gotw.team1} (#${gotw.rank1} in dynasty points, ${t1?.wins||0}-${t1?.losses||0}) vs ${gotw.team2} (#${gotw.rank2} in dynasty points, ${t2?.wins||0}-${t2?.losses||0}).\nSpread: ${gotw.team1} ${fmtSpread(spread1)} / ${gotw.team2} ${fmtSpread(spread2)}. O/U ${total}. Moneyline: ${gotw.team1} ${fmtOdds(ml1)} / ${gotw.team2} ${fmtOdds(ml2)}.`;
      const blurb = (await callClaude(prompt)).trim();
      const text = `🎰 GAME OF THE WEEK — Week ${newWeek}\n${gotw.team1} (#${gotw.rank1} · ${t1?.wins||0}-${t1?.losses||0}) vs ${gotw.team2} (#${gotw.rank2} · ${t2?.wins||0}-${t2?.losses||0})\n\n${blurb&&blurb!=="No content returned."?blurb:""}\n\n📊 THE LINE\nSpread: ${gotw.team1} ${fmtSpread(spread1)} / ${gotw.team2} ${fmtSpread(spread2)}\nO/U: ${total}\nML: ${gotw.team1} ${fmtOdds(ml1)} / ${gotw.team2} ${fmtOdds(ml2)}`;
      await postToGroupMe(text);
    } catch(e) {
      console.error("GroupMe GOTW preview failed:", e);
      alert("GroupMe Game of the Week preview failed to post: "+e.message);
    }
  }

  function applyWeekResults(targetWeek=week) {
    const thisWeekSchedule = schedule[targetWeek] || {};
    // Build a map of results entered this week
    const resultsMap = {};
    weekResults.forEach(r=>{ if(r.result!=="none") resultsMap[r.teamName]=r; });
    const nextEntries = entries.map(entry=>{
      const r = resultsMap[entry.teamName];
      const opp = thisWeekSchedule[entry.teamName];
      // If this team has a scheduled opponent who entered a result, mirror it
      let effectiveResult = r?.result;
      let effectiveR25 = r?.ranked25||false;
      let effectiveR10 = r?.ranked10||false;
      let effectiveForfeit = r?.forfeit||false;
      if (!effectiveResult && opp && !isCPUOpp(opp) && opp!=="BYE" && resultsMap[opp]) {
        // Mirror opponent result
        const oppResult = resultsMap[opp].result;
        effectiveResult = oppResult==="win"?"loss":oppResult==="loss"?"win":undefined;
        effectiveR25 = false; effectiveR10 = false;
        effectiveForfeit = resultsMap[opp].forfeit||false;
      }
      if(!effectiveResult)return entry;

      // If this team already has a logged result for this week (e.g. re-submitting
      // after replacing a box score scan), undo its prior contribution first so
      // wins/losses/points/H2H aren't double-counted.
      const priorLog=(entry.weekLog||[]).find(l=>l.week===targetWeek);
      let wins=entry.wins,losses=entry.losses,confWins=entry.confWins||0,confLosses=entry.confLosses||0;
      let gamePts=entry.gamePts,rankedBonusPts=entry.rankedBonusPts;
      const h2h={...entry.h2h||{}};
      if(priorLog){
        const priorBonus=priorLog.result==="win"?(priorLog.ranked10?pc.top10Bonus:priorLog.ranked25?pc.top25Bonus:0):0;
        const priorIsConf=priorLog.opponent&&!isCPUOpp(priorLog.opponent)&&priorLog.opponent!=="BYE"&&priorLog.opponent!=="Unknown"&&teamNames.includes(priorLog.opponent);
        if(priorLog.result==="win"){wins--;if(priorIsConf)confWins--;}
        else if(priorLog.result==="loss"){losses--;if(priorIsConf)confLosses--;}
        gamePts-=((priorLog.pts||0)-priorBonus);
        rankedBonusPts-=priorBonus;
        if(priorLog.opponent&&h2h[priorLog.opponent]){
          if(priorLog.result==="win")h2h[priorLog.opponent]={...h2h[priorLog.opponent],wins:Math.max(0,h2h[priorLog.opponent].wins-1)};
          else if(priorLog.result==="loss")h2h[priorLog.opponent]={...h2h[priorLog.opponent],losses:Math.max(0,h2h[priorLog.opponent].losses-1)};
        }
      }

      let pts=0,bonus=0;
      if(effectiveResult==="win"){pts=pc.win;bonus=effectiveR10?pc.top10Bonus:effectiveR25?pc.top25Bonus:0;}
      const log={week:targetWeek,result:effectiveResult,ranked25:effectiveR25,ranked10:effectiveR10,forfeit:effectiveForfeit,pts:pts+bonus,opponent:opp||"Unknown"};
      // Update H2H if opponent is a dynasty member
      if(opp&&!isCPUOpp(opp)&&opp!=="BYE"){
        if(!h2h[opp])h2h[opp]={wins:0,losses:0};
        if(effectiveResult==="win")h2h[opp]={...h2h[opp],wins:h2h[opp].wins+1};
        else if(effectiveResult==="loss")h2h[opp]={...h2h[opp],losses:h2h[opp].losses+1};
      }
      const isConfGame=opp&&!isCPUOpp(opp)&&opp!=="BYE"&&opp!=="Unknown"&&teamNames.includes(opp);
      const newWeekLog=priorLog?(entry.weekLog||[]).map(l=>l.week===targetWeek?log:l):[...(entry.weekLog||[]),log];
      return{...entry,wins:effectiveResult==="win"?wins+1:wins,losses:effectiveResult==="loss"?losses+1:losses,confWins:isConfGame&&effectiveResult==="win"?confWins+1:confWins,confLosses:isConfGame&&effectiveResult==="loss"?confLosses+1:confLosses,gamePts:gamePts+pts,rankedBonusPts:rankedBonusPts+bonus,weekLog:newWeekLog,h2h};
    });
    setEntries(nextEntries);
    setWeekResults(prev=>prev.map(r=>({...r,result:"none",ranked25:false,ranked10:false,forfeit:false})));
    if(targetWeek>=week){
      const newWeek=targetWeek+1;
      setWeek(newWeek);
      setTimeout(()=>saveToDb({week:newWeek,entries:nextEntries}),100);
      triggerAutoWeeklyArticles(targetWeek,newWeek,nextEntries).then(()=>sleep(3200)).then(()=>postWeekRecapToGroupMe(targetWeek,nextEntries)).then(()=>sleep(GOTW_STAGGER_MS)).then(()=>postGameOfWeekPreview(newWeek,nextEntries)).catch(e=>console.error("Auto weekly articles failed:",e));
    }
    else{setTimeout(()=>saveToDb({entries:nextEntries}),100);}
  }

  function applyBulkResults(results, targetWeek=week) {
    const thisWeekSchedule=schedule[targetWeek]||{};
    const nextEntries = entries.map(entry=>{
      const r=results.find(x=>x.leagueTeam===entry.teamName);
      if(!r)return entry;
      let pts=0,bonus=0;
      if(r.result==="win"){pts=pc.win;bonus=r.ranked10?pc.top10Bonus:r.ranked25?pc.top25Bonus:0;}
      const opp=thisWeekSchedule[entry.teamName]||r.opponent;
      const log={week:targetWeek,result:r.result,ranked25:r.ranked25,ranked10:r.ranked10,pts:pts+bonus,opponent:opp,stats:r.stats};
      const h2h={...entry.h2h||{}};
      if(opp&&!isCPUOpp(opp)&&!["BYE","Unknown"].includes(opp)){if(!h2h[opp])h2h[opp]={wins:0,losses:0};if(r.result==="win")h2h[opp].wins++;else if(r.result==="loss")h2h[opp].losses++;}
      const isConfGame=opp&&!isCPUOpp(opp)&&!["BYE","Unknown"].includes(opp)&&teamNames.includes(opp);
      return{...entry,wins:r.result==="win"?entry.wins+1:entry.wins,losses:r.result==="loss"?entry.losses+1:entry.losses,confWins:isConfGame&&r.result==="win"?(entry.confWins||0)+1:(entry.confWins||0),confLosses:isConfGame&&r.result==="loss"?(entry.confLosses||0)+1:(entry.confLosses||0),gamePts:entry.gamePts+pts,rankedBonusPts:entry.rankedBonusPts+bonus,weekLog:[...(entry.weekLog||[]),log],h2h};
    });
    setEntries(nextEntries);
    setWeekResults(prev=>prev.map(r=>({...r,result:"none",ranked25:false,ranked10:false,forfeit:false})));
    if(targetWeek>=week){
      const newWeek=targetWeek+1;
      setWeek(newWeek);
      setTimeout(()=>saveToDb({week:newWeek,entries:nextEntries}),100);
      triggerAutoWeeklyArticles(targetWeek,newWeek,nextEntries).then(()=>sleep(3200)).then(()=>postWeekRecapToGroupMe(targetWeek,nextEntries)).then(()=>sleep(GOTW_STAGGER_MS)).then(()=>postGameOfWeekPreview(newWeek,nextEntries)).catch(e=>console.error("Auto weekly articles failed:",e));
    }
    else{setTimeout(()=>saveToDb({entries:nextEntries}),100);}
  }

  function applyPostSeason() {
    if(!postSeasonInputs)return;
    const psi=postSeasonInputs;
    setEntries(prev=>prev.map(entry=>{
      const t=entry.teamName;
      // Conference standings
      const si=psi.confStandings.findIndex(s=>s.teamName===t);
      const sp=si>=0?((pc.confStand||CONF_STAND_PTS)[si]||0):0;
      // Conf championship game
      let cc=0;
      if(psi.confChampGame){
        if(psi.confChampGame.teamA===t||psi.confChampGame.teamB===t){cc+=pc.confChampApp;if(psi.confChampGame.winner===t)cc+=pc.confChampWin;}
      } else if(psi.confChamp){
        if(psi.confChamp.made?.includes(t))cc+=pc.confChampApp;if(psi.confChamp.winner===t)cc+=pc.confChampWin;
      }
      // Bowl & playoff points
      let bp=0;
      if(psi.bowlGames){
        (psi.bowlGames||[]).forEach(g=>{if(g.teamA===t||g.teamB===t){bp+=pc.bowlApp;if(g.winner===t)bp+=pc.bowlWin;}});
        (psi.playoffR1||[]).forEach(g=>{if(g.teamA===t||g.teamB===t){bp+=pc.playoffApp;if(g.winner===t)bp+=pc.playoffWin;}});
        (psi.playoffR2||[]).forEach(g=>{if(g.winner===t)bp+=pc.playoffSemiWin;});
        (psi.playoffR3||[]).forEach(g=>{if(g.winner===t)bp+=pc.playoffR3Win;});
        if(psi.nattyGame&&psi.nattyGame.winner===t)bp+=pc.nattyWin;
      } else if(psi.bowls){
        const be=psi.bowls.find(b=>b.teamName===t);
        if(be?.bowl==="made")bp=pc.bowlApp;if(be?.bowl==="won")bp=pc.bowlApp+pc.bowlWin;if(be?.bowl==="cfp")bp=pc.playoffApp;if(be?.bowl==="cfpwon")bp=pc.playoffApp+pc.nattyWin;
      }
      // Recruiting
      const ri=psi.recruiting.findIndex(r=>r.teamName===t);
      const rp=ri>=0?((pc.recruiting||RECRUITING_PTS)[ri]||0):0;
      // Prestige & Heisman
      let pp=0;if(psi.prestigeGains.includes(t))pp+=pc.prestigeGain;if(psi.maxPrestige?.includes(t))pp+=pc.prestigeMax;
      // Dynasty Top 5
      const di=(psi.dynastyTop5||[]).findIndex(r=>r.teamName===t);
      const dp=di>=0&&di<5?((pc.dynastyTop5||[15,10,7,5,3])[di]||0):0;
      const hp=(psi.heisman===t?pc.heisman:0)+dp;
      return{...entry,confStandPts:entry.confStandPts+sp,confChampPts:entry.confChampPts+cc,bowlPts:entry.bowlPts+bp,recruitingPts:entry.recruitingPts+rp,prestigePts:entry.prestigePts+pp,heismanPts:entry.heismanPts+hp};
    }));
    setTimeout(()=>saveToDb(),200);
  }

  function finalizeSeason() {
    const fin=entries.map(e=>({...e}));
    const srt=[...fin].sort((a,b)=>calcTotal(b)-calcTotal(a));
    const histEntry={year,seasonNum:season,finalStandings:fin,champion:srt[0]?.userName||"",confChampion:postSeasonInputs?.confChamp?.winner||postSeasonInputs?.confChampGame?.winner||"",heisman:postSeasonInputs?.heisman||""};
    const newSeason = season+1;
    // Use season roster for the new season if set, otherwise keep current names/teams
    const nextRoster = setup?.seasonRosters?.[newSeason];
    const fresh=entries.map(e=>{
      const override = nextRoster?.find(r=>r.userId===e.userId);
      return INITIAL_ENTRY(override?.userName||e.userName, override?.teamName||e.teamName, e.userId);
    });
    // Snapshot this year's schedule so it stays browsable on the Schedule page after the season resets
    const updatedSetup={...setup,scheduleArchive:{...(setup?.scheduleArchive||{}),[year]:schedule}};
    setSetup(updatedSetup);
    setHistory(prev=>{
      const next=[...prev,histEntry];
      setTimeout(()=>dbSave({history:next,season:newSeason,year,week:1,entries:fresh,post_season_inputs:FRESH_PSI(fresh),setup:updatedSetup}),100);
      return next;
    });
    setEntries(fresh);setWeek(1);setSeason(newSeason);
    setWeekResults(fresh.map(e=>({teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false})));
    const newPSI=FRESH_PSI(fresh);
    setPSI(newPSI);
  }

  function importHistoricalSeason(entry) {
    setHistory(prev=>{
      const next=[...prev, entry];
      setTimeout(()=>saveToDb({history:next}),100);
      return next;
    });
  }

  function tryPw(){if(pwInput===PASS){setCommUnlocked(true);setShowPw(false);setPwInput("");setCommTab("Enter Results");}else setPwErr(true);}

  if (dbLoading) return (
    <div style={{minHeight:"100vh",background:"#111",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:ff}}>
      <img src="/jackedupdynastywhite.png" alt="Jacked Up Dynasty" style={{width:120,height:"auto",marginBottom:16}}/>
      <div style={{fontSize:13,color:"#888",letterSpacing:2,textTransform:"uppercase"}}>Loading Dynasty...</div>
      <div style={{marginTop:20,width:200,height:3,background:"#333",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:"60%",height:"100%",background:RED,borderRadius:2,animation:"none"}}/>
      </div>
    </div>
  );

  if (dbError) return (
    <div style={{minHeight:"100vh",background:"#111",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:ff,padding:20}}>
      <img src="/jackedupdynastywhite.png" alt="Jacked Up Dynasty" style={{width:120,height:"auto",marginBottom:16}}/>
      <div style={{fontSize:14,color:RED,textAlign:"center",maxWidth:400}}>{dbError}</div>
      <button onClick={()=>window.location.reload()} style={{marginTop:20,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"10px 24px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Retry</button>
    </div>
  );

  return (
    <NavCtx.Provider value={goToProfile}>
    <div style={{minHeight:"100vh",background:"#f0f0f0",color:"#111",fontFamily:ff,overflowX:"hidden",maxWidth:"100%",boxSizing:"border-box"}}>
      {/* Top black bar */}
      <div style={{background:"#111",padding:"0 12px",height:44,display:"flex",alignItems:"center",gap:10,position:"sticky",top:0,zIndex:200}}>
        <img src="/jackedupdynastytr.png" alt="Jacked Up Dynasty League" style={{height:36,width:"auto",flexShrink:0,objectFit:"contain"}}/>
        <div style={{width:1,height:20,background:"#444",flexShrink:0}}/>
        <div style={{fontSize:isMobile?10:12,color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{leagueName}</div>
        {!isMobile&&<div style={{display:"flex",gap:14,alignItems:"center",flexShrink:0}}>
          {[["S",season],["YR",year],["WK",week>13?"PS":week]].map(([l,v])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:7,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:15,fontWeight:900,color:"#fff",lineHeight:1}}>{v}</div></div>)}
        </div>}
        {isMobile&&<div style={{flexShrink:0,textAlign:"right"}}><div style={{fontSize:9,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>WK</div><div style={{fontSize:14,fontWeight:900,color:"#fff",lineHeight:1}}>{week>13?"PS":week}</div></div>}
      </div>

      {/* Nav tabs */}
      <div style={{background:RED,display:"flex",alignItems:"center",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {(isMobile?[["Home","Home"],["Schedule","Schedule"],["Stats","YearStats"],["Standings","Standings"],["Record Book","History"],["Profiles","Profiles"],["Rules","Rules"],["RedZone","Redzone"],["Discord","Discord"]]:[["Home","Home"],["Schedule","Schedule"],["Stats","YearStats"],["Standings","Standings"],["Record Book","History"],["Profiles","Profiles"],["Rules","Rules"],["RedZone","Redzone"],["Join Discord","Discord"]]).map(([label,val])=>(
          <button key={val} onClick={()=>setTab(val)} style={{flex:"0 0 auto",padding:isMobile?"0 10px":"0 14px",height:isMobile?38:40,background:tab===val?"rgba(255,255,255,0.18)":"transparent",border:"none",borderBottom:tab===val?"3px solid #fff":"3px solid transparent",color:"#fff",cursor:"pointer",fontSize:isMobile?10:11,fontWeight:tab===val?800:500,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.3,whiteSpace:"nowrap"}}>{label}</button>
        ))}
      </div>

      {/* Scores ticker */}
      <div style={{background:"#1a1a1a",borderBottom:"2px solid #cc0000",padding:"5px 10px",display:"flex",gap:0,overflowX:"auto",WebkitOverflowScrolling:"touch",alignItems:"center",scrollbarWidth:"none"}}>
        <span style={{fontSize:8,color:RED,fontWeight:800,textTransform:"uppercase",letterSpacing:1.5,marginRight:10,flexShrink:0}}>SCORES</span>
        {sorted.length===0&&<span style={{fontSize:11,color:"#666",fontStyle:"italic"}}>Season not started</span>}
        {sorted.map((t,i)=>(
          <div key={t.teamName} style={{display:"flex",alignItems:"center",gap:5,padding:"0 10px",borderRight:"1px solid #333",flexShrink:0,minWidth:isMobile?70:0}}>
            <span style={{fontSize:9,fontWeight:800,color:i===0?RED:"#555",width:10}}>{i+1}</span>
            <span style={{fontSize:11,fontWeight:700,color:"#fff",whiteSpace:"nowrap"}}>{isMobile?t.teamName.split(" ")[0]:t.teamName}</span>
            <span style={{fontSize:12,fontWeight:900,color:i===0?"#e8c84a":"#999",marginLeft:3}}>{calcTotal(t)}</span>
          </div>
        ))}
      </div>

      {/* Mobile top strip - top 3 leaders, scrollable */}
      {isMobile&&sorted.length>0&&(
        <div style={{background:"#fff",borderBottom:"1px solid #eee",padding:"8px 0",display:"flex",gap:0,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          {sorted.slice(0,3).map((t,i)=>(
            <div key={t.teamName} style={{flexShrink:0,textAlign:"center",padding:"4px 14px",borderRight:"1px solid #f0f0f0",minWidth:90}}>
              <div style={{fontSize:9,color:i===0?RED:"#aaa",fontWeight:800,textTransform:"uppercase"}}>{i===0?"LEADER":`#${i+1}`}</div>
              <div style={{fontSize:12,fontWeight:700,color:"#111",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:80}}>{t.teamName}</div>
              <div style={{fontSize:15,fontWeight:900,color:i===0?RED:"#333",marginTop:1}}>{calcTotal(t)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main layout */}
      <div style={{maxWidth:1180,margin:"0 auto",padding:isMobile?"12px 16px":"16px 12px",display:"grid",gridTemplateColumns:isMobile?"minmax(0,1fr)":"200px 1fr 260px",gap:isMobile?12:16,alignItems:"start",boxSizing:"border-box"}}>

        {/* Left sidebar - desktop only */}
        {isMobile?null:<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card><CardHead>Dynasty Info</CardHead><div style={{padding:"8px 0"}}>{[["Season",season],["Year",year],["Week",week>13?"Post":week],["Teams",entries.length]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,color:"#888"}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:"#111"}}>{v}</span></div>)}</div></Card>
          <Card><CardHead>Quick Links</CardHead><div style={{padding:"4px 0"}}>{["Home","Schedule","YearStats","Standings","History","Profiles","Rules","Redzone","Discord"].map(l=><div key={l} onClick={()=>setTab(l)} style={{padding:"8px 12px",fontSize:12,color:RED,cursor:"pointer",borderBottom:"1px solid #f5f5f5",fontWeight:500}}>🏈 {l==="History"?"Record Book":l==="YearStats"?"Stats":l}</div>)}</div></Card>
          <Card><CardHead bg={RED}>Points Leader</CardHead>{sorted.length===0?<div style={{padding:"14px 12px",textAlign:"center",color:"#bbb",fontSize:12}}>Not started</div>:sorted.slice(0,1).map(t=><div key={t.teamName} style={{padding:"14px 12px",textAlign:"center"}}><div style={{fontSize:26,fontWeight:900,color:RED}}>{calcTotal(t)}</div><div style={{fontSize:14,fontWeight:700,color:"#111",marginTop:2}}>{t.teamName}</div><div style={{fontSize:11,color:"#555",marginTop:4}}>{t.wins}W - {t.losses}L</div></div>)}</Card>
        </div>}

        {/* Center content */}
        <div style={{display:"flex",flexDirection:"column",gap:isMobile?10:14}}>

          {/* Page header - compact on mobile */}
          {tab==="Home"?(
            <Card style={{padding:isMobile?"10px 12px":"16px 20px",borderLeft:`4px solid ${RED}`,display:"flex",alignItems:"center",gap:14}}>
              <img src="/jackedupdynastytr.png" alt="Jacked Up Dynasty League" style={{height:isMobile?52:68,width:"auto",objectFit:"contain",flexShrink:0}}/>
              <div>
                <div style={{fontSize:isMobile?16:22,fontWeight:900,color:"#111",textTransform:"uppercase",letterSpacing:-0.5}}>{leagueName}</div>
                <div style={{fontSize:10,color:"#888",marginTop:2}}>S{season} · {year} · {week>13?"Post":`Wk ${week}`}</div>
              </div>
            </Card>
          ):(
            <Card style={{padding:isMobile?"10px 12px":"14px 16px",borderLeft:`4px solid ${RED}`}}>
              <div style={{fontSize:isMobile?15:18,fontWeight:900,color:"#111",textTransform:"uppercase"}}>{tab==="Standings"?"Dynasty Standings":tab==="Schedule"?"Season Schedule":tab==="History"?"League Record Book":tab==="YearStats"?"Year Stats":tab==="Profiles"?"Player Profiles":tab==="Redzone"?"Dynasty RedZone":tab==="Discord"?"Join Discord & Voice Chat":"League Rules"}</div>
              <div style={{fontSize:10,color:"#888",marginTop:2}}>{leagueName} · S{season} · {year} · {week>13?"Post":`Wk ${week}`}</div>
            </Card>
          )}

          {tab==="Home"&&(<>
            {/* Featured image carousel */}
            <FeaturedCarousel articles={articles} setActiveArticle={setActiveArticle} RED={RED} ff={ff}/>

            {/* This week's matchups */}
            {schedule&&schedule[week]&&Object.keys(schedule[week]).length>0&&<WeekMatchupsCard schedule={schedule} week={week} sorted={sorted} leagueName={leagueName} season={season} setActiveArticle={setActiveArticle} articles={articles} setArticles={setArticles} commUnlocked={commUnlocked} setupRows={setup?.rows} gameArchive={setup?.gameArchive} year={year} history={history} setTab={setTab}/>}

            {/* Current standings summary */}
            <Card style={{overflow:"hidden"}}>
              <CardHead>Current Standings</CardHead>
              {!sorted.length?<div style={{padding:"20px",textAlign:"center",color:"#888",fontSize:13}}>Season not started</div>:
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{background:"#f7f7f7",borderBottom:`2px solid ${RED}`}}>
                    {["RK","SCHOOL","PTS","BACK","OVR","CONF"].map(h=><th key={h} style={{padding:"8px 8px",textAlign:h==="SCHOOL"?"left":"center",color:"#555",fontSize:8,letterSpacing:1,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>{sorted.map((t,i)=>{const tot=calcTotal(t);const beh=leader-tot;return(
                    <tr key={t.teamName} style={{borderBottom:"1px solid #eee",background:i===0?"#fff8f8":i%2===0?"#fafafa":"#fff"}}>
                      <td style={{padding:"9px 8px",textAlign:"center",fontWeight:900,color:i===0?RED:"#bbb"}}>{i+1}</td>
                      <td style={{padding:"9px 8px",fontWeight:i===0?800:600,color:"#111",whiteSpace:"nowrap"}}><div style={{display:"flex",alignItems:"center",gap:6}}>{(()=>{const imgs=getPlayerImages(setup?.rows,t.userId,t.userName);return imgs.teamLogo?<img src={imgs.teamLogo} alt="" style={{width:22,height:22,objectFit:"contain",flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>:null;})()}<div><Name userId={t.userId} userName={t.userName}>{t.teamName}</Name><div style={{fontSize:10,color:"#888"}}>{t.userName}</div></div></div></td>
                      <td style={{padding:"9px 8px",textAlign:"center",fontWeight:900,color:i===0?RED:"#111",fontSize:15}}>{tot}</td>
                      <td style={{padding:"9px 8px",textAlign:"center",color:beh===0?"#007a00":RED,fontWeight:700}}>{beh===0?"-":`-${beh}`}</td>
                      <td style={{padding:"9px 8px",textAlign:"center",color:"#555",fontWeight:600,fontSize:12}}>{t.wins}-{t.losses}</td>
                      <td style={{padding:"9px 8px",textAlign:"center",color:"#1a3a6b",fontWeight:700,fontSize:12}}>{(t.confWins||0)}-{(t.confLosses||0)}</td>
                    </tr>);})}</tbody>
                </table>
              </div>}
            </Card>

            {/* Latest articles */}
            {articles.length>0&&<Card style={{overflow:"hidden"}}>
              <CardHead>Latest News</CardHead>
              <div style={{padding:"4px 0"}}>
                {articles.slice(0,5).map(a=>(
                  <div key={a.id} onClick={()=>setActiveArticle(a)} style={{padding:"10px 12px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:a.reporterColor||RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{a.reporterAvatar||"DC"}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:10,color:a.reporterColor||RED,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{a.label} · S{a.season} Wk{a.week}</div>
                      <div style={{fontSize:12,fontWeight:700,color:"#111",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",lineHeight:1.35,marginTop:1}}>{articleHeadline(a.text)}</div>
                    </div>
                    <div style={{color:"#ccc",fontSize:16,flexShrink:0}}>›</div>
                  </div>
                ))}
              </div>
            </Card>}
          </>)}

          {tab==="Standings"&&(<>
            {/* Mobile: latest article teaser */}
            {isMobile&&articles.length>0&&(
              <div onClick={()=>setActiveArticle(articles[0])} style={{background:"#111",borderRadius:2,padding:"12px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                    {articles[0].reporterAvatar&&<div style={{width:20,height:20,borderRadius:"50%",background:articles[0].reporterColor||RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800,color:"#fff",flexShrink:0}}>{articles[0].reporterAvatar}</div>}
                    <div style={{fontSize:9,color:articles[0].reporterColor||RED,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>{articles[0].reporter} · {articles[0].label}</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{articleHeadline(articles[0].text)}</div>
                </div>
                <div style={{color:RED,fontWeight:800,fontSize:12,flexShrink:0}}>READ →</div>
              </div>
            )}

            <Card style={{overflow:"hidden"}}>
              <CardHead>Current Standings</CardHead>
              {!entries.length
                ?<div style={{padding:"40px 20px",textAlign:"center"}}><div style={{fontSize:36,marginBottom:12}}>🏈</div><div style={{fontSize:16,fontWeight:900,color:"#111",marginBottom:6}}>Season Starting Soon</div><div style={{fontSize:12,color:"#888"}}>The commissioner is setting up the dynasty.</div></div>
                :<div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?12:13}}>
                    <thead><tr style={{background:"#f7f7f7",borderBottom:`2px solid ${RED}`}}>
                      {(isMobile?["RK","SCHOOL","PTS","BACK","OVR","CONF"]:["RK","SCHOOL","PTS","BACK","OVR","CONF","GAME","BONUS","CSTAND","CC","BOWL","REC","AWD"]).map(h=>(
                        <th key={h} style={{padding:isMobile?"8px 6px":"9px 7px",textAlign:h==="SCHOOL"?"left":"center",color:h==="CONF"?"#1a3a6b":"#555",fontSize:8,letterSpacing:1,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap",borderRight:"1px solid #eee"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{sorted.map((t,i)=>{const tot=calcTotal(t);const beh=leader-tot;return(
                      <tr key={t.teamName} style={{borderBottom:"1px solid #eee",background:i===0?"#fff8f8":i%2===0?"#fafafa":"#fff"}}>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",fontWeight:900,fontSize:isMobile?13:14,color:i===0?RED:"#bbb",borderRight:"1px solid #eee"}}>{i+1}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",fontWeight:i===0?800:600,color:"#111",whiteSpace:"nowrap",borderRight:"1px solid #eee",maxWidth:isMobile?90:140,overflow:"hidden",textOverflow:"ellipsis"}}><div style={{display:"flex",alignItems:"center",gap:6}}>{(()=>{const imgs=getPlayerImages(setup?.rows,t.userId,t.userName);return imgs.teamLogo?<img src={imgs.teamLogo} alt="" style={{width:22,height:22,objectFit:"contain",flexShrink:0}} onError={e=>{e.target.style.display="none";}}/>:null;})()}<div><Name userId={t.userId} userName={t.userName}>{t.teamName}</Name>{!isMobile&&<div style={{fontSize:10,color:"#888",fontWeight:400}}>{t.userName}</div>}</div></div></td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",fontWeight:900,color:i===0?RED:"#111",fontSize:isMobile?14:16,background:i===0?"#fff0f0":"transparent",borderRight:"2px solid #ddd"}}>{tot}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",color:beh===0?"#007a00":RED,fontWeight:700,fontSize:isMobile?11:12,borderRight:"2px solid #ddd",whiteSpace:"nowrap"}}>{beh===0?"-":`-${beh}`}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",color:"#555",fontWeight:600,fontSize:isMobile?11:12,borderRight:"1px solid #eee",whiteSpace:"nowrap"}}>{t.wins}-{t.losses}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",color:"#1a3a6b",fontWeight:700,fontSize:isMobile?11:12,borderRight:isMobile?"none":"2px solid #ddd",whiteSpace:"nowrap"}}>{(t.confWins||0)}-{(t.confLosses||0)}</td>
                        {isMobile?null:<><td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.gamePts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",color:"#cc7700",fontWeight:700,borderRight:"1px solid #eee"}}>{t.rankedBonusPts>0?`+${t.rankedBonusPts}`:"—"}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.confStandPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.confChampPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.bowlPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.recruitingPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center"}}>{t.prestigePts+t.heismanPts}</td></>}
                      </tr>
                    );})}</tbody>
                  </table>
                  {isMobile&&<div style={{padding:"6px 12px",fontSize:10,color:"#aaa",textAlign:"center"}}>Tap Full Standings for breakdown</div>}
                </div>
              }
            </Card>

            {/* Mobile articles feed */}
            {isMobile&&articles.length>1&&(
              <Card style={{overflow:"hidden"}}>
                <CardHead>Latest Articles</CardHead>
                <div style={{padding:"4px 0"}}>
                  {articles.slice(0,5).map(a=>(
                    <div key={a.id} onClick={()=>setActiveArticle(a)} style={{padding:"10px 12px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:a.reporterColor||RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{a.reporterAvatar||"DC"}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:10,color:a.reporterColor||RED,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{a.label} · S{a.season} Wk{a.week}</div>
                        <div style={{fontSize:12,fontWeight:700,color:"#111",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",lineHeight:1.35,marginTop:1}}>{articleHeadline(a.text)}</div>
                      </div>
                      <div style={{color:"#ccc",fontSize:16,flexShrink:0}}>›</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>)}

          {tab==="History"&&<HistoryTab history={history} setHistory={setHistory} saveToDb={saveToDb} commUnlocked={commUnlocked} yearRosters={setup?.yearRosters} permanentUsers={setup?.permanentUsers} currentEntries={entries} season={season} year={year} setupRows={setup?.rows||[]} gameArchive={setup?.gameArchive} classicGames={setup?.classicGames} playerStats={setup?.playerStats}/>}
          {tab==="YearStats"&&<YearStatsTab history={history} currentEntries={activeEntries} season={season} year={year} setupRows={setup?.rows||[]} permanentUsers={setup?.permanentUsers} playerStats={setup?.playerStats} gameArchive={setup?.gameArchive}/>}
          {tab==="Profiles"&&<ProfileTab history={history} setupRows={(setup?.rows||[]).filter(r=>r.active!==false)} currentEntries={activeEntries} season={season} year={year} permanentUsers={setup?.permanentUsers?.filter(u=>(setup?.rows||[]).some(r=>r.userId===u.id&&r.active!==false))} sel={profileSel} setSel={setProfileSel} pTab={profilePTab} setPTab={setProfilePTab} articles={articles} setActiveArticle={setActiveArticle} playerStats={setup?.playerStats} gameArchive={setup?.gameArchive}/>}
          {tab==="Schedule"&&<ScheduleTab schedule={schedule} entries={activeEntries} week={week} season={season} year={year} setup={setup} setupRows={setup?.rows||[]} history={history}/>}
          {tab==="Rules"&&(()=>{
            const customCats=(pc.customCategories||[]);
            const ptsCards=[
              {title:"Regular Season",rows:[["Win",pc.win],["Win vs Top 25",pc.top25Bonus],["Win vs Top 10",pc.top10Bonus]].filter(([,v])=>v>0).map(([l,v])=>[l,`${v} pts`])},
              {title:"Conference Standings",rows:(pc.confStand||CONF_STAND_PTS).map((v,i)=>v>0?[`${i+1}${i===0?"st":i===1?"nd":i===2?"rd":"th"} Place`,`${v} pts`]:null).filter(Boolean)},
              {title:"Conference Championship",rows:[["Make the Game",pc.confChampApp],["Win the Game",pc.confChampWin]].filter(([,v])=>v>0).map(([l,v])=>[l,`${v} pts`])},
              {title:"Bowl & Playoff",rows:[["Make a Bowl",pc.bowlApp],["Win a Bowl",pc.bowlWin],["Make CFP",pc.playoffApp],["Win Playoff Game",pc.playoffWin],["Win Semifinal",pc.playoffSemiWin],["Win Playoff R3",pc.playoffR3Win],["Win National Championship",pc.nattyWin]].filter(([,v])=>v>0).map(([l,v])=>[l,`${v} pts`])},
              {title:"Recruiting",rows:(pc.recruiting||RECRUITING_PTS).map((v,i)=>v>0?[`#${i+1} Recruiting`,`${v} pts`]:null).filter(Boolean)},
              {title:"Dynasty Top 5",rows:(pc.dynastyTop5||[15,10,7,5,3]).map((v,i)=>v>0?[`#${i+1} in Dynasty`,`${v} pts`]:null).filter(Boolean)},
              {title:"Prestige & Awards",rows:[["Gain a Prestige Star",pc.prestigeGain],["Reach Max Prestige",pc.prestigeMax],["Heisman Winner",pc.heisman]].filter(([,v])=>v>0).map(([l,v])=>[l,`${v} pts`])},
              ...customCats.map(c=>({title:c.name,rows:(c.awards||[]).filter(a=>a.pts>0).map(a=>[a.label,`${a.pts} pts`])})),
            ].filter(c=>c.rows.length>0);
            return(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(setup?.leagueRules||[]).length>0&&<div>
                  <div style={{fontSize:11,fontWeight:800,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>League Rules</div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(300px,1fr))",gap:10,marginBottom:10}}>
                    {(setup.leagueRules).map((rule,i)=>(
                      <Card key={i} style={{overflow:"hidden"}}>
                        <CardHead bg="#222">{rule.title}</CardHead>
                        <div style={{padding:"12px 16px",fontSize:13,color:"#333",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{rule.body}</div>
                      </Card>
                    ))}
                  </div>
                </div>}
                {ptsCards.length>0&&<div style={{fontSize:11,fontWeight:800,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Points System</div>}
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
                  {ptsCards.map(({title,rows})=><Card key={title} style={{overflow:"hidden"}}><CardHead bg={RED}>{title}</CardHead><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{rows.map(([l,p])=><tr key={l} style={{borderBottom:"1px solid #f0f0f0"}}><td style={{padding:"8px 12px",color:"#333",fontSize:13}}>{l}</td><td style={{padding:"8px 12px",textAlign:"right",color:RED,fontWeight:800,fontSize:13}}>{p}</td></tr>)}</tbody></table></Card>)}
                </div>
              </div>
            );
          })()}
          {tab==="Redzone"&&<DynastyRedzone setup={setup} entries={activeEntries} setTab={setTab} autoLiveStatuses={autoLiveStatuses} autoEmbedUrls={autoEmbedUrls} schedule={schedule} week={week}/>}
          {tab==="Discord"&&<DiscordTab/>}
        </div>

        {/* Right rail - desktop only */}
        {tab!=="Redzone"&&tab!=="Discord"&&!isMobile&&<RightRail sorted={sorted} articles={articles} entries={activeEntries} week={week} season={season} leader={leader} setActiveArticle={setActiveArticle} setupRows={setup?.rows}/>}
      </div>

      {/* Hidden footer */}
      <div style={{padding:"20px 0 12px",textAlign:"center",borderTop:"1px solid #ddd",marginTop:20,background:"#fff"}}>
        <span onClick={()=>{const n=clicks+1;setClicks(n);if(n>=3){setShowPw(true);setClicks(0);}}} style={{fontSize:10,color:"#eeeeee",cursor:"default",userSelect:"none",letterSpacing:1}}>© {START_YEAR} Dynasty Central. All rights reserved.</span>
      </div>

      {/* Article Reader Modal */}
      {activeArticle&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"flex-start",justifyContent:"center",zIndex:8000,overflowY:"auto",padding:"20px 16px"}} onClick={e=>{if(e.target===e.currentTarget)setActiveArticle(null);}}>
        <div style={{background:"#fff",borderRadius:3,maxWidth:700,width:"100%",overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.4)",marginTop:20,marginBottom:20}}>
          <div style={{background:"#111",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:22,fontWeight:900,color:"#fff",fontStyle:"italic",letterSpacing:-1}}>ESPN</div>
              <div style={{width:1,height:20,background:"#444"}}/>
              <div style={{fontSize:11,color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>Dynasty Central</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {!isEditingArticle&&<button onClick={()=>shareArticle(activeArticle)} style={{background:"transparent",border:"1px solid #444",color:"#aaa",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontSize:13,fontFamily:ff}}>{shareCopied?"✓ Link Copied":"⤴ Share"}</button>}
              {commUnlocked&&!isEditingArticle&&<button onClick={()=>{setArticleEditText(activeArticle.text);setIsEditingArticle(true);}} style={{background:"transparent",border:"1px solid #444",color:"#aaa",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontSize:13,fontFamily:ff}}>✎ Edit</button>}
              <button onClick={()=>setActiveArticle(null)} style={{background:"transparent",border:"1px solid #444",color:"#aaa",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontSize:13,fontFamily:ff}}>✕ Close</button>
            </div>
          </div>
          <div style={{background:activeArticle.reporterColor||RED,padding:"10px 18px",display:"flex",gap:14,alignItems:"center"}}>
            {activeArticle.reporterAvatar&&<div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",flexShrink:0}}>{activeArticle.reporterAvatar}</div>}
            <div>
              <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{activeArticle.reporter||"Dynasty Central"}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{activeArticle.label} · Season {activeArticle.season} · Week {activeArticle.week}</div>
            </div>
          </div>
          {activeArticle.imageUrl&&!isEditingArticle&&<img src={activeArticle.imageUrl} alt="" style={{width:"100%",maxHeight:380,objectFit:"cover",display:"block"}}/>}
          <div style={{padding:"24px 24px 32px"}}>
            {isEditingArticle ? (
              <textarea value={articleEditText} onChange={e=>setArticleEditText(e.target.value)} rows={16} style={{width:"100%",boxSizing:"border-box",fontSize:14,lineHeight:1.7,color:"#222",fontFamily:"Georgia, serif",padding:12,border:"1px solid #ccc",borderRadius:2,resize:"vertical"}} autoFocus/>
            ) : (<>
              <div style={{fontSize:24,fontWeight:900,color:"#111",lineHeight:1.3,fontFamily:ff,marginBottom:14}}>{articleHeadline(activeArticle.text)}</div>
              <div style={{fontSize:15,lineHeight:1.9,color:"#222",whiteSpace:"pre-wrap",fontFamily:"Georgia, serif"}}>{articleBodyWithoutHeadline(activeArticle.text)}</div>
            </>)}
          </div>
          <div style={{background:"#f7f7f7",padding:"12px 18px",borderTop:"1px solid #ddd",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            {isEditingArticle ? (<>
              <button onClick={()=>setIsEditingArticle(false)} style={{background:"#fff",color:"#555",border:"1px solid #ddd",borderRadius:2,padding:"7px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>Cancel</button>
              <button onClick={saveArticleEdit} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"7px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>💾 Save Changes</button>
            </>) : (<>
              <div style={{fontSize:11,color:"#888"}}>Generated by Dynasty Central AI</div>
              <button onClick={()=>{setActiveArticle(null);setTab("Content");}} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"7px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>View All Articles →</button>
            </>)}
          </div>
        </div>
      </div>}

      {/* Password modal */}
      {showPw&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
        <div style={{background:"#fff",borderTop:`4px solid ${RED}`,borderRadius:4,padding:32,width:300,textAlign:"center",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#555",letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>Commissioner Access</div>
          <input type="password" value={pwInput} onChange={e=>{setPwInput(e.target.value);setPwErr(false);}} onKeyDown={e=>{if(e.key==="Enter")tryPw();}} placeholder="Password" style={{background:"#fff",border:"1px solid #ccc",borderRadius:2,padding:"10px 12px",color:"#111",fontFamily:ff,fontSize:14,width:"100%",boxSizing:"border-box",textAlign:"center",letterSpacing:2,marginBottom:8}} autoFocus/>
          {pwErr&&<div style={{fontSize:12,color:RED,marginBottom:8,fontWeight:700}}>Incorrect password</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={tryPw} style={{flex:1,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"10px",cursor:"pointer",fontWeight:800,fontSize:13,fontFamily:ff,textTransform:"uppercase"}}>Enter</button>
            <button onClick={()=>{setShowPw(false);setPwInput("");setPwErr(false);}} style={{flex:1,background:"#f5f5f5",color:"#555",border:"1px solid #ddd",borderRadius:2,padding:"10px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:ff,textTransform:"uppercase"}}>Cancel</button>
          </div>
        </div>
      </div>}

      {/* Commissioner overlay */}
      {commUnlocked&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#f0f0f0",zIndex:500,overflowY:"auto"}}>
        <div style={{background:RED,padding:"0 16px",display:"flex",alignItems:"center",height:50,position:"sticky",top:0,zIndex:100}}>
          <div style={{fontSize:15,fontWeight:900,color:"#fff",letterSpacing:0.5,flex:1}}>🔐 COMMISSIONER MODE — {leagueName}</div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {lastSaved&&<div style={{fontSize:10,color:"rgba(255,255,255,0.6)"}}>✓ Saved {lastSaved.toLocaleTimeString()}</div>}
            <button onClick={()=>saveToDb()} style={{background:"rgba(0,0,0,0.2)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",borderRadius:2,padding:"5px 10px",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700}}>💾 Save</button>
            <button onClick={()=>setCommUnlocked(false)} style={{background:"rgba(0,0,0,0.25)",border:"none",color:"#fff",borderRadius:2,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff}}>EXIT ×</button>
          </div>
        </div>
        <div style={{background:"#1a1a1a",borderBottom:"1px solid #333",display:"flex",overflowX:"auto"}}>
          {["Enter Results","Season History","Schedule","Content","Player Stats","League Setup"].map(t=><button key={t} onClick={()=>setCommTab(t)} style={{padding:"11px 18px",background:"transparent",border:"none",borderBottom:commTab===t?`3px solid ${RED}`:"3px solid transparent",color:commTab===t?"#fff":"#888",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{t}</button>)}
        </div>
        <div style={{maxWidth:800,margin:"0 auto",padding:"20px 14px"}}>
          {commTab==="Season History"&&<HistoryTab history={history} setHistory={setHistory} saveToDb={saveToDb} commUnlocked={true} entries={entries} setEntries={setEntries} season={season} week={week} setWeek={setWeek} yearRosters={setup?.yearRosters} permanentUsers={setup?.permanentUsers} currentEntries={entries} year={year} setupRows={setup?.rows||[]} gameArchive={setup?.gameArchive} classicGames={setup?.classicGames} playerStats={setup?.playerStats}/>}
          {commTab==="Enter Results"&&<EnterResultsPanel entries={activeEntries} weekResults={weekResults} setWeekResults={setWeekResults} week={week} setWeek={setWeek} applyBulkResults={applyBulkResults} applyWeekResults={applyWeekResults} postSeasonInputs={postSeasonInputs} setPSI={setPSI} applyPostSeason={applyPostSeason} finalizeSeason={finalizeSeason} season={season} setSeason={setSeason} year={year} setYear={setYear} teamNames={teamNames} schedule={schedule} history={history} onImportHistory={importHistoricalSeason} setupRows={setup?.rows||[]} saveToDb={saveToDb} setup={setup} setSetup={setSetup} postWeekRecapToGroupMe={postWeekRecapToGroupMe} postGameOfWeekPreview={postGameOfWeekPreview}/>}
          {commTab==="Schedule"&&<SchedulePanel entries={activeEntries} schedule={schedule} setSchedule={setSchedule}/>}
{commTab==="Content"&&<ContentHub sorted={sorted} entries={activeEntries} week={week} season={season} year={year} leagueName={leagueName} history={history} leader={leader} articles={articles} setArticles={setArticles} setActiveArticle={setActiveArticle} schedule={schedule} setup={setup} setSetup={setSetup} saveToDb={saveToDb}/>}
          {commTab==="Player Stats"&&<PlayerStatsAdmin setup={setup} setSetup={setSetup} saveToDb={saveToDb} permanentUsers={setup?.permanentUsers||[]} year={year} ff={ff} RED={RED}/>}
          {commTab==="League Setup"&&<SetupPanel entries={entries} setup={setup} postSeasonInputs={postSeasonInputs} setPSI={setPSI} handleStart={handleStart} setCommissionerUnlocked={setCommUnlocked} season={season} year={year} setEntries={setEntries} setWeekResults={setWeekResults} setSetup={setSetup} saveToDb={saveToDb} history={history} setHistory={setHistory} autoLiveStatuses={autoLiveStatuses} autoEmbedUrls={autoEmbedUrls}/>}
        </div>
      </div>}
    </div>
    </NavCtx.Provider>
  );
}
