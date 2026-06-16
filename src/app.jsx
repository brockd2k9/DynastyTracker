
import { useState, useEffect, useCallback, useContext, createContext } from "react";

const NavCtx = createContext(null);
function Name({children, userId, userName, style={}}) {
  const nav = useContext(NavCtx);
  if (!nav) return <span style={style}>{children}</span>;
  return <span onClick={()=>nav(userId, userName)} style={{cursor:"pointer",textDecoration:"underline dotted",textUnderlineOffset:2,...style}} title={`View ${children}'s profile`}>{children}</span>;
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
const START_YEAR = 2024;
const PASS = "RatedRKO99";
const MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";
const HEADERS = {"Content-Type":"application/json"};

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
  nattyGame: {teamA:"",teamB:"",winner:""},
  recruiting: entries.map((e,i)=>({teamName:e.teamName,rank:i+1})),
  dynastyTop5: entries.map((e,i)=>({teamName:e.teamName,rank:i+1})),
  heisman:"",
  prestigeGains:[],
  maxPrestige:[],
});

// schedule shape: { week: { teamName: "Opponent" | "CPU" | "BYE" } }
// e.g. { 1: { Troy: "Georgia Southern", "Georgia Southern": "Troy", Toledo: "CPU", UNLV: "BYE" } }

function calcTotal(t) {
  if (t.historicalTotal !== undefined) return t.historicalTotal;
  return (t.gamePts||0)+(t.rankedBonusPts||0)+(t.confStandPts||0)+(t.confChampPts||0)+(t.bowlPts||0)+(t.recruitingPts||0)+(t.prestigePts||0)+(t.heismanPts||0);
}

function cleanArticle(text, maxChars=1000) {
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
    .trim()
    .slice(0, maxChars);
}

function articleHeadline(text) {
  return (text||"").split("\n").map(l=>l.trim()).find(l=>l.length>0) || text?.slice(0,80) || "";
}

async function callClaude(prompt) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY;
  if (!apiKey) throw new Error("Anthropic API key not configured. Add VITE_ANTHROPIC_KEY to GitHub Actions secrets and Cloudflare build variables.");
  const controller = new AbortController();
  const tid = setTimeout(()=>controller.abort(), 45000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{role:"user", content: prompt}],
      }),
    });
    clearTimeout(tid);
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err?.error?.message || `API error ${r.status}`);
    }
    const d = await r.json();
    return d.content?.[0]?.text || "No content returned.";
  } catch(e) {
    clearTimeout(tid);
    if (e.name === "AbortError") throw new Error("Request timed out after 45 seconds.");
    throw e;
  }
}

const ff = "'Helvetica Neue',Arial,sans-serif";
const RED = "#cc0000";

function SL({children}) {
  return <div style={{fontSize:11,fontWeight:800,letterSpacing:2,textTransform:"uppercase",color:"#555",borderLeft:`3px solid ${RED}`,paddingLeft:8,marginBottom:14,fontFamily:ff}}>{children}</div>;
}
function Card({children,style={}}) {
  return <div style={{background:"#fff",border:"1px solid #ddd",borderRadius:2,...style}}>{children}</div>;
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

function WeekMatchupsCard({schedule,week,sorted,leagueName,season,setActiveArticle,articles,setArticles}) {
  const [generating,setGenerating] = useState(false);

  const games = buildGamesList(schedule, week);
  const confGames = games.filter(g => g.opp !== "BYE" && g.opp !== "CPU");
  const gameOfWeek = pickGOTW(confGames, sorted);

  const generateGOTWPreview = async () => {
    if(!gameOfWeek) return;
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
              : <button onClick={generateGOTWPreview} disabled={generating} style={{background:generating?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",color:"#fff",borderRadius:2,padding:"5px 12px",cursor:generating?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"'Helvetica Neue',Arial,sans-serif",textTransform:"uppercase"}}>{generating?"Writing...":"Generate Preview"}</button>
            }
          </div>
          <div style={{padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:0,width:"100%",boxSizing:"border-box"}}>
              <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
                <div style={{fontSize:18,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{gameOfWeek.team1}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank1} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team1)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team1)?.losses||0}L</div>
              </div>
              <div style={{padding:"0 12px",textAlign:"center",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:900,color:"#1a3a6b",letterSpacing:2}}>VS</div>
                <div style={{fontSize:10,color:"#aaa",marginTop:4,fontWeight:600}}>Conf</div>
              </div>
              <div style={{flex:1,textAlign:"center",minWidth:0,overflow:"hidden"}}>
                <div style={{fontSize:18,fontWeight:900,color:"#111",wordBreak:"break-word",lineHeight:1.2}}>{gameOfWeek.team2}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank2} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team2)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team2)?.losses||0}L</div>
              </div>
            </div>
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
            return(
              <div key={i} style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f0f0f0",background:isGOTW?"#f8f9ff":"transparent",gap:4}}>
                {isGOTW&&<span style={{fontSize:10,flexShrink:0}}>🏆</span>}
                {opp==="BYE"
                  ?<><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team}</span><span style={{fontSize:11,color:"#aaa",background:"#f5f5f5",borderRadius:2,padding:"2px 8px",flexShrink:0}}>BYE</span></>
                  :opp==="CPU"
                  ?<><span style={{fontSize:13,fontWeight:700,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team}</span><span style={{fontSize:10,fontWeight:800,color:"#bbb",padding:"0 8px",flexShrink:0}}>VS</span><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>CPU</span></>
                  :<><span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>{team}</span><div style={{padding:"0 10px",textAlign:"center",flexShrink:0}}><span style={{fontSize:10,fontWeight:900,color:isGOTW?"#1a3a6b":"#bbb",letterSpacing:1}}>VS</span></div><span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{opp}</span></>
                }
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
  const teamNames = (entries||[]).map(e=>e.teamName);
  const WEEKS = Array.from({length:12},(_,i)=>i+1);
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
          if (w < 1 || w > 12) return;
          ns[w] = {...(ns[w]||{})};
          Object.entries(matchups).forEach(([team, opp]) => {
            const matchedTeam = teamNames.find(t => t.toLowerCase() === team.toLowerCase()) || team;
            const matchedOpp = opp === "CPU" || opp === "BYE" ? opp : (teamNames.find(t => t.toLowerCase() === opp.toLowerCase()) || opp);
            if (teamNames.includes(matchedTeam)) { ns[w][matchedTeam] = matchedOpp; filled++; }
            if (matchedOpp !== "CPU" && matchedOpp !== "BYE" && teamNames.includes(matchedOpp)) ns[w][matchedOpp] = matchedTeam;
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
      if(opp!=="BYE"&&opp!=="CPU"&&teamNames.includes(opp))ns[wk][opp]=team;
      return ns;
    });
    setSaved(false);
  }

  function clearWeek(wk) {
    if(!window.confirm(`Clear all matchups for Week ${wk}?`))return;
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

  const getOpp=(wk,team)=>schedule[wk]?.[team]||"";
  const countGames=team=>WEEKS.filter(w=>schedule[w]?.[team]&&schedule[w][team]!=="").length;
  const confCount=team=>WEEKS.filter(w=>schedule[w]?.[team]&&schedule[w][team]!=="BYE"&&schedule[w][team]!=="CPU").length;
  const cpuCount=team=>WEEKS.filter(w=>schedule[w]?.[team]&&schedule[w][team]==="CPU").length;

  if(!teamNames.length) return (
    <Card style={{padding:20}}><div style={{color:"#888",fontSize:14,textAlign:"center"}}>No teams found. Set up your league first in League Setup.</div></Card>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{padding:16}}>
        <SL>Import Schedule from Screenshot</SL>
        <p style={{fontSize:13,color:"#888",marginBottom:12,lineHeight:1.5}}>Take a screenshot of your dynasty schedule screen and Claude will read all 12 weeks automatically.</p>
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
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
          {WEEKS.map(w=>{
            const gset=teamNames.filter(t=>schedule[w]?.[t]).length;
            const done=gset===teamNames.length&&teamNames.length>0;
            return(<button key={w} onClick={()=>setEditWeek(w)} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:editWeek===w?RED:done?"#cce5cc":"#ddd",background:editWeek===w?RED:done?"#f0f8f0":"#fff",color:editWeek===w?"#fff":done?"#007a00":"#555",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff}}>Wk {w}</button>);
          })}
        </div>
        <div style={{background:"#f9f9f9",border:"1px solid #eee",borderRadius:3,padding:14,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:800,color:"#111",marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>Week {editWeek} Matchups</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {teamNames.map(team=>{
              const opp=getOpp(editWeek,team);
              const autoSet=opp&&opp!=="BYE"&&opp!=="CPU"&&teamNames.includes(opp)&&getOpp(editWeek,opp)===team;
              return(
                <div key={team} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#fff",border:"1px solid #eee",borderRadius:2}}>
                  <div style={{width:130,fontSize:13,fontWeight:600,color:"#111",flexShrink:0}}>{team}</div>
                  <div style={{fontSize:11,color:"#aaa",flexShrink:0}}>vs</div>
                  <select value={opp} onChange={e=>setMatchup(editWeek,team,e.target.value)} disabled={autoSet&&opp!=="BYE"&&opp!=="CPU"} style={{flex:1,background:autoSet?"#f0f8f0":"#fff",border:"1px solid #ddd",borderRadius:2,padding:"5px 8px",fontFamily:ff,fontSize:12,color:opp?"#111":"#aaa"}}>
                    <option value="">-- Not set --</option>
                    {OPPONENTS.filter(o=>o!==team).map(o=><option key={o} value={o}>{o==="BYE"?"🏖️ BYE WEEK":o==="CPU"?"💻 CPU (non-conf)":o}</option>)}
                  </select>
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
                        {o==="BYE"?<span style={{fontSize:10,color:"#aaa"}}>BYE</span>:o==="CPU"?<span style={{fontSize:10,color:"#888",fontWeight:600}}>CPU</span>:o?<span style={{fontSize:10,color:"#111",fontWeight:500}}>{o.split(" ")[0]}</span>:<span style={{color:"#ddd"}}>—</span>}
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

// ── History Tab ───────────────────────────────────────────────────────────
function HistoryTab({history, setHistory, saveToDb, commUnlocked, entries, setEntries, season, week, setWeek, yearRosters, permanentUsers}) {
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
  // Aggregate all-time stats — userName is permanent, only teamName changes per season
  const allWins={}, confT={}, nattyT={};
  history.forEach(s=>{
    const nameMap={};
    s.finalStandings.forEach(t=>{ nameMap[t.teamName]=t.userName; });
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
  const wList=Object.entries(allWins).sort((a,b)=>b[1]-a[1]);

  // Sort history by year descending
  const sortedHistory=[...history].sort((a,b)=>(b.year||0)-(a.year||0));

  const numI=(val,onChange,w=52)=><input type="number" min="0" value={val??""} onChange={e=>onChange(e.target.value)}
    style={{width:w,padding:"3px 5px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontWeight:700,textAlign:"center",fontFamily:ff}}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* Live Season Editor */}
      {commUnlocked&&entries?.length>0&&<Card style={{borderTop:`3px solid ${RED}`,overflow:"hidden"}}>
        <div style={{background:"#111",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <span style={{fontSize:13,fontWeight:900,color:"#fff",letterSpacing:1}}>CURRENT SEASON</span>
            <span style={{fontSize:11,color:"#888",marginLeft:10}}>{season&&week?`S${season} · Week ${week}`:""}</span>
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
          {wList.map(([u,w],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}>
            <span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span>
            <span style={{fontSize:13,fontWeight:800,color:"#007a00"}}>{w}W</span>
          </div>)}
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
          const displayData=rawData.finalStandings ? {...rawData, finalStandings:applyRoster(rawData.finalStandings, rawData.year)} : rawData;
          const allTeams=displayData.finalStandings;
          const active=displayData.finalStandings.filter(t=>t.wins>0||t.losses>0||calcTotal(t)>0);
          const srt=[...(active.length?active:displayData.finalStandings)].sort((a,b)=>calcTotal(b)-calcTotal(a));
          const top=calcTotal(srt[0]);

          const numInp=(val,onChange,w=52)=><input type="number" min="0" value={val??""} onChange={e=>onChange(e.target.value)}
            style={{width:w,padding:"3px 5px",border:"1px solid #ddd",borderRadius:2,fontSize:12,fontWeight:700,textAlign:"center",fontFamily:ff}}/>;

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
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────
function ScheduleTab({schedule,entries,week,season}) {
  const isMobile = useIsMobile();
  const [view,setView] = useState("full");
  const [expanded,setExpanded] = useState({}); // key -> bool
  const weeks = Object.keys(schedule||{}).map(Number).sort((a,b)=>a-b);
  const teams = entries.map(e=>e.teamName).sort();

  // Build a lookup: teamName -> weekNum -> weekLog entry (with stats)
  const resultLookup = {};
  entries.forEach(e=>{
    resultLookup[e.teamName]={};
    (e.weekLog||[]).forEach(log=>{ resultLookup[e.teamName][log.week]=log; });
  });

  // For a given matchup, find the recorded game result (winner, scores)
  // Stats come from the bulk uploader's log.stats field
  function getGameResult(teamA, teamB, w) {
    const logA = resultLookup[teamA]?.[w];
    const logB = resultLookup[teamB]?.[w];
    if (!logA && !logB) return null;
    const winner = logA?.result==="win" ? teamA : logB?.result==="win" ? teamB : null;
    const loser  = logA?.result==="loss"? teamA : logB?.result==="loss"? teamB : null;
    // Scores — stored as stats.score_for / score_against if available, else derive from stats
    const statsA = logA?.stats || null;
    const statsB = logB?.stats || null;
    // score fields: may be stored as score_for/score_against on the log itself
    const scoreA = logA?.score ?? logA?.scoreFor ?? null;
    const scoreB = logB?.score ?? logB?.scoreFor ?? null;
    return {winner, loser, logA, logB, statsA, statsB, scoreA, scoreB};
  }

  function BoxScore({teamA, teamB, result}) {
    const {logA, logB, statsA, statsB, scoreA, scoreB, winner} = result;
    const wA = logA?.result==="win", wB = logB?.result==="win";
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
            <div style={{fontSize:13,fontWeight:wA?900:600,color:wA?"#fff":"#888"}}>{teamA}</div>
            {(scoreA!=null)&&<div style={{fontSize:22,fontWeight:900,color:wA?"#fff":"#888",lineHeight:1.1}}>{scoreA}</div>}
          </div>
          <div style={{padding:"10px 8px",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontSize:9,fontWeight:800,color:"#555",textTransform:"uppercase",letterSpacing:1}}>FINAL</div>
          </div>
          <div style={{flex:1,padding:"10px 14px",textAlign:"left"}}>
            <div style={{fontSize:13,fontWeight:wB?900:600,color:wB?"#fff":"#888"}}>{teamB}</div>
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
    const isCPU = away==="CPU"||away==="BYE";
    const result = !isCPU ? getGameResult(home, away, w) : null;
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
            <span style={{fontSize:13,fontWeight:played?(winHome?800:500):700,color:played?(winHome?"#111":"#999"):"#111",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{home}</span>
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
            <span style={{fontSize:13,fontWeight:played?(winAway?800:500):700,color:isCPU?"#aaa":played?(winAway?"#111":"#999"):"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{away}</span>
          </div>

          {played&&<span style={{fontSize:11,color:"#ccc",flexShrink:0}}>{isOpen?"▲":"▼"}</span>}
        </div>
        {played&&isOpen&&<BoxScore teamA={home} teamB={away} result={result}/>}
      </div>
    );
  }

  // Per-team schedule with result lookup
  function getTeamSchedule(teamName) {
    return weeks.map(w=>{
      const opp=schedule[w]?.[teamName];
      if(!opp)return null;
      const log=resultLookup[teamName]?.[w]||null;
      return{week:w,opp,log};
    }).filter(Boolean);
  }

  if(!weeks.length) return <Card style={{padding:20,textAlign:"center",color:"#888",fontSize:13}}>No schedule set up yet. Add matchups in Commissioner Mode.</Card>;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Card style={{overflow:"hidden"}}>
        <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #eee"}}>
          <button onClick={()=>setView("full")} style={{padding:"9px 16px",background:"transparent",border:"none",borderBottom:view==="full"?`3px solid ${RED}`:"3px solid transparent",color:view==="full"?"#111":"#888",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>Full Schedule</button>
          {teams.map(t=><button key={t} onClick={()=>setView(t)} style={{padding:"9px 14px",background:"transparent",border:"none",borderBottom:view===t?`3px solid ${RED}`:"3px solid transparent",color:view===t?"#111":"#888",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,whiteSpace:"nowrap"}}>{t}</button>)}
        </div>

        {view==="full"&&(
          <div>
            {weeks.map(w=>{
              const matchups=[];
              const seen=new Set();
              Object.entries(schedule[w]||{}).forEach(([team,opp])=>{
                const key=[team,opp].sort().join("||");
                if(!seen.has(key)){seen.add(key);matchups.push({home:team,away:opp});}
              });
              return(
                <div key={w}>
                  <div style={{background:"#f7f7f7",padding:"7px 14px",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #eee"}}>
                    <span style={{fontSize:10,fontWeight:800,color:RED,textTransform:"uppercase",letterSpacing:1}}>{w>12?"Post-Season":`Week ${w}`}</span>
                    {w===week&&<span style={{background:RED,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,textTransform:"uppercase",letterSpacing:0.5}}>Current</span>}
                    {w<week&&<span style={{background:"#007a00",color:"#fff",fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:10,textTransform:"uppercase",letterSpacing:0.5}}>Final</span>}
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
              <div style={{fontSize:16,fontWeight:900,color:"#111"}}>{view}</div>
              <div style={{fontSize:11,color:"#888"}}>Season {season} Schedule</div>
            </div>
            {getTeamSchedule(view).map(({week:w,opp,log})=>{
              const played=!!log;
              const won=log?.result==="win";
              const key=`team-${view}-${w}`;
              const isOpen=expanded[key];
              const oppLog=resultLookup[opp]?.[w]||null;
              // Scores for this team
              const myScore=log?.scoreFor??log?.score??null;
              const theirScore=oppLog?.scoreFor??oppLog?.score??null;
              return(
                <div key={w} style={{borderBottom:"1px solid #eee"}}>
                  <div
                    onClick={played?()=>setExpanded(p=>({...p,[key]:!p[key]})):undefined}
                    style={{display:"flex",alignItems:"center",padding:"10px 14px",gap:10,cursor:played?"pointer":"default",background:w===week?"#fff8f8":isOpen?"#fafafa":"transparent"}}
                  >
                    <div style={{width:50,flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:w===week?800:500,color:w===week?RED:"#555",textAlign:"center"}}>{w>12?"Post":w===week?<span style={{background:RED,color:"#fff",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:10}}>NOW</span>:`Wk ${w}`}</div>
                    </div>
                    <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
                      {played&&<span style={{fontSize:10,fontWeight:800,padding:"2px 6px",borderRadius:2,background:won?"#e8f5e9":"#fff0f0",color:won?"#007a00":RED,flexShrink:0}}>{won?"W":"L"}</span>}
                      <span style={{fontSize:13,fontWeight:700,color:opp==="CPU"||opp==="BYE"?"#aaa":"#111"}}>{opp==="BYE"?"BYE WEEK":opp}</span>
                    </div>
                    {played&&(myScore!=null||theirScore!=null)&&(
                      <div style={{fontSize:14,fontWeight:900,color:"#111",flexShrink:0}}>
                        <span style={{color:won?"#007a00":RED}}>{myScore??"-"}</span>
                        <span style={{color:"#ccc",margin:"0 4px"}}>–</span>
                        <span style={{color:!won?"#007a00":RED}}>{theirScore??"-"}</span>
                      </div>
                    )}
                    {played&&!myScore&&!theirScore&&<span style={{fontSize:9,fontWeight:800,color:"#007a00",textTransform:"uppercase",padding:"1px 5px",background:"#f0f8f0",borderRadius:2,flexShrink:0}}>FINAL</span>}
                    {played&&<span style={{fontSize:11,color:"#ccc",flexShrink:0}}>{isOpen?"▲":"▼"}</span>}
                  </div>
                  {played&&isOpen&&<BoxScore teamA={view} teamB={opp} result={{winner:won?view:opp,loser:won?opp:view,logA:log,logB:oppLog,statsA:log?.stats||null,statsB:oppLog?.stats||null,scoreA:myScore,scoreB:theirScore}}/>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function ProfileTab({history,setupRows,currentEntries,season,year,permanentUsers,sel,setSel,pTab,setPTab}) {
  const isMobile = useIsMobile();
  const [expandedSeasons,setExpandedSeasons] = useState({});
  // Use permanentUsers if available, otherwise fall back to setupRows
  const allUsers = (permanentUsers?.length ? permanentUsers.map(u=>({userId:u.id,userName:u.defaultName,teamName:(setupRows||[]).find(r=>r.userId===u.id)?.teamName||u.teamName||""})) : setupRows)||[];
  if (!allUsers.length) return <Card style={{padding:20}}><div style={{color:"#888",fontSize:14}}>No users found.</div></Card>;

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
      return{year:s.year,seasonNum:s.seasonNum,rank,total:calcTotal(entry),wins:entry.wins,losses:entry.losses,teamName:entry.teamName,userName,champion:s.champion===userName,confChamp,nattyWin,heisman:s.heisman===entry.teamName||s.heisman===userName,weekLog:entry.weekLog||[],gamePts:entry.gamePts||0,rankedBonusPts:entry.rankedBonusPts||0,confStandPts:entry.confStandPts||0,confChampPts:entry.confChampPts||0,bowlPts:entry.bowlPts||0,recruitingPts:entry.recruitingPts||0,prestigePts:entry.prestigePts||0,heismanPts:entry.heismanPts||0,h2h:entry.h2h||{},playoffWins:entry.playoffWins||0,playoffLosses:entry.playoffLosses||0,bowlResult:entry.bowlResult||"none",bowlOpponent:entry.bowlOpponent||"",top25Wins:entry.top25Wins||0,top25Losses:entry.top25Losses||0,top10Wins:entry.top10Wins||0,top10Losses:entry.top10Losses||0,isHistorical:s.isHistorical||false};
    }).filter(Boolean);
    const cur=currentEntries.find(e=>(userId&&e.userId===userId)||(e.userName===fallbackUserName));
    const totalWins=seasons.reduce((a,s)=>a+s.wins,0)+(cur?.wins||0);
    const totalLosses=seasons.reduce((a,s)=>a+s.losses,0)+(cur?.losses||0);
    const totalPts=seasons.reduce((a,s)=>a+s.total,0)+(cur?calcTotal(cur):0);
    const championships=seasons.filter(s=>s.champion).length;
    const confTitles=seasons.filter(s=>s.confChamp).length;
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
    const nattyWins=seasons.filter(s=>s.nattyWin).length;
    // Career bowl/playoff/ranked records (from historical + weekLog-derived)
    const careerPlayoffWins=seasons.reduce((a,s)=>a+(s.playoffWins||0),0);
    const careerPlayoffLosses=seasons.reduce((a,s)=>a+(s.playoffLosses||0),0);
    const bowlWins=seasons.reduce((a,s)=>a+(s.bowlWins!=null?s.bowlWins:(s.bowlResult==="win"?1:0)),0);
    const bowlLosses=seasons.reduce((a,s)=>a+(s.bowlLosses!=null?s.bowlLosses:(s.bowlResult==="loss"?1:0)),0);
    const bowlAppearances=bowlWins+bowlLosses;
    const careerTop25Wins=seasons.reduce((a,s)=>a+(s.top25Wins||0),0)+allWeekLogs.filter(w=>w.result==="win"&&w.ranked25&&!w.ranked10).length;
    const careerTop10Wins=seasons.reduce((a,s)=>a+(s.top10Wins||0),0)+allWeekLogs.filter(w=>w.result==="win"&&w.ranked10).length;
    // H2H - merge across all seasons + current
    const h2hMerged={};
    [...seasons.map(s=>s.h2h||{}),(cur?.h2h||{})].forEach(h2h=>{Object.entries(h2h).forEach(([opp,rec])=>{if(!h2hMerged[opp])h2hMerged[opp]={wins:0,losses:0};h2hMerged[opp].wins+=(rec.wins||0);h2hMerged[opp].losses+=(rec.losses||0);});});
    const ptBreakdown={game:seasons.reduce((a,s)=>a+(s.gamePts||0),0)+(cur?.gamePts||0),bonus:seasons.reduce((a,s)=>a+(s.rankedBonusPts||0),0)+(cur?.rankedBonusPts||0),conf:seasons.reduce((a,s)=>a+(s.confStandPts||0),0)+(cur?.confStandPts||0),cc:seasons.reduce((a,s)=>a+(s.confChampPts||0),0)+(cur?.confChampPts||0),bowl:seasons.reduce((a,s)=>a+(s.bowlPts||0),0)+(cur?.bowlPts||0),rec:seasons.reduce((a,s)=>a+(s.recruitingPts||0),0)+(cur?.recruitingPts||0),awards:seasons.reduce((a,s)=>a+(s.prestigePts||0)+(s.heismanPts||0),0)+((cur?.prestigePts||0)+(cur?.heismanPts||0))};
    return{seasons,cur,totalWins,totalLosses,totalPts,championships,confTitles,heismans,nattyWins,bestFinish,longestWin,longestLoss,curStreak,curStreakType,rankedWins,top10Wins,winPct,h2hMerged,ptBreakdown,careerPlayoffWins,careerPlayoffLosses,bowlWins,bowlLosses,bowlAppearances,careerTop25Wins,careerTop10Wins};
  }

  function getLR() {
    const recs={};
    // Use current display name as key for league records display
    allUsers.forEach(u=>{try{const curEntry=currentEntries.find(e=>u.userId?e.userId===u.userId:e.userName===u.userName);const displayName=curEntry?.userName||u.userName;recs[displayName]=getProfile(u.userId||null,u.userName);}catch{}});
    const e=Object.entries(recs).filter(([,p])=>p);
    if(!e.length)return{};
    return{
      mostWins:[...e].sort((a,b)=>b[1].totalWins-a[1].totalWins)[0],
      mostPts:[...e].sort((a,b)=>b[1].totalPts-a[1].totalPts)[0],
      mostChamps:[...e].sort((a,b)=>b[1].championships-a[1].championships)[0],
      bestWinPct:[...e].filter(([,p])=>p.totalWins+p.totalLosses>0).sort((a,b)=>parseFloat(b[1].winPct)-parseFloat(a[1].winPct))[0],
      longestWS:[...e].sort((a,b)=>b[1].longestWin-a[1].longestWin)[0],
      mostRW:[...e].sort((a,b)=>b[1].rankedWins-a[1].rankedWins)[0],
    };
  }

  const lr=getLR();
  const user=sel?allUsers.find(u=>(u.userId||u.userName)===sel):null;
  const profile=user?getProfile(user.userId||null,user.userName):null;
  const SB=({label,val,color="#111",sub})=><div style={{background:"#f7f7f7",borderRadius:2,padding:"12px 8px",textAlign:"center",border:"1px solid #eee"}}><div style={{fontSize:19,fontWeight:900,color}}>{val}</div>{sub&&<div style={{fontSize:10,color:"#999"}}>{sub}</div>}<div style={{fontSize:9,color:"#aaa",textTransform:"uppercase",letterSpacing:1,marginTop:3,fontWeight:700}}>{label}</div></div>;
  const RR=({label,holder,val})=><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}><span style={{fontSize:12,color:"#555"}}>{label}</span><div style={{textAlign:"right"}}><div style={{fontSize:13,color:"#111",fontWeight:700}}>{holder}</div><div style={{fontSize:11,color:RED,fontWeight:700}}>{val}</div></div></div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {Object.keys(lr).length>0&&<Card><CardHead>🏆 League Records</CardHead><div style={{padding:"4px 14px 10px",display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?"0":"0 24px"}}>{lr.mostWins&&<RR label="Most Wins" holder={lr.mostWins[0]} val={lr.mostWins[1].totalWins+"W"}/>}{lr.mostPts&&<RR label="Most Pts" holder={lr.mostPts[0]} val={String(lr.mostPts[1].totalPts)}/>}{lr.mostChamps&&<RR label="Most Titles" holder={lr.mostChamps[0]} val={lr.mostChamps[1].championships+"×"}/>}{lr.bestWinPct&&<RR label="Best Win%" holder={lr.bestWinPct[0]} val={lr.bestWinPct[1].winPct+"%"}/>}{lr.longestWS&&<RR label="Win Streak" holder={lr.longestWS[0]} val={lr.longestWS[1].longestWin+"G"}/>}{lr.mostRW&&<RR label="Ranked Wins" holder={lr.mostRW[0]} val={lr.mostRW[1].rankedWins+"W"}/>}</div></Card>}
      <SL>Select User</SL>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
        {allUsers.map(u=>{const key=u.userId||u.userName;const curEntry=currentEntries.find(e=>u.userId?e.userId===u.userId:e.userName===u.userName);return(<button key={key} onClick={()=>{setSel(sel===key?null:key);setPTab("overview");}} style={{padding:"10px 14px",borderRadius:2,border:"1px solid",borderColor:sel===key?RED:"#ddd",background:sel===key?RED:"#fff",color:sel===key?"#fff":"#333",cursor:"pointer",fontFamily:ff,textAlign:"left"}}><div style={{fontWeight:800,fontSize:13}}>{curEntry?.userName||u.userName}</div><div style={{fontSize:10,color:sel===key?"rgba(255,255,255,0.7)":"#999",marginTop:2,textTransform:"uppercase"}}>{curEntry?.teamName||u.teamName}</div></button>);})}
      </div>
      {profile&&user&&<Card style={{borderTop:`3px solid ${RED}`,overflow:"hidden"}}>
        <div style={{background:"#f7f7f7",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          {(()=>{const curEntry=currentEntries.find(e=>user.userId?e.userId===user.userId:e.userName===user.userName);const displayName=curEntry?.userName||user.userName;const displayTeam=curEntry?.teamName||user.teamName;return(
          <div><div style={{fontSize:22,fontWeight:900,color:"#111"}}>{displayName.toUpperCase()}</div><div style={{fontSize:12,color:"#888",marginTop:2}}>{displayTeam} · {profile.totalWins}W-{profile.totalLosses}L · {profile.winPct}%</div><div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{profile.championships>0&&<div style={{background:RED,borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏆 DYNASTY CHAMP {profile.championships}×</div>}{profile.nattyWins>0&&<div style={{background:"#b8860b",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🎖️ NATTY {profile.nattyWins}×</div>}{profile.confTitles>0&&<div style={{background:"#1a3a6b",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏅 CONF {profile.confTitles}×</div>}{profile.heismans>0&&<div style={{background:"#5a2d82",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>⭐ HEISMAN {profile.heismans}×</div>}{profile.curStreak>1&&<div style={{background:profile.curStreakType==="win"?"#e8f5e8":"#fff0f0",border:`1px solid ${profile.curStreakType==="win"?"#007a00":RED}`,borderRadius:2,padding:"2px 8px",fontSize:10,color:profile.curStreakType==="win"?"#007a00":RED,fontWeight:700}}>{profile.curStreakType==="win"?"🔥":"❄️"} {profile.curStreak} STREAK</div>}</div></div>
          );})()}
        </div>
        <div style={{display:"flex",borderBottom:"1px solid #eee",background:"#fff",overflowX:"auto"}}>
          {["overview","seasons","h2h","streaks","points"].map(t=><button key={t} onClick={()=>setPTab(t)} style={{padding:isMobile?"10px 10px":"10px 14px",background:"transparent",border:"none",borderBottom:pTab===t?`3px solid ${RED}`:"3px solid transparent",color:pTab===t?"#111":"#888",cursor:"pointer",fontSize:isMobile?10:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{isMobile?(t==="overview"?"OVR":t==="seasons"?"SEASONS":t==="h2h"?"H2H":t==="streaks"?"STREAKS":"PTS"):(t==="h2h"?"H2H Records":t)}</button>)}
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
          </div>}

          {pTab==="h2h"&&<div>
            <SL>Head-to-Head Records</SL>
            {Object.keys(profile.h2hMerged).length===0?<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>No head-to-head data yet. Records are tracked when opponent names match dynasty users.</div>:
            isMobile?(
              <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                {Object.entries(profile.h2hMerged).sort((a,b)=>(b[1].wins+b[1].losses)-(a[1].wins+a[1].losses)).map(([opp,rec])=>{const winning=rec.wins>rec.losses;return(<div key={opp} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:2,border:"1px solid #eee",background:winning?"#f0f8f0":rec.wins<rec.losses?"#fff8f8":"transparent"}}><span style={{fontSize:13,fontWeight:600,color:"#111",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{opp}</span><span style={{fontSize:12,fontWeight:700,color:"#555",margin:"0 10px",flexShrink:0}}>{rec.wins}W-{rec.losses}L</span><span style={{background:winning?RED:"#007a00",color:"#fff",borderRadius:2,padding:"2px 8px",fontSize:10,fontWeight:700,flexShrink:0}}>{winning?"LEADS":"TRAILS"}{rec.wins===rec.losses?" (TIED)":""}</span></div>);})}
              </div>
            ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Opponent","W","L","W%","Result"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Opponent"?"left":"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800}}>{h}</th>)}</tr></thead>
              <tbody>{Object.entries(profile.h2hMerged).sort((a,b)=>(b[1].wins+b[1].losses)-(a[1].wins+a[1].losses)).map(([opp,rec])=>{const total=rec.wins+rec.losses;const wpct=total>0?((rec.wins/total)*100).toFixed(0):0;const winning=rec.wins>rec.losses;return(<tr key={opp} style={{borderBottom:"1px solid #eee",background:winning?"#f0f8f0":rec.wins<rec.losses?"#fff8f8":"transparent"}}><td style={{padding:"9px 10px",fontWeight:600,color:"#111"}}>{opp}</td><td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:"#007a00"}}>{rec.wins}</td><td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:RED}}>{rec.losses}</td><td style={{padding:"9px 10px",textAlign:"center",color:"#555"}}>{wpct}%</td><td style={{padding:"9px 10px",textAlign:"center"}}><span style={{background:winning?RED:"#007a00",color:"#fff",borderRadius:2,padding:"2px 8px",fontSize:10,fontWeight:700}}>{winning?"LEADS":"TRAILS"}{rec.wins===rec.losses?" (TIED)":""}</span></td></tr>);})}</tbody>
            </table>)}
          </div>}

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
                          <thead><tr style={{borderBottom:"1px solid #e0e0e0"}}>{["Week","Result","Opponent Rank","Pts"].map(h=><th key={h} style={{padding:"6px 12px",textAlign:"center",color:"#aaa",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>{h}</th>)}</tr></thead>
                          <tbody>{s.weekLog.map((w,i)=>(
                            <tr key={i} style={{borderBottom:"1px solid #f0f0f0",background:w.result==="win"?"#f0f8f0":"#fff8f8"}}>
                              <td style={{padding:"7px 12px",textAlign:"center",color:"#888"}}>Wk {w.week}</td>
                              <td style={{padding:"7px 12px",textAlign:"center",fontWeight:800,color:w.result==="win"?"#007a00":RED,textTransform:"uppercase"}}>{w.result}</td>
                              <td style={{padding:"7px 12px",textAlign:"center",color:w.ranked10?RED:w.ranked25?"#cc7700":"#ccc"}}>{w.ranked10?"Top 10":w.ranked25?"Top 25":"Unranked"}</td>
                              <td style={{padding:"7px 12px",textAlign:"center",color:RED,fontWeight:700}}>+{w.pts}</td>
                            </tr>
                          ))}</tbody>
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

          {pTab==="streaks"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div><SL>Streak Records</SL><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8}}><SB label="Longest Win Streak" val={profile.longestWin+"W"} color="#007a00"/><SB label="Longest Loss Streak" val={profile.longestLoss+"L"} color={RED}/><SB label="Current Streak" val={profile.curStreak>0?`${profile.curStreak}${profile.curStreakType==="win"?"W":"L"}`:"—"} color={profile.curStreakType==="win"?"#007a00":RED}/><SB label="Ranked Wins" val={profile.rankedWins} color="#cc7700"/></div></div>
            {profile.cur?.weekLog?.length>0&&<div><SL>Current Season Game Log</SL><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Week","Result","Opp Rank","Pts"].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>{h}</th>)}</tr></thead><tbody>{profile.cur.weekLog.map((w,i)=><tr key={i} style={{borderBottom:"1px solid #eee",background:w.result==="win"?"#f0f8f0":"#fff8f8"}}><td style={{padding:"7px 8px",textAlign:"center",color:"#888"}}>Wk {w.week}</td><td style={{padding:"7px 8px",textAlign:"center",fontWeight:800,color:w.result==="win"?"#007a00":RED,textTransform:"uppercase"}}>{w.result}</td><td style={{padding:"7px 8px",textAlign:"center",color:w.ranked10?RED:w.ranked25?"#cc7700":"#ccc"}}>{w.ranked10?"Top 10":w.ranked25?"Top 25":"Unranked"}</td><td style={{padding:"7px 8px",textAlign:"center",color:RED,fontWeight:700}}>+{w.pts}</td></tr>)}</tbody></table></div>}
          </div>}

          {pTab==="points"&&<div style={{display:"flex",flexDirection:"column",gap:14}}><SL>All-Time Points Breakdown</SL>{[["Game Wins",profile.ptBreakdown.game,"#007a00"],["Ranked Bonuses",profile.ptBreakdown.bonus,"#cc7700"],["Conf Standings",profile.ptBreakdown.conf,"#111"],["Conf Championship",profile.ptBreakdown.cc,"#111"],["Bowl & Playoff",profile.ptBreakdown.bowl,"#0066cc"],["Recruiting",profile.ptBreakdown.rec,"#111"],["Awards",profile.ptBreakdown.awards,"#cc7700"]].map(([label,val,color])=>{const pct=profile.totalPts>0?Math.round((val/profile.totalPts)*100):0;return(<div key={label} style={{padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:"#333"}}>{label}</span><span style={{fontSize:13,fontWeight:800,color}}>{val} <span style={{fontSize:11,color:"#aaa",fontWeight:400}}>({pct}%)</span></span></div><div style={{background:"#eee",borderRadius:2,height:6,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2}}/></div></div>);})}
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0"}}><span style={{fontSize:14,fontWeight:800}}>TOTAL</span><span style={{fontSize:16,fontWeight:900,color:RED}}>{profile.totalPts}</span></div></div>}
        </div>
      </Card>}
    </div>
  );
}

// ── SetupPanel ────────────────────────────────────────────────────────────
function SetupPanel({entries,setup,postSeasonInputs,setPSI,handleStart,setCommissionerUnlocked,season,year,setEntries,setWeekResults,setSetup,saveToDb,history,setHistory}) {
  const [setupRows,setSetupRows] = useState(setup?.rows?.length?setup.rows.map(r=>({userId:r.userId||"",userName:r.userName,teamName:r.teamName,aliases:r.aliases||""})):Array.from({length:4},()=>({userId:"",userName:"",teamName:"",aliases:""})));
  useEffect(()=>{if(setup?.rows?.length)setSetupRows(setup.rows.map(r=>({userId:r.userId||"",userName:r.userName,teamName:r.teamName,aliases:r.aliases||""})));},[setup?.rows]);
  const [setupLeague,setSetupLeague] = useState(setup?.leagueName||"");
  const [rosterSeason,setRosterSeason] = useState(season+1);
  const [rosterEdits,setRosterEdits] = useState({});
  const [rosterSaved,setRosterSaved] = useState(false);
  const setSR=(i,f,v)=>setSetupRows(p=>p.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const addRow=()=>setSetupRows(p=>[...p,{userId:"",userName:"",teamName:""}]);
  const removeRow=(i)=>{if(setupRows.length<=2)return alert("Minimum 2 teams.");setSetupRows(p=>p.filter((_,idx)=>idx!==i));};
  function applySetup(){const valid=setupRows.filter(r=>r.userName.trim()&&r.teamName.trim());if(valid.length<2)return alert("Enter at least 2 users.");if(entries.length>0&&!window.confirm("This resets all standings. Continue?"))return;handleStart(setupLeague||"Dynasty League",valid);setCommissionerUnlocked(false);}
  function addMidSeason(){const last=setupRows[setupRows.length-1];if(!last?.userName?.trim()||!last?.teamName?.trim())return alert("Fill in the last row first.");if(entries.find(e=>e.teamName===last.teamName))return alert("That team is already in the dynasty.");const uid=last.userId||genId();const newE=INITIAL_ENTRY(last.userName.trim(),last.teamName.trim(),uid);setEntries(prev=>[...prev,newE]);setWeekResults(prev=>[...prev,{teamName:newE.teamName,userName:newE.userName,result:"none",ranked25:false,ranked10:false}]);if(postSeasonInputs)setPSI(prev=>({...prev,confStandings:[...prev.confStandings,{teamName:newE.teamName,rank:prev.confStandings.length+1}],bowls:[...prev.bowls,{teamName:newE.teamName,bowl:"none"}],recruiting:[...prev.recruiting,{teamName:newE.teamName,rank:prev.recruiting.length+1}]}));const newRow={userId:uid,userName:newE.userName,teamName:newE.teamName};const pUser={id:uid,defaultName:newE.userName};setSetup(prev=>{const updated={...prev,rows:[...(prev?.rows||[]),newRow],permanentUsers:[...(prev?.permanentUsers||[]),pUser]};setTimeout(()=>saveToDb({setup:updated}),100);return updated;});alert(`${newE.userName} (${newE.teamName}) added!`);}
  const [permSaved,setPermSaved] = useState(false);
  function savePermNames(){
    const valid=setupRows.filter(r=>r.userName.trim());
    if(valid.length<2)return alert("Need at least 2 users.");
    // Map userId→canonicalName for ALL permanent users (not just changed ones)
    // Also map any aliases or old defaultNames → canonical name for history entries without userId
    const userIdToName={}, oldNameMap={};
    valid.forEach(sr=>{
      const pu=(setup?.permanentUsers||[]).find(p=>p.id===sr.userId);
      const newName=sr.userName.trim();
      if(!newName||!sr.userId)return;
      userIdToName[sr.userId]=newName;
      if(pu&&newName!==pu.defaultName) oldNameMap[pu.defaultName]=newName;
      // Parse aliases field (comma-separated old names)
      (sr.aliases||"").split(",").map(a=>a.trim()).filter(Boolean).forEach(alias=>{oldNameMap[alias]=newName;});
    });
    const updatedRows=(setup?.rows||[]).map(r=>{const sr=valid.find(s=>s.userId===r.userId);const n=userIdToName[r.userId];const base={...r};if(n)base.userName=n;if(sr?.aliases!==undefined)base.aliases=sr.aliases;return base;});
    const updatedPerm=(setup?.permanentUsers||[]).map(p=>{const n=userIdToName[p.id];return n?{...p,defaultName:n}:p;});
    const updated={...setup,rows:updatedRows,permanentUsers:updatedPerm};
    setSetup(updated);
    // Normalize live entries: fix any entry whose userId is known but userName doesn't match canonical name
    const updatedEntries=entries.map(e=>{
      const n=userIdToName[e.userId]||oldNameMap[e.userName];
      return n&&n!==e.userName?{...e,userName:n}:e;
    });
    setEntries(updatedEntries);
    // Normalize all historical seasons: fix by userId (catches mismatches) then fall back to old name
    if(history?.length){
      const updatedHistory=history.map(s=>({...s,finalStandings:s.finalStandings.map(t=>{
        const n=userIdToName[t.userId]||oldNameMap[t.userName];
        return n&&n!==t.userName?{...t,userName:n}:t;
      }),
      // Also rename season-level champion/heisman fields (stored as userName strings)
      champion: (()=>{const n=userIdToName[Object.keys(userIdToName).find(id=>(setup?.permanentUsers||[]).find(p=>p.id===id)?.defaultName===s.champion)]||oldNameMap[s.champion];return n||s.champion;})(),
      heisman: oldNameMap[s.heisman]||s.heisman,
    }));
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
  const existingRoster = setup?.seasonRosters?.[rosterSeason]||[];
  function getRosterEntry(userId) {
    const existing = existingRoster.find(r=>r.userId===userId);
    if(rosterEdits[userId]!==undefined) return rosterEdits[userId];
    if(existing) return existing;
    const cur = (setup?.rows||[]).find(r=>r.userId===userId);
    return {userId, userName:cur?.userName||"", teamName:cur?.teamName||""};
  }
  function setRosterField(userId,field,val){
    const cur = getRosterEntry(userId);
    setRosterEdits(p=>({...p,[userId]:{...cur,[field]:val}}));
    setRosterSaved(false);
  }
  function saveSeasonRoster(){
    const roster = permanentUsers.map(u=>({userId:u.id,userName:u.defaultName,teamName:getRosterEntry(u.id).teamName||""})).filter(r=>r.teamName);
    const rosterYear = START_YEAR + rosterSeason - 1;
    const updated = {
      ...setup,
      seasonRosters:{...(setup?.seasonRosters||{}), [rosterSeason]:roster},
      yearRosters:{...(setup?.yearRosters||{}), [rosterYear]:roster},
    };
    setSetup(updated);
    // If saving for the current year, also update live entries with new team names (username stays permanent)
    if(rosterYear===year && entries.length>0){
      const updatedEntries = entries.map(e=>{
        const override = roster.find(r=>r.userId===e.userId);
        if(!override)return e;
        return {...e, teamName:override.teamName||e.teamName};
      });
      setEntries(updatedEntries);
      setSetup(updated);
      saveToDb({setup:updated, entries:updatedEntries});
    } else {
      saveToDb({setup:updated});
    }
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
            <select value={rosterSeason} onChange={e=>{setRosterSeason(Number(e.target.value));setRosterEdits({});}} style={{padding:"6px 10px",border:"1px solid #ccc",borderRadius:2,fontFamily:ff,fontSize:13,color:"#111",background:"#fff"}}>
              {(()=>{const FIRST_YEAR=2020;const startS=FIRST_YEAR-START_YEAR+1;const endS=season+5;const arr=[];for(let s=startS;s<=endS;s++)arr.push(s);return arr;})().map(s=>{const dispYear=START_YEAR+s-1;const curYear=year||START_YEAR+season-1;return(<option key={s} value={s}>{dispYear}{dispYear===curYear?" (current)":dispYear===curYear+1?" (next)":""}</option>);})}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:"1px solid #eee",borderRadius:2,overflow:"hidden"}}>
            <div style={{padding:"6px 10px",background:"#f5f5f5",fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase",borderBottom:"1px solid #eee"}}>Player</div>
            <div style={{padding:"6px 10px",background:"#f5f5f5",fontSize:10,color:"#888",fontWeight:700,textTransform:"uppercase",borderBottom:"1px solid #eee",borderLeft:"1px solid #eee"}}>Team</div>
            {permanentUsers.map((u,i)=>{const entry=getRosterEntry(u.id);const isEdited=rosterEdits[u.id]!==undefined;return(<>
              <div key={u.id+"n"} style={{padding:"8px 10px",borderBottom:i<permanentUsers.length-1?"1px solid #f0f0f0":"none",fontSize:12,color:"#555",fontWeight:600,display:"flex",alignItems:"center",background:isEdited?"#fffbf0":"#fff"}}>{u.defaultName}</div>
              <input key={u.id+"tn"} value={entry.teamName||""} onChange={e=>setRosterField(u.id,"teamName",e.target.value)} placeholder="e.g. Troy" style={{padding:"8px 10px",border:"none",borderLeft:"1px solid #eee",borderBottom:i<permanentUsers.length-1?"1px solid #f0f0f0":"none",fontFamily:ff,fontSize:13,color:"#111",outline:"none",background:isEdited?"#fffbf0":"#fff"}}/>
            </>);})}
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
                    <input type="number" value={row.homeScore} onChange={e=>updateRow(row.id,"homeScore",parseInt(e.target.value)||0)} style={{width:42,border:"1px solid #ddd",borderRadius:2,padding:"4px",fontSize:14,fontWeight:900,textAlign:"center",color:hWon?"#007a00":RED,background:"transparent"}}/>
                    <span style={{color:"#bbb",fontWeight:700}}>—</span>
                    <input type="number" value={row.awayScore} onChange={e=>updateRow(row.id,"awayScore",parseInt(e.target.value)||0)} style={{width:42,border:"1px solid #ddd",borderRadius:2,padding:"4px",fontSize:14,fontWeight:900,textAlign:"center",color:!hWon?"#007a00":RED,background:"transparent"}}/>
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
                        <input type="number" value={row.homeScore} onChange={e=>updateRow(row.id,"homeScore",parseInt(e.target.value)||0)} style={{width:44,border:"1px solid #ddd",borderRadius:2,padding:"3px 5px",fontFamily:ff,fontSize:14,fontWeight:900,textAlign:"center",color:hWon?"#007a00":RED,background:"transparent"}}/>
                      </td>
                      <td style={{padding:"4px",textAlign:"center",color:"#bbb",fontWeight:700,borderRight:"1px solid #eee"}}>—</td>
                      <td style={{padding:"7px 6px",borderRight:"1px solid #eee"}}>
                        <input type="number" value={row.awayScore} onChange={e=>updateRow(row.id,"awayScore",parseInt(e.target.value)||0)} style={{width:44,border:"1px solid #ddd",borderRadius:2,padding:"3px 5px",fontFamily:ff,fontSize:14,fontWeight:900,textAlign:"center",color:!hWon?"#007a00":RED,background:"transparent"}}/>
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
    <input type="number" min="0" max="999" value={val} onChange={e=>onChange(e.target.value)}
      style={{width:w,padding:"5px 8px",border:"1px solid #ccc",borderRadius:2,fontSize:14,fontWeight:700,textAlign:"center",fontFamily:"'Helvetica Neue',Arial,sans-serif",...extra}}/>
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
function EnterResultsPanel({entries,weekResults,setWeekResults,week,setWeek,applyBulkResults,applyWeekResults,postSeasonInputs,setPSI,applyPostSeason,finalizeSeason,season,setSeason,year,setYear,teamNames,schedule,history,onImportHistory,setupRows,saveToDb}) {
  const [entryWeek,setEntryWeek] = useState(week);
  const [resultsTab,setResultsTab] = useState("weekly");
  const setWR=(i,f,v)=>setWeekResults(prev=>prev.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const thisWeekSchedule = schedule?.[entryWeek]||{};

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

      {/* Week / Season / Year selector */}
      <Card>
        <CardHead>Entry Context</CardHead>
        <div style={{padding:"14px 16px",display:"flex",flexWrap:"wrap",gap:20,alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Season</div>
            <select value={season} onChange={e=>{const s=Number(e.target.value);setSeason(s);setEntryWeek(week);if(saveToDb)saveToDb({season:s});}} style={{fontSize:16,fontWeight:700,color:"#111",padding:"8px 12px",background:"#fff",border:`2px solid #cc0000`,borderRadius:2,cursor:"pointer",fontFamily:"'Helvetica Neue',Arial,sans-serif",minWidth:60}}>
              {Array.from({length:20},(_,i)=>i+1).map(s=><option key={s} value={s}>S{s}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Year</div>
            <select value={year} onChange={e=>{const y=Number(e.target.value);setYear(y);if(saveToDb)saveToDb({year:y});}} style={{fontSize:16,fontWeight:700,color:"#111",padding:"8px 12px",background:"#fff",border:`2px solid #cc0000`,borderRadius:2,cursor:"pointer",fontFamily:"'Helvetica Neue',Arial,sans-serif",minWidth:80}}>
              {Array.from({length:20},(_,i)=>2020+i).map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Week</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <select value={entryWeek} onChange={e=>{const w=Number(e.target.value);setEntryWeek(w);}} style={{fontSize:16,fontWeight:700,color:"#111",padding:"8px 12px",background:"#fff",border:`2px solid #cc0000`,borderRadius:2,cursor:"pointer",fontFamily:"'Helvetica Neue',Arial,sans-serif",minWidth:80}}>
                {Array.from({length:16},(_,i)=>i+1).map(w=><option key={w} value={w}>Week {w}{w===week?" (current)":""}</option>)}
              </select>
              {entryWeek!==week&&<button onClick={()=>{setWeek(entryWeek);saveToDb({week:entryWeek});}} style={{padding:"8px 10px",background:"#1a3a6b",color:"#fff",border:"none",borderRadius:2,cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:ff,whiteSpace:"nowrap"}}>Set Current</button>}
            </div>
          </div>
          {entryWeek!==week&&<div style={{padding:"6px 12px",background:"#fffbf0",border:"1px solid #f0c040",borderRadius:2,fontSize:12,color:"#886600",fontWeight:600}}>⚠ Entering results for a past week — global week will not advance</div>}
        </div>
      </Card>

      <BulkResultsUploader entries={entries} week={entryWeek} teamNames={teamNames} onConfirm={(results)=>applyBulkResults(results,entryWeek)}/>
      {entryWeek<=12&&<Card><div style={{padding:16}}>
        <SL>Manual Entry — Week {entryWeek}{entryWeek!==week?` (S${season} · ${year})`:""}</SL>
        {Object.keys(thisWeekSchedule).length>0&&<div style={{background:"#f0f8f0",border:"1px solid #cce5cc",borderRadius:2,padding:"8px 12px",fontSize:12,color:"#555",marginBottom:12}}>✓ Schedule loaded — entering one team's result automatically updates their opponent's record.</div>}
        {weekResults.map((wr,i)=>(
          <div key={wr.teamName} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"9px 0",borderBottom:"1px solid #f0f0f0"}}>
            <div style={{width:130}}><div style={{fontSize:13,color:"#111",fontWeight:700}}>{wr.userName}</div><div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:0.5}}>{wr.teamName}</div></div>
            <div style={{display:"flex",gap:6}}>{["win","loss","none"].map(opt=><button key={opt} onClick={()=>setWR(i,"result",opt)} style={{padding:"5px 10px",borderRadius:2,border:"1px solid",borderColor:wr.result===opt?(opt==="win"?"#007a00":opt==="loss"?RED:"#cc7700"):"#ddd",background:wr.result===opt?(opt==="win"?"#f0f8f0":opt==="loss"?"#fff8f8":"#fffbf0"):"#fff",color:wr.result===opt?(opt==="win"?"#007a00":opt==="loss"?RED:"#cc7700"):"#888",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:800,textTransform:"uppercase"}}>{opt==="none"?"BYE":opt}</button>)}</div>
            {wr.result==="win"&&<div style={{display:"flex",gap:10}}><label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}><input type="checkbox" checked={wr.ranked25} onChange={e=>setWR(i,"ranked25",e.target.checked)}/> vs Top 25</label><label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:RED,cursor:"pointer",fontWeight:700}}><input type="checkbox" checked={wr.ranked10} onChange={e=>setWR(i,"ranked10",e.target.checked)}/> vs Top 10</label></div>}
          </div>
        ))}
        <button onClick={()=>applyWeekResults(entryWeek)} style={{marginTop:14,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:"pointer",fontFamily:ff,fontSize:14,fontWeight:800,textTransform:"uppercase"}}>Submit Week {entryWeek} →</button>
      </div></Card>}
      {week>12&&postSeasonInputs&&(()=>{
        const psi=postSeasonInputs;
        const ff2="'Helvetica Neue',Arial,sans-serif";
        const addGame=(field)=>setPSI(prev=>({...prev,[field]:[...(prev[field]||[]),{id:Date.now(),teamA:"",teamB:"",winner:""}]}));
        const removeGame=(field,id)=>setPSI(prev=>({...prev,[field]:(prev[field]||[]).filter(g=>g.id!==id)}));
        const setGame=(field,id,key,val)=>setPSI(prev=>({...prev,[field]:(prev[field]||[]).map(g=>g.id===id?{...g,[key]:val}:g)}));
        const setTopGame=(field,key,val)=>setPSI(prev=>({...prev,[field]:{...prev[field],[key]:val}}));
        const TeamSel=({value,onChange,exclude})=><select value={value} onChange={e=>onChange(e.target.value)} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12,maxWidth:140}}><option value="">-- Team --</option>{teamNames.filter(t=>t!==exclude).map(t=><option key={t} value={t}>{t}</option>)}</select>;
        const WinBtns=({teamA,teamB,winner,onWin})=><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{[teamA,teamB].filter(Boolean).map(t=><button key={t} onClick={()=>onWin(winner===t?"":t)} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:winner===t?"#007a00":"#ddd",background:winner===t?"#f0f8f0":"#fff",color:winner===t?"#007a00":"#888",cursor:"pointer",fontSize:11,fontFamily:ff2,fontWeight:700}}>{winner===t?"✓ ":""}{t}</button>)}</div>;
        const GameRow=({game,field,onRemove})=><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"8px 0",borderBottom:"1px solid #f5f5f5"}}><TeamSel value={game.teamA} onChange={v=>setGame(field,game.id,"teamA",v)} exclude={game.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={game.teamB} onChange={v=>setGame(field,game.id,"teamB",v)} exclude={game.teamA}/>{(game.teamA||game.teamB)&&<><span style={{fontSize:11,color:"#555",marginLeft:4}}>Winner:</span><WinBtns teamA={game.teamA} teamB={game.teamB} winner={game.winner} onWin={v=>setGame(field,game.id,"winner",v)}/></>}{onRemove&&<button onClick={onRemove} style={{marginLeft:"auto",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>}</div>;
        const SectionLabel=({children,pts})=><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:12,color:"#555",fontWeight:700}}>{children}</div><div style={{fontSize:11,color:"#007a00",fontWeight:700}}>{pts}</div></div>;
        return(<>
          <Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
            <SL>Post Season — {year}</SL>
            {/* Conf Standings */}
            <div style={{marginBottom:18}}><SectionLabel pts="Appear +10 · Win +15">Conference Championship Game</SectionLabel>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}><TeamSel value={psi.confChampGame?.teamA||""} onChange={v=>setTopGame("confChampGame","teamA",v)} exclude={psi.confChampGame?.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={psi.confChampGame?.teamB||""} onChange={v=>setTopGame("confChampGame","teamB",v)} exclude={psi.confChampGame?.teamA}/></div>
              {(psi.confChampGame?.teamA||psi.confChampGame?.teamB)&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#555"}}>Winner:</span><WinBtns teamA={psi.confChampGame?.teamA} teamB={psi.confChampGame?.teamB} winner={psi.confChampGame?.winner||""} onWin={v=>setTopGame("confChampGame","winner",v)}/></div>}
            </div>
            {/* Bowl Games */}
            <div style={{marginBottom:18}}><SectionLabel pts="Appear +5 · Win +10">Bowl Games</SectionLabel>
              {(psi.bowlGames||[]).map(g=><GameRow key={g.id} game={g} field="bowlGames" onRemove={()=>removeGame("bowlGames",g.id)}/>)}
              <button onClick={()=>addGame("bowlGames")} style={{marginTop:6,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add Bowl Game</button>
            </div>
            {/* Playoff R1 */}
            <div style={{marginBottom:18}}><SectionLabel pts="Appear +15 · Win +10">Playoff Round 1</SectionLabel>
              {(psi.playoffR1||[]).map(g=><GameRow key={g.id} game={g} field="playoffR1" onRemove={()=>removeGame("playoffR1",g.id)}/>)}
              <button onClick={()=>addGame("playoffR1")} style={{marginTop:6,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add R1 Game</button>
            </div>
            {/* Playoff R2 */}
            <div style={{marginBottom:18}}><SectionLabel pts="Win +15">Playoff Round 2 (Semifinals)</SectionLabel>
              {(psi.playoffR2||[]).map(g=><GameRow key={g.id} game={g} field="playoffR2" onRemove={()=>removeGame("playoffR2",g.id)}/>)}
              <button onClick={()=>addGame("playoffR2")} style={{marginTop:6,background:"#f5f5f5",border:"1px dashed #ccc",borderRadius:2,padding:"5px 14px",cursor:"pointer",fontSize:12,color:"#555",fontFamily:ff2}}>+ Add R2 Game</button>
            </div>
            {/* National Championship */}
            <div style={{marginBottom:18}}><SectionLabel pts="Win +25">National Championship</SectionLabel>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}><TeamSel value={psi.nattyGame?.teamA||""} onChange={v=>setTopGame("nattyGame","teamA",v)} exclude={psi.nattyGame?.teamB}/><span style={{fontSize:11,color:"#aaa",fontWeight:700}}>VS</span><TeamSel value={psi.nattyGame?.teamB||""} onChange={v=>setTopGame("nattyGame","teamB",v)} exclude={psi.nattyGame?.teamA}/></div>
              {(psi.nattyGame?.teamA||psi.nattyGame?.teamB)&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,color:"#555"}}>Winner:</span><WinBtns teamA={psi.nattyGame?.teamA} teamB={psi.nattyGame?.teamB} winner={psi.nattyGame?.winner||""} onWin={v=>setTopGame("nattyGame","winner",v)}/></div>}
            </div>
          </div></Card>
          <Card style={{borderTop:`3px solid #333`}}><div style={{padding:16}}>
            <SL>End of Season</SL>
            {/* Final Conference Standings */}
            <div style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:12,color:"#555",fontWeight:600}}>Final Conference Standings</div><button onClick={()=>{const sorted=[...entries].sort((a,b)=>{const aw=(a.confWins||0),al=(a.confLosses||0),bw=(b.confWins||0),bl=(b.confLosses||0);const apct=aw+al>0?aw/(aw+al):0,bpct=bw+bl>0?bw/(bw+bl):0;if(bpct!==apct)return bpct-apct;if(bw!==aw)return bw-aw;return(b.wins||0)-(a.wins||0);});setPSI(prev=>({...prev,confStandings:sorted.map((e,i)=>({teamName:e.teamName,rank:i+1}))}));}} style={{background:"#1a3a6b",color:"#fff",border:"none",borderRadius:2,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"'Helvetica Neue',Arial,sans-serif",fontWeight:700}}>↕ Sort by Conf Record</button></div>{psi.confStandings.map((s,i)=><div key={s.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<3?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={s.teamName} onChange={e=>{const nv=e.target.value;const si2=psi.confStandings.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.confStandings];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,confStandings:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select><span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{CONF_STAND_PTS[i]||0}</span></div>)}</div>
            {/* Recruiting */}
            <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Recruiting (Top 5)</div>{psi.recruiting.map((r,i)=><div key={r.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<5?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={r.teamName} onChange={e=>{const nv=e.target.value;const si2=psi.recruiting.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.recruiting];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,recruiting:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t}</option>)}</select>{i<5&&<span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{RECRUITING_PTS[i]||0}</span>}</div>)}</div>
            {/* Dynasty Top 5 */}
            <div style={{marginBottom:14}}><div style={{fontSize:12,color:"#555",marginBottom:8,fontWeight:600}}>Top 5 Teams in Dynasty</div>{(psi.dynastyTop5||[]).slice(0,5).map((r,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<5?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={r.teamName} onChange={e=>{const nv=e.target.value;const si2=(psi.dynastyTop5||[]).findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.dynastyTop5];[arr[i],arr[si2]]=[arr[si2],arr[i]];return{...prev,dynastyTop5:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff2,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select><span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{[15,10,7,5,3][i]}</span></div>)}</div>
            {/* Heisman */}
            <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Heisman Winner (+15)</div><select value={psi.heisman} onChange={e=>setPSI(prev=>({...prev,heisman:e.target.value}))} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"6px 10px",fontFamily:ff2,fontSize:13}}><option value="">-- None --</option>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select></div>
            {/* Prestige */}
            <div style={{marginBottom:16}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Gained Prestige Star (+10)</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{teamNames.map(t=><button key={t} onClick={()=>setPSI(prev=>({...prev,prestigeGains:prev.prestigeGains.includes(t)?prev.prestigeGains.filter(x=>x!==t):[...prev.prestigeGains,t]}))} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:psi.prestigeGains.includes(t)?"#007a00":"#ddd",background:psi.prestigeGains.includes(t)?"#f0f8f0":"#fff",color:psi.prestigeGains.includes(t)?"#007a00":"#888",cursor:"pointer",fontSize:12,fontFamily:ff2,fontWeight:600}}>{t}</button>)}</div></div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={applyPostSeason} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff2,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Apply All Post-Season Points</button>
              <button onClick={finalizeSeason} style={{background:"#fff",color:"#007a00",border:"2px solid #007a00",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff2,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Finalize & Start Season {season+1} →</button>
            </div>
          </div></Card>
        </>);
      })()}

      </>}
    </div>
  );
}

// ── Reporters ─────────────────────────────────────────────────────────────
const REPORTERS = [
  {
    name: "Marcus Webb",
    title: "Senior Dynasty Analyst",
    avatar: "MW",
    color: "#1a3a6b",
    style: "analytical and data-driven. You reference statistics, point differentials, and trends constantly. You use phrases like 'the numbers tell a story' and 'analytically speaking'. You're respected but sometimes accused of being too nerdy. You love efficiency ratings and hate sloppy play.",
    bio: "15-year dynasty veteran. Former math teacher. Believes spreadsheets tell better stories than highlights.",
  },
  {
    name: "Tanya Rivers",
    title: "Dynasty Insider",
    avatar: "TR",
    color: "#8b1a1a",
    style: "fiery, controversial and opinionated. You make bold predictions, call out underperformers by name, and are not afraid to say a team is in crisis. You use dramatic language and love a good narrative arc. You're the reporter teams love to hate.",
    bio: "Known for her hot takes. Has been blocked by 3 dynasty commissioners. Never wrong (according to her).",
  },
  {
    name: "Derek Okonkwo",
    title: "College Football Correspondent",
    avatar: "DO",
    color: "#1a6b3a",
    style: "enthusiastic, hype-driven and fan-friendly. You celebrate big wins, hype up underdogs, and always find a positive angle. You use exclamation points, ALL CAPS for emphasis, and get genuinely excited about upsets. You write like you're commentating live.",
    bio: "Brings the energy. Favorite word is 'unbelievable'. Has never written a boring article in his life.",
  },
  {
    name: "Sandra Cho",
    title: "Dynasty History & Strategy Writer",
    avatar: "SC",
    color: "#5a3a8b",
    style: "thoughtful, historical and strategic. You compare current events to dynasty history, analyze coaching decisions, and discuss long-term implications. You reference past seasons frequently and think about legacy. You write like a professor who actually loves football.",
    bio: "Obsessed with dynasty lore. Can cite stats from 3 seasons ago without checking notes. Writes the articles people save.",
  },
];

// ── Content Hub Tab ───────────────────────────────────────────────────────
function ContentHub({sorted,entries,week,season,leagueName,history,leader,articles,setArticles,setActiveArticle,schedule}) {
  const [generating,setGenerating] = useState(null);
  const [genError,setGenError] = useState(null);
  const [selectedReporter,setSelectedReporter] = useState(0);
  const [contentType,setContentType] = useState("powerrankings");

  const standingsText = sorted.map((t,i)=>{const tot=calcTotal(t);return `${i+1}. ${t.teamName} — ${t.wins}W ${t.losses}L — ${tot} pts${i===0?" [LEADER]":` (-${leader-tot})`}`;}).join("\n");

  // Build schedule context for AI
  const thisWeekMatchups = schedule[week] ? (() => {
    const seen = new Set(); const games = [];
    Object.entries(schedule[week]).forEach(([team,opp])=>{
      const key = [team,opp].sort().join("vs");
      if(!seen.has(key)){seen.add(key);games.push(opp==="BYE"?`${team}: BYE`:opp==="CPU"?`${team} vs CPU (non-conf)`:`${team} vs ${opp}`);}
    });
    return games.join("\n");
  })() : "Schedule not yet set";

  const lastWeekMatchups = schedule[week-1] ? (() => {
    const seen = new Set(); const games = [];
    Object.entries(schedule[week-1]).forEach(([team,opp])=>{
      const key = [team,opp].sort().join("vs");
      if(!seen.has(key)){seen.add(key);games.push(opp==="BYE"?`${team}: BYE`:opp==="CPU"?`${team} vs CPU`:` ${team} vs ${opp}`);}
    });
    return games.join("\n");
  })() : "Schedule not available";

  const upcomingSchedule = [week,week+1,week+2].map(w=>{
    if(!schedule[w])return null;
    const seen=new Set();const games=[];
    Object.entries(schedule[w]).forEach(([team,opp])=>{const key=[team,opp].sort().join("vs");if(!seen.has(key)){seen.add(key);games.push(opp==="BYE"?`${team}:BYE`:opp==="CPU"?`${team} vs CPU`:`${team} vs ${opp}`);}});
    return `Week ${w}: ${games.join(", ")}`;
  }).filter(Boolean).join("\n");

  const reporter = REPORTERS[selectedReporter];

  async function generate(type) {
    setGenerating(type);
    setGenError(null);
    const r = reporter;
    const byline = `You are ${r.name}, ${r.title} for Dynasty Central covering the "${leagueName}" dynasty. Your writing style is ${r.style}\n\nAlways sign your articles with your name and title at the end.\n\n`;

    const scheduleContext = upcomingSchedule ? `\n\nUPCOMING SCHEDULE:\n${upcomingSchedule}` : "";
    const prompts = {
      powerrankings: `${byline}Write weekly power rankings after Season ${season} Week ${week-1}.\n\nCurrent points standings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}${scheduleContext}\n\nRank all ${entries.length} teams 1-${entries.length} with a punchy 2-3 sentence blurb each. Reference actual matchups and upcoming schedules. Rankings can differ from points based on momentum and schedule difficulty. Be opinionated. Format as:\n1. [Team] — [blurb]\n2. etc.`,

      preview: `${byline}Write a Week ${week} game preview article for the "${leagueName}" dynasty, Season ${season}.\n\nCurrent standings:\n${standingsText}\n\nTHIS WEEK'S ACTUAL MATCHUPS:\n${thisWeekMatchups}\n\nWrite 400 words previewing the actual scheduled matchups above. Discuss storylines, what's at stake for each team, who has the edge. Reference the real games — do not make up different matchups. Write in your distinct voice.`,

      recap: `${byline}Write a dramatic weekly recap for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings after this week:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}\n\nWrite 400 words recapping last week's actual games. Make up exciting scores and game details for the real matchups listed above. Highlight upsets, dominant performances, and dynasty implications. Write in your distinct voice.`,

      seasonpreview: `${byline}Write a Season ${season} (${year}) preview for the "${leagueName}" dynasty.\n\nTeams:\n${entries.map(e=>e.teamName).join("\n")}\n${history.length>0?`\nDefending champion: ${history[history.length-1].champion}`:"This is the inaugural season."}\n${upcomingSchedule?`\nEarly schedule:\n${upcomingSchedule}`:""}\n\nWrite 450 words previewing the season. Give each team a one-line outlook, predict a champion, name dark horses and sleepers, and build excitement. Write in your distinct voice.`,

      hotakes: `${byline}Write a spicy hot takes column for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}\n\nWrite 5 bold, controversial hot takes. Reference real matchups and team names. Each take 2-3 sentences, provocative and specific. Number 1-5. Write in your distinct voice.`,
    };

    try {
      const text = cleanArticle(await callClaude(prompts[type]));
      const labels = {powerrankings:"📊 Power Rankings",preview:"🔭 Week Preview",recap:"📰 Weekly Recap",seasonpreview:"🏈 Season Preview",hotakes:"🔥 Hot Takes"};
      const label = labels[type]||"📰 Article";
      const newArticles = [{id:Date.now(),type,label,week,season,text,reporter:r.name,reporterColor:r.color,reporterAvatar:r.avatar},...articles].slice(0,30);
      setArticles(newArticles);
      dbSave({articles:newArticles});
    } catch(e) {
      setGenError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

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
          {[["powerrankings","📊 Power Rankings"],["preview","🔭 Week Preview"],["recap","📰 Weekly Recap"],["seasonpreview","🏈 Season Preview"],["hotakes","🔥 Hot Takes"]].map(([val,label])=>(
            <button key={val} onClick={()=>setContentType(val)} style={{padding:"8px 14px",borderRadius:2,border:"1px solid",borderColor:contentType===val?reporter.color:"#ddd",background:contentType===val?reporter.color:"#fff",color:contentType===val?"#fff":"#555",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:700,textTransform:"uppercase"}}>{label}</button>
          ))}
        </div>
        {genError&&<div style={{background:"#fff0f0",border:"1px solid #ffcccc",borderRadius:2,padding:"10px 14px",fontSize:12,color:RED,marginBottom:4}}><strong>Error:</strong> {genError}</div>}
        <button onClick={()=>generate(contentType)} disabled={!!generating} style={{background:generating?"#ccc":reporter.color,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:generating?"not-allowed":"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",display:"flex",alignItems:"center",gap:8}}>
          {generating?<>Generating...</>:<><span style={{background:"rgba(255,255,255,0.2)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800}}>{reporter.avatar}</span> Generate as {reporter.name.split(" ")[0]}</>}
        </button>
      </Card>

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
function RightRail({sorted,articles,entries,week,season,leader,setActiveArticle}) {
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
            <div style={{padding:"9px 12px"}}><div style={{fontSize:12,fontWeight:700,color:"#111"}}>📅 {week>12?"Post-Season":"Week "+week} · Season {season}</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{entries.length} teams</div></div>
          </div></Card>
          <Card><CardHead bg={RED}>Full Standings</CardHead><div style={{padding:"4px 0"}}>
            {sorted.length===0&&<div style={{padding:"12px",fontSize:12,color:"#888",fontStyle:"italic"}}>No standings yet.</div>}
            {sorted.map((t,i)=><div key={t.teamName} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,fontWeight:800,color:i===0?RED:"#bbb",width:18,textAlign:"right"}}>{i+1}</span><div style={{flex:1,minWidth:0}}><Name userId={t.userId} userName={t.userName} style={{fontSize:12,fontWeight:700,color:"#111",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"block"}}>{t.teamName}</Name></div><span style={{fontSize:13,fontWeight:900,color:i===0?RED:"#333",flexShrink:0}}>{calcT(t)}</span></div>)}
          </div></Card>
    </div>
  );
}


export default function App() {
  const [setup,setSetup] = useState(null);
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
  const [dbLoading,setDbLoading] = useState(true);
  const [dbError,setDbError] = useState(null);
  const [lastSaved,setLastSaved] = useState(null);

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
        if (row.week) setWeek(row.week);
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

  const inactiveTeamNames=new Set((setup?.rows||[]).filter(r=>r.active===false).map(r=>r.teamName));
  const activeEntries=inactiveTeamNames.size>0?entries.filter(e=>!inactiveTeamNames.has(e.teamName)):entries;
  const sorted=[...activeEntries].sort((a,b)=>calcTotal(b)-calcTotal(a));
  const leader=sorted[0]?calcTotal(sorted[0]):0;
  const teamNames=activeEntries.map(e=>e.teamName);
  const leagueName=setup?.leagueName||"Dynasty Central";

  function applyWeekResults(targetWeek=week) {
    const thisWeekSchedule = schedule[targetWeek] || {};
    setEntries(prev=>{
      // Build a map of results entered this week
      const resultsMap = {};
      weekResults.forEach(r=>{ if(r.result!=="none") resultsMap[r.teamName]=r; });
      return prev.map(entry=>{
        const r = resultsMap[entry.teamName];
        const opp = thisWeekSchedule[entry.teamName];
        // If this team has a scheduled opponent who entered a result, mirror it
        let effectiveResult = r?.result;
        let effectiveR25 = r?.ranked25||false;
        let effectiveR10 = r?.ranked10||false;
        if (!effectiveResult && opp && opp!=="CPU" && opp!=="BYE" && resultsMap[opp]) {
          // Mirror opponent result
          const oppResult = resultsMap[opp].result;
          effectiveResult = oppResult==="win"?"loss":oppResult==="loss"?"win":undefined;
          effectiveR25 = false; effectiveR10 = false;
        }
        if(!effectiveResult)return entry;
        let pts=0,bonus=0;
        if(effectiveResult==="win"){pts=15;bonus=effectiveR10?10:effectiveR25?5:0;}
        const log={week:targetWeek,result:effectiveResult,ranked25:effectiveR25,ranked10:effectiveR10,pts:pts+bonus,opponent:opp||"Unknown"};
        // Update H2H if opponent is a dynasty member
        const h2h={...entry.h2h||{}};
        if(opp&&opp!=="CPU"&&opp!=="BYE"){
          if(!h2h[opp])h2h[opp]={wins:0,losses:0};
          if(effectiveResult==="win")h2h[opp].wins++;
          else if(effectiveResult==="loss")h2h[opp].losses++;
        }
        const isConfGame=opp&&opp!=="CPU"&&opp!=="BYE"&&opp!=="Unknown"&&teamNames.includes(opp);
        return{...entry,wins:effectiveResult==="win"?entry.wins+1:entry.wins,losses:effectiveResult==="loss"?entry.losses+1:entry.losses,confWins:isConfGame&&effectiveResult==="win"?(entry.confWins||0)+1:(entry.confWins||0),confLosses:isConfGame&&effectiveResult==="loss"?(entry.confLosses||0)+1:(entry.confLosses||0),gamePts:entry.gamePts+pts,rankedBonusPts:entry.rankedBonusPts+bonus,weekLog:[...(entry.weekLog||[]),log],h2h};
      });
    });
    setWeekResults(prev=>prev.map(r=>({...r,result:"none",ranked25:false,ranked10:false})));
    if(targetWeek>=week){const newWeek=targetWeek+1;setWeek(newWeek);setTimeout(()=>saveToDb({week:newWeek}),100);}
    else{setTimeout(()=>saveToDb({}),100);}
  }

  function applyBulkResults(results, targetWeek=week) {
    const thisWeekSchedule=schedule[targetWeek]||{};
    setEntries(prev=>prev.map(entry=>{
      const r=results.find(x=>x.leagueTeam===entry.teamName);
      if(!r)return entry;
      let pts=0,bonus=0;
      if(r.result==="win"){pts=15;bonus=r.ranked10?10:r.ranked25?5:0;}
      const opp=thisWeekSchedule[entry.teamName]||r.opponent;
      const log={week:targetWeek,result:r.result,ranked25:r.ranked25,ranked10:r.ranked10,pts:pts+bonus,opponent:opp,stats:r.stats};
      const h2h={...entry.h2h||{}};
      if(opp&&!["CPU","BYE","Unknown"].includes(opp)){if(!h2h[opp])h2h[opp]={wins:0,losses:0};if(r.result==="win")h2h[opp].wins++;else if(r.result==="loss")h2h[opp].losses++;}
      const isConfGame=opp&&!["CPU","BYE","Unknown"].includes(opp)&&teamNames.includes(opp);
      return{...entry,wins:r.result==="win"?entry.wins+1:entry.wins,losses:r.result==="loss"?entry.losses+1:entry.losses,confWins:isConfGame&&r.result==="win"?(entry.confWins||0)+1:(entry.confWins||0),confLosses:isConfGame&&r.result==="loss"?(entry.confLosses||0)+1:(entry.confLosses||0),gamePts:entry.gamePts+pts,rankedBonusPts:entry.rankedBonusPts+bonus,weekLog:[...(entry.weekLog||[]),log],h2h};
    }));
    setWeekResults(prev=>prev.map(r=>({...r,result:"none",ranked25:false,ranked10:false})));
    if(targetWeek>=week){const newWeek=targetWeek+1;setWeek(newWeek);setTimeout(()=>saveToDb({week:newWeek}),100);}
    else{setTimeout(()=>saveToDb({}),100);}
  }

  function applyPostSeason() {
    if(!postSeasonInputs)return;
    const psi=postSeasonInputs;
    setEntries(prev=>prev.map(entry=>{
      const t=entry.teamName;
      // Conference standings
      const si=psi.confStandings.findIndex(s=>s.teamName===t);
      const sp=si>=0?(CONF_STAND_PTS[si]||0):0;
      // Conf championship game — appear +10, win +15 additional
      let cc=0;
      if(psi.confChampGame){
        if(psi.confChampGame.teamA===t||psi.confChampGame.teamB===t){cc+=10;if(psi.confChampGame.winner===t)cc+=15;}
      } else if(psi.confChamp){
        // backward compat with old format
        if(psi.confChamp.made?.includes(t))cc+=10;if(psi.confChamp.winner===t)cc+=15;
      }
      // Bowl & playoff points
      let bp=0;
      if(psi.bowlGames){
        // Bowl: appear +5, win +10 additional
        (psi.bowlGames||[]).forEach(g=>{if(g.teamA===t||g.teamB===t){bp+=5;if(g.winner===t)bp+=10;}});
        // Playoff R1: appear +15, win +10 additional
        (psi.playoffR1||[]).forEach(g=>{if(g.teamA===t||g.teamB===t){bp+=15;if(g.winner===t)bp+=10;}});
        // Playoff R2 (semis): win +15 additional (no appear bonus — already in R1)
        (psi.playoffR2||[]).forEach(g=>{if(g.winner===t)bp+=15;});
        // National Championship: win +25 additional
        if(psi.nattyGame&&psi.nattyGame.winner===t)bp+=25;
      } else if(psi.bowls){
        // backward compat with old per-team bowl format
        const be=psi.bowls.find(b=>b.teamName===t);
        if(be?.bowl==="made")bp=5;if(be?.bowl==="won")bp=15;if(be?.bowl==="cfp")bp=15;if(be?.bowl==="cfpwon")bp=40;
      }
      // Recruiting
      const ri=psi.recruiting.findIndex(r=>r.teamName===t);
      const rp=ri>=0?(RECRUITING_PTS[ri]||0):0;
      // Prestige & Heisman
      let pp=0;if(psi.prestigeGains.includes(t))pp+=10;if(psi.maxPrestige?.includes(t))pp+=10;
      // Dynasty Top 5 ranking (15/10/7/5/3)
      const DYNASTY_TOP5_PTS=[15,10,7,5,3];
      const di=(psi.dynastyTop5||[]).findIndex(r=>r.teamName===t);
      const dp=di>=0&&di<5?(DYNASTY_TOP5_PTS[di]||0):0;
      const hp=(psi.heisman===t?15:0)+dp;
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
    setHistory(prev=>{
      const next=[...prev,histEntry];
      setTimeout(()=>dbSave({history:next,season:newSeason,year,week:1,entries:fresh,post_season_inputs:FRESH_PSI(fresh)}),100);
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
      <div style={{fontSize:32,fontWeight:900,color:"#fff",fontStyle:"italic",letterSpacing:-1,marginBottom:16}}>ESPN</div>
      <div style={{fontSize:13,color:"#888",letterSpacing:2,textTransform:"uppercase"}}>Loading Dynasty...</div>
      <div style={{marginTop:20,width:200,height:3,background:"#333",borderRadius:2,overflow:"hidden"}}>
        <div style={{width:"60%",height:"100%",background:RED,borderRadius:2,animation:"none"}}/>
      </div>
    </div>
  );

  if (dbError) return (
    <div style={{minHeight:"100vh",background:"#111",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:ff,padding:20}}>
      <div style={{fontSize:32,fontWeight:900,color:"#fff",fontStyle:"italic",letterSpacing:-1,marginBottom:16}}>ESPN</div>
      <div style={{fontSize:14,color:RED,textAlign:"center",maxWidth:400}}>{dbError}</div>
      <button onClick={()=>window.location.reload()} style={{marginTop:20,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"10px 24px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Retry</button>
    </div>
  );

  return (
    <NavCtx.Provider value={goToProfile}>
    <div style={{minHeight:"100vh",background:"#f0f0f0",color:"#111",fontFamily:ff,overflowX:"hidden",maxWidth:"100%",boxSizing:"border-box"}}>
      {/* Top black bar */}
      <div style={{background:"#111",padding:"0 12px",height:44,display:"flex",alignItems:"center",gap:10,position:"sticky",top:0,zIndex:200}}>
        <div style={{fontSize:22,fontWeight:900,color:"#fff",fontStyle:"italic",letterSpacing:-1,flexShrink:0}}>ESPN</div>
        <div style={{width:1,height:20,background:"#444",flexShrink:0}}/>
        <div style={{fontSize:isMobile?10:12,color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{leagueName}</div>
        {!isMobile&&<div style={{display:"flex",gap:14,alignItems:"center",flexShrink:0}}>
          {[["S",season],["YR",year],["WK",week>12?"PS":week]].map(([l,v])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:7,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:15,fontWeight:900,color:"#fff",lineHeight:1}}>{v}</div></div>)}
        </div>}
        {isMobile&&<div style={{flexShrink:0,textAlign:"right"}}><div style={{fontSize:9,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>WK</div><div style={{fontSize:14,fontWeight:900,color:"#fff",lineHeight:1}}>{week>12?"PS":week}</div></div>}
      </div>

      {/* Nav tabs */}
      <div style={{background:RED,display:"flex",alignItems:"center",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {(isMobile?[["Home","Home"],["Stndgs","Standings"],["Sched","Schedule"],["History","History"],["Profiles","Profiles"],["Rules","Rules"]]:[["Home","Home"],["Standings","Standings"],["Schedule","Schedule"],["History","History"],["Profiles","Profiles"],["Rules","Rules"]]).map(([label,val])=>(
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
          <Card><CardHead>Dynasty Info</CardHead><div style={{padding:"8px 0"}}>{[["Season",season],["Year",year],["Week",week>12?"Post":week],["Teams",entries.length]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,color:"#888"}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:"#111"}}>{v}</span></div>)}</div></Card>
          <Card><CardHead>Quick Links</CardHead><div style={{padding:"4px 0"}}>{["Home","Standings","Schedule","History","Profiles","Rules"].map(l=><div key={l} onClick={()=>setTab(l)} style={{padding:"8px 12px",fontSize:12,color:RED,cursor:"pointer",borderBottom:"1px solid #f5f5f5",fontWeight:500}}>🏈 {l}</div>)}</div></Card>
          <Card><CardHead bg={RED}>Points Leader</CardHead>{sorted.length===0?<div style={{padding:"14px 12px",textAlign:"center",color:"#bbb",fontSize:12}}>Not started</div>:sorted.slice(0,1).map(t=><div key={t.teamName} style={{padding:"14px 12px",textAlign:"center"}}><div style={{fontSize:26,fontWeight:900,color:RED}}>{calcTotal(t)}</div><div style={{fontSize:14,fontWeight:700,color:"#111",marginTop:2}}>{t.teamName}</div><div style={{fontSize:11,color:"#555",marginTop:4}}>{t.wins}W - {t.losses}L</div></div>)}</Card>
        </div>}

        {/* Center content */}
        <div style={{display:"flex",flexDirection:"column",gap:isMobile?10:14}}>

          {/* Page header - compact on mobile */}
          <Card style={{padding:isMobile?"10px 12px":"14px 16px",borderLeft:`4px solid ${RED}`}}>
            <div style={{fontSize:isMobile?15:18,fontWeight:900,color:"#111",textTransform:"uppercase"}}>{tab==="Home"?"Dynasty Home":tab==="Standings"?"Dynasty Standings":tab==="Schedule"?"Season Schedule":tab==="History"?"Season History":tab==="Profiles"?"Player Profiles":"Points System Rules"}</div>
            <div style={{fontSize:10,color:"#888",marginTop:2}}>{leagueName} · S{season} · {year} · {week>12?"Post":`Wk ${week}`}</div>
          </Card>

          {tab==="Home"&&(<>
            {/* This week's matchups */}
            {schedule&&schedule[week]&&Object.keys(schedule[week]).length>0&&<WeekMatchupsCard schedule={schedule} week={week} sorted={sorted} leagueName={leagueName} season={season} setActiveArticle={setActiveArticle} articles={articles} setArticles={setArticles}/>}

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
                      <td style={{padding:"9px 8px",fontWeight:i===0?800:600,color:"#111",whiteSpace:"nowrap"}}><Name userId={t.userId} userName={t.userName}>{t.teamName}</Name><div style={{fontSize:10,color:"#888"}}>{t.userName}</div></td>
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
            {schedule&&schedule[week]&&Object.keys(schedule[week]).length>0&&<WeekMatchupsCard schedule={schedule} week={week} sorted={sorted} leagueName={leagueName} season={season} setActiveArticle={setActiveArticle} articles={articles} setArticles={setArticles}/>}

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
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",fontWeight:i===0?800:600,color:"#111",whiteSpace:"nowrap",borderRight:"1px solid #eee",maxWidth:isMobile?90:140,overflow:"hidden",textOverflow:"ellipsis"}}><Name userId={t.userId} userName={t.userName}>{t.teamName}</Name>{!isMobile&&<div style={{fontSize:10,color:"#888",fontWeight:400}}>{t.userName}</div>}</td>
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

          {tab==="History"&&<HistoryTab history={history} setHistory={setHistory} saveToDb={saveToDb} commUnlocked={commUnlocked} yearRosters={setup?.yearRosters} permanentUsers={setup?.permanentUsers}/>}
          {tab==="Profiles"&&<ProfileTab history={history} setupRows={setup?.rows||[]} currentEntries={entries} season={season} year={year} permanentUsers={setup?.permanentUsers} sel={profileSel} setSel={setProfileSel} pTab={profilePTab} setPTab={setProfilePTab}/>}
          {tab==="Schedule"&&<ScheduleTab schedule={schedule} entries={activeEntries} week={week} season={season}/>}
          {tab==="Rules"&&<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
            {[["🏈 Regular Season",[["Win","15 pts"],["Win vs Top 25","+5 bonus"],["Win vs Top 10","+10 bonus"],["Loss","0 pts"]]],["📊 Conference Standings",[["1st","50"],["2nd","43"],["3rd","36"],["4th","30"],["5th","24"],["6th","18"],["7th","14"],["8th","10"],["9th","7"],["10th","5"],["11th","3"],["12th","1"]]],["🏆 Conference Championship",[["Make the Game","10 pts"],["Win the Game","15 pts"]]],["🥣 Bowl & Playoff",[["Make a Bowl","5 pts"],["Win a Bowl","+10 pts"],["Make CFP","15 pts"],["Win National Championship","+25 pts"]]],["🎓 Recruiting (Top 5 Users)",[["#1","15 pts"],["#2","10 pts"],["#3","7 pts"],["#4","5 pts"],["#5","3 pts"]]],["🏅 Dynasty Top 5",[["#1 in Dynasty","15 pts"],["#2 in Dynasty","10 pts"],["#3 in Dynasty","7 pts"],["#4 in Dynasty","5 pts"],["#5 in Dynasty","3 pts"]]],["⭐ Prestige & Awards",[["Gain a Prestige Star","10 pts"],["Reach Max Prestige","10 pts"],["Heisman Winner","15 pts"]]]].map(([title,rows])=><Card key={title} style={{overflow:"hidden"}}><CardHead bg={RED}>{title}</CardHead><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{rows.map(([l,p])=><tr key={l} style={{borderBottom:"1px solid #f0f0f0"}}><td style={{padding:"8px 12px",color:"#333",fontSize:13}}>{l}</td><td style={{padding:"8px 12px",textAlign:"right",color:RED,fontWeight:800,fontSize:13}}>{p}</td></tr>)}</tbody></table></Card>)}
          </div>}
        </div>

        {/* Right rail - desktop only */}
        {!isMobile&&<RightRail sorted={sorted} articles={articles} entries={activeEntries} week={week} season={season} leader={leader} setActiveArticle={setActiveArticle}/>}
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
            <button onClick={()=>setActiveArticle(null)} style={{background:"transparent",border:"1px solid #444",color:"#aaa",borderRadius:2,padding:"5px 12px",cursor:"pointer",fontSize:13,fontFamily:ff}}>✕ Close</button>
          </div>
          <div style={{background:activeArticle.reporterColor||RED,padding:"10px 18px",display:"flex",gap:14,alignItems:"center"}}>
            {activeArticle.reporterAvatar&&<div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",flexShrink:0}}>{activeArticle.reporterAvatar}</div>}
            <div>
              <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{activeArticle.reporter||"Dynasty Central"}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{activeArticle.label} · Season {activeArticle.season} · Week {activeArticle.week}</div>
            </div>
          </div>
          <div style={{padding:"24px 24px 32px"}}>
            <div style={{fontSize:15,lineHeight:1.9,color:"#222",whiteSpace:"pre-wrap",fontFamily:"Georgia, serif"}}>{activeArticle.text}</div>
          </div>
          <div style={{background:"#f7f7f7",padding:"12px 18px",borderTop:"1px solid #ddd",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:11,color:"#888"}}>Generated by Dynasty Central AI</div>
            <button onClick={()=>{setActiveArticle(null);setTab("Content");}} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"7px 14px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>View All Articles →</button>
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
          {["Enter Results","Season History","Schedule","Content","League Setup"].map(t=><button key={t} onClick={()=>setCommTab(t)} style={{padding:"11px 18px",background:"transparent",border:"none",borderBottom:commTab===t?`3px solid ${RED}`:"3px solid transparent",color:commTab===t?"#fff":"#888",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{t}</button>)}
        </div>
        <div style={{maxWidth:800,margin:"0 auto",padding:"20px 14px"}}>
          {commTab==="Season History"&&<HistoryTab history={history} setHistory={setHistory} saveToDb={saveToDb} commUnlocked={true} entries={entries} setEntries={setEntries} season={season} week={week} setWeek={setWeek} yearRosters={setup?.yearRosters} permanentUsers={setup?.permanentUsers}/>}
          {commTab==="Enter Results"&&<EnterResultsPanel entries={activeEntries} weekResults={weekResults} setWeekResults={setWeekResults} week={week} setWeek={setWeek} applyBulkResults={applyBulkResults} applyWeekResults={applyWeekResults} postSeasonInputs={postSeasonInputs} setPSI={setPSI} applyPostSeason={applyPostSeason} finalizeSeason={finalizeSeason} season={season} setSeason={setSeason} year={year} setYear={setYear} teamNames={teamNames} schedule={schedule} history={history} onImportHistory={importHistoricalSeason} setupRows={setup?.rows||[]} saveToDb={saveToDb}/>}
          {commTab==="Schedule"&&<SchedulePanel entries={activeEntries} schedule={schedule} setSchedule={setSchedule}/>}
          {commTab==="Content"&&<ContentHub sorted={sorted} entries={activeEntries} week={week} season={season} leagueName={leagueName} history={history} leader={leader} articles={articles} setArticles={setArticles} setActiveArticle={setActiveArticle} schedule={schedule}/>}
          {commTab==="League Setup"&&<SetupPanel entries={entries} setup={setup} postSeasonInputs={postSeasonInputs} setPSI={setPSI} handleStart={handleStart} setCommissionerUnlocked={setCommUnlocked} season={season} year={year} setEntries={setEntries} setWeekResults={setWeekResults} setSetup={setSetup} saveToDb={saveToDb} history={history} setHistory={setHistory}/>}
        </div>
      </div>}
    </div>
    </NavCtx.Provider>
  );
}
