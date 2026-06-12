
import { useState, useEffect, useCallback } from "react";

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
const START_YEAR = 2025;
const PASS = "RatedRKO99";
const MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";
const HEADERS = {"Content-Type":"application/json"};

const INITIAL_ENTRY = (userName, teamName) => ({
  userName, teamName, wins:0, losses:0,
  gamePts:0, rankedBonusPts:0, confStandPts:0,
  confChampPts:0, bowlPts:0, recruitingPts:0,
  prestigePts:0, heismanPts:0, weekLog:[],
  h2h:{},
});

// schedule shape: { week: { teamName: "Opponent" | "CPU" | "BYE" } }
// e.g. { 1: { Troy: "Georgia Southern", "Georgia Southern": "Troy", Toledo: "CPU", UNLV: "BYE" } }

function calcTotal(t) {
  return (t.gamePts||0)+(t.rankedBonusPts||0)+(t.confStandPts||0)+(t.confChampPts||0)+(t.bowlPts||0)+(t.recruitingPts||0)+(t.prestigePts||0)+(t.heismanPts||0);
}

async function callClaude(prompt) {
  const r = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({prompt, max_tokens: 1200})
  });
  if (!r.ok) {
    const err = await r.json().catch(()=>({}));
    throw new Error(err?.error || `Server error ${r.status}`);
  }
  const d = await r.json();
  return d.text || "No content returned.";
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
      const text = await callClaude(prompt);
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
          <div style={{padding:"16px 18px"}}>
            <div style={{display:"flex",alignItems:"center",gap:0}}>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#111"}}>{gameOfWeek.team1}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank1} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team1)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team1)?.losses||0}L</div>
              </div>
              <div style={{padding:"0 16px",textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:900,color:"#1a3a6b",letterSpacing:2}}>VS</div>
                <div style={{fontSize:10,color:"#aaa",marginTop:4,fontWeight:600}}>Conference</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#111"}}>{gameOfWeek.team2}</div>
                <div style={{fontSize:11,color:"#888",marginTop:3}}>#{gameOfWeek.rank2} in Dynasty</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{sorted.find(t=>t.teamName===gameOfWeek.team2)?.wins||0}W-{sorted.find(t=>t.teamName===gameOfWeek.team2)?.losses||0}L</div>
              </div>
            </div>
            {existingGOTW&&<div style={{marginTop:12,padding:"10px 14px",background:"#f0f4ff",borderRadius:2,border:"1px solid #c5d0e8",fontSize:13,color:"#333",lineHeight:1.5,cursor:"pointer"}} onClick={()=>setActiveArticle(existingGOTW)}>
              <strong style={{color:"#1a3a6b"}}>Preview:</strong> {existingGOTW.text.slice(0,160)}... <span style={{color:"#1a3a6b",fontWeight:700}}>Read more →</span>
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
              <div key={i} style={{display:"flex",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #f0f0f0",background:isGOTW?"#f8f9ff":"transparent"}}>
                {isGOTW&&<span style={{fontSize:10,marginRight:8,flexShrink:0}}>🏆</span>}
                {opp==="BYE"
                  ?<><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1}}>{team}</span><span style={{fontSize:11,color:"#aaa",background:"#f5f5f5",borderRadius:2,padding:"2px 8px",flexShrink:0}}>BYE WEEK</span></>
                  :opp==="CPU"
                  ?<><span style={{fontSize:13,fontWeight:700,color:"#111",flex:1}}>{team}</span><span style={{fontSize:11,color:"#888",padding:"0 8px"}}>vs</span><span style={{fontSize:13,fontWeight:600,color:"#888",flex:1,textAlign:"right"}}>CPU (non-conf)</span></>
                  :<><span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",flex:1}}>{team}</span><div style={{padding:"0 12px",textAlign:"center",flexShrink:0}}><span style={{fontSize:10,fontWeight:900,color:isGOTW?"#1a3a6b":"#bbb",letterSpacing:1}}>VS</span></div><span style={{fontSize:13,fontWeight:isGOTW?800:700,color:"#111",flex:1,textAlign:"right"}}>{opp}</span></>
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
  const [editWeek,setEditWeek] = useState(1);
  const [saved,setSaved] = useState(false);
  const teamNames = (entries||[]).map(e=>e.teamName);
  const WEEKS = Array.from({length:12},(_,i)=>i+1);
  const OPPONENTS = ["BYE","CPU",...teamNames];
  const SUPA_URL2 = "https://uyaqmdljwwslskoqxvpn.supabase.co";
  const SUPA_KEY2 = "sb_publishable_GNVG6TW43VXjW7IhWcBtmA_L_mMok1C";

  function setMatchup(wk,team,opp) {
    setSchedule(prev=>{
      const ns={...prev,[wk]:{...(prev[wk]||{}),[team]:opp}};
      if(opp!=="BYE"&&opp!=="CPU"&&teamNames.includes(opp))ns[wk][opp]=team;
      return ns;
    });
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
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button onClick={saveSchedule} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>💾 Save Schedule</button>
          {saved&&<div style={{fontSize:12,color:"#007a00",fontWeight:700}}>✓ Saved!</div>}
        </div>
      </Card>
      {teamNames.length>0&&Object.keys(schedule).length>0&&(
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
function HistoryTab({history}) {
  const [sel,setSel] = useState(null);
  if (!history.length) return <Card style={{padding:20}}><div style={{color:"#888",fontSize:14,textAlign:"center"}}>No completed seasons yet.</div></Card>;
  const allWins={},allPts={},champs={},confT={};
  history.forEach(s=>{
    s.finalStandings.forEach(t=>{allWins[t.userName]=(allWins[t.userName]||0)+t.wins;allPts[t.userName]=(allPts[t.userName]||0)+calcTotal(t);});
    if(s.champion)champs[s.champion]=(champs[s.champion]||0)+1;
    if(s.confChampion)confT[s.confChampion]=(confT[s.confChampion]||0)+1;
  });
  const wList=Object.entries(allWins).sort((a,b)=>b[1]-a[1]);
  const pList=Object.entries(allPts).sort((a,b)=>b[1]-a[1]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {Object.keys(champs).length>0&&<Card><CardHead bg={RED}>Dynasty Champions</CardHead><div style={{padding:"10px 14px",display:"flex",flexWrap:"wrap",gap:10}}>{Object.entries(champs).map(([u,c])=><div key={u} style={{background:RED,borderRadius:3,padding:"8px 14px",textAlign:"center"}}><div style={{color:"#fff",fontWeight:800,fontSize:14}}>{u}</div><div style={{color:"rgba(255,255,255,0.7)",fontSize:11}}>{c}× CHAMPION</div></div>)}</div></Card>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <Card><CardHead>All-Time Wins</CardHead><div style={{padding:"4px 0"}}>{wList.map(([u,w],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span><span style={{fontSize:13,fontWeight:800,color:"#007a00"}}>{w}W</span></div>)}</div></Card>
        <Card><CardHead>All-Time Pts</CardHead><div style={{padding:"4px 0"}}>{pList.map(([u,p],i)=><div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,color:i===0?"#111":"#555",fontWeight:i===0?700:400}}>{i+1}. {u}</span><span style={{fontSize:13,fontWeight:800,color:RED}}>{p}</span></div>)}</div></Card>
      </div>
      <Card><CardHead>Season History</CardHead>
        <div style={{padding:"12px 14px",display:"flex",gap:8,flexWrap:"wrap"}}>
          {history.map((s,i)=><button key={i} onClick={()=>setSel(sel===i?null:i)} style={{padding:"5px 12px",borderRadius:2,border:"1px solid",borderColor:sel===i?RED:"#ddd",background:sel===i?RED:"#fff",color:sel===i?"#fff":"#555",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff,textTransform:"uppercase"}}>{s.year} · S{s.seasonNum}</button>)}
        </div>
        {sel!==null&&(()=>{const s=history[sel];const srt=[...s.finalStandings].sort((a,b)=>calcTotal(b)-calcTotal(a));const top=calcTotal(srt[0]);return(<div style={{padding:"0 14px 14px"}}><div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>{s.champion&&<div style={{background:RED,borderRadius:2,padding:"3px 10px",fontSize:11,color:"#fff",fontWeight:700}}>🏆 {s.champion}</div>}{s.confChampion&&<div style={{background:"#f5f5f5",border:"1px solid #ddd",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#111",fontWeight:700}}>🏅 {s.confChampion}</div>}{s.heisman&&<div style={{background:"#fff8e8",border:"1px solid #ddd",borderRadius:2,padding:"3px 10px",fontSize:11,color:"#cc7700",fontWeight:700}}>🏈 {s.heisman}</div>}</div><table style={{width:"100%",borderCollapse:"collapse",fontSize:isMobile?11:13}}><thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["#","User","Team","W","L","PTS","Behind"].map(h=><th key={h} style={{padding:"7px 6px",textAlign:h==="User"||h==="Team"?"left":"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800}}>{h}</th>)}</tr></thead><tbody>{srt.map((t,i)=>{const tot=calcTotal(t);return(<tr key={t.userName} style={{borderBottom:"1px solid #eee",background:i===0?"#fff8f8":"transparent"}}><td style={{padding:"8px 6px",textAlign:"center",color:i===0?RED:"#bbb",fontWeight:800,fontSize:13}}>{i+1}</td><td style={{padding:"8px 6px",color:"#111",fontWeight:i===0?800:400}}>{t.userName}</td><td style={{padding:"8px 6px",color:"#888",fontSize:12}}>{t.teamName}</td><td style={{padding:"8px 6px",textAlign:"center",color:"#007a00",fontWeight:700}}>{t.wins}</td><td style={{padding:"8px 6px",textAlign:"center",color:RED,fontWeight:700}}>{t.losses}</td><td style={{padding:"8px 6px",textAlign:"center",fontWeight:800,color:i===0?RED:"#111",fontSize:14}}>{tot}</td><td style={{padding:"8px 6px",textAlign:"center",color:i===0?"#007a00":RED,fontSize:12}}>{i===0?"LEAD":`-${top-tot}`}</td></tr>);})}</tbody></table></div>);})()}
      </Card>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────
function ProfileTab({history,setupRows,currentEntries,season}) {
  const [sel,setSel] = useState(null);
  const [pTab,setPTab] = useState("overview");
  const allUsers = setupRows||[];
  if (!allUsers.length) return <Card style={{padding:20}}><div style={{color:"#888",fontSize:14}}>No users found.</div></Card>;

  function getProfile(userName) {
    const seasons=history.map(s=>{const srt=[...s.finalStandings].sort((a,b)=>calcTotal(b)-calcTotal(a));const entry=srt.find(t=>t.userName===userName);if(!entry)return null;const rank=srt.findIndex(t=>t.userName===userName)+1;return{year:s.year,seasonNum:s.seasonNum,rank,total:calcTotal(entry),wins:entry.wins,losses:entry.losses,teamName:entry.teamName,champion:s.champion===userName,confChamp:s.confChampion===userName,heisman:s.heisman===userName,weekLog:entry.weekLog||[],gamePts:entry.gamePts||0,rankedBonusPts:entry.rankedBonusPts||0,confStandPts:entry.confStandPts||0,confChampPts:entry.confChampPts||0,bowlPts:entry.bowlPts||0,recruitingPts:entry.recruitingPts||0,prestigePts:entry.prestigePts||0,heismanPts:entry.heismanPts||0,h2h:entry.h2h||{}};}).filter(Boolean);
    const cur=currentEntries.find(e=>e.userName===userName);
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
    // H2H - merge across all seasons + current
    const h2hMerged={};
    [...seasons.map(s=>s.h2h||{}),(cur?.h2h||{})].forEach(h2h=>{Object.entries(h2h).forEach(([opp,rec])=>{if(!h2hMerged[opp])h2hMerged[opp]={wins:0,losses:0};h2hMerged[opp].wins+=(rec.wins||0);h2hMerged[opp].losses+=(rec.losses||0);});});
    const ptBreakdown={game:seasons.reduce((a,s)=>a+(s.gamePts||0),0)+(cur?.gamePts||0),bonus:seasons.reduce((a,s)=>a+(s.rankedBonusPts||0),0)+(cur?.rankedBonusPts||0),conf:seasons.reduce((a,s)=>a+(s.confStandPts||0),0)+(cur?.confStandPts||0),cc:seasons.reduce((a,s)=>a+(s.confChampPts||0),0)+(cur?.confChampPts||0),bowl:seasons.reduce((a,s)=>a+(s.bowlPts||0),0)+(cur?.bowlPts||0),rec:seasons.reduce((a,s)=>a+(s.recruitingPts||0),0)+(cur?.recruitingPts||0),awards:seasons.reduce((a,s)=>a+(s.prestigePts||0)+(s.heismanPts||0),0)+((cur?.prestigePts||0)+(cur?.heismanPts||0))};
    return{seasons,cur,totalWins,totalLosses,totalPts,championships,confTitles,heismans,bestFinish,longestWin,longestLoss,curStreak,curStreakType,rankedWins,top10Wins,winPct,h2hMerged,ptBreakdown};
  }

  function getLR() {
    const recs={};
    allUsers.forEach(u=>{try{recs[u.userName]=getProfile(u.userName);}catch{}});
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
  const user=sel?allUsers.find(u=>u.userName===sel):null;
  const profile=user?getProfile(user.userName):null;
  const SB=({label,val,color="#111",sub})=><div style={{background:"#f7f7f7",borderRadius:2,padding:"12px 8px",textAlign:"center",border:"1px solid #eee"}}><div style={{fontSize:19,fontWeight:900,color}}>{val}</div>{sub&&<div style={{fontSize:10,color:"#999"}}>{sub}</div>}<div style={{fontSize:9,color:"#aaa",textTransform:"uppercase",letterSpacing:1,marginTop:3,fontWeight:700}}>{label}</div></div>;
  const RR=({label,holder,val})=><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}><span style={{fontSize:12,color:"#555"}}>{label}</span><div style={{textAlign:"right"}}><div style={{fontSize:13,color:"#111",fontWeight:700}}>{holder}</div><div style={{fontSize:11,color:RED,fontWeight:700}}>{val}</div></div></div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {Object.keys(lr).length>0&&<Card><CardHead>🏆 League Records</CardHead><div style={{padding:"4px 14px 10px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>{lr.mostWins&&<RR label="Most Wins" holder={lr.mostWins[0]} val={lr.mostWins[1].totalWins+"W"}/>}{lr.mostPts&&<RR label="Most Pts" holder={lr.mostPts[0]} val={String(lr.mostPts[1].totalPts)}/>}{lr.mostChamps&&<RR label="Most Titles" holder={lr.mostChamps[0]} val={lr.mostChamps[1].championships+"×"}/>}{lr.bestWinPct&&<RR label="Best Win%" holder={lr.bestWinPct[0]} val={lr.bestWinPct[1].winPct+"%"}/>}{lr.longestWS&&<RR label="Win Streak" holder={lr.longestWS[0]} val={lr.longestWS[1].longestWin+"G"}/>}{lr.mostRW&&<RR label="Ranked Wins" holder={lr.mostRW[0]} val={lr.mostRW[1].rankedWins+"W"}/>}</div></Card>}
      <SL>Select User</SL>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {allUsers.map(u=><button key={u.userName} onClick={()=>{setSel(sel===u.userName?null:u.userName);setPTab("overview");}} style={{padding:"10px 14px",borderRadius:2,border:"1px solid",borderColor:sel===u.userName?RED:"#ddd",background:sel===u.userName?RED:"#fff",color:sel===u.userName?"#fff":"#333",cursor:"pointer",fontFamily:ff,textAlign:"left"}}><div style={{fontWeight:800,fontSize:13}}>{u.userName}</div><div style={{fontSize:10,color:sel===u.userName?"rgba(255,255,255,0.7)":"#999",marginTop:2,textTransform:"uppercase"}}>{u.teamName}</div></button>)}
      </div>
      {profile&&user&&<Card style={{borderTop:`3px solid ${RED}`,overflow:"hidden"}}>
        <div style={{background:"#f7f7f7",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          <div><div style={{fontSize:22,fontWeight:900,color:"#111"}}>{user.userName.toUpperCase()}</div><div style={{fontSize:12,color:"#888",marginTop:2}}>{user.teamName} · {profile.totalWins}W-{profile.totalLosses}L · {profile.winPct}%</div><div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{profile.championships>0&&<div style={{background:RED,borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏆 {profile.championships}×</div>}{profile.confTitles>0&&<div style={{background:"#333",borderRadius:2,padding:"2px 8px",fontSize:10,color:"#fff",fontWeight:700}}>🏅 {profile.confTitles}×</div>}{profile.curStreak>1&&<div style={{background:profile.curStreakType==="win"?"#e8f5e8":"#fff0f0",border:`1px solid ${profile.curStreakType==="win"?"#007a00":RED}`,borderRadius:2,padding:"2px 8px",fontSize:10,color:profile.curStreakType==="win"?"#007a00":RED,fontWeight:700}}>{profile.curStreakType==="win"?"🔥":"❄️"} {profile.curStreak} STREAK</div>}</div></div>
        </div>
        <div style={{display:"flex",borderBottom:"1px solid #eee",background:"#fff",overflowX:"auto"}}>
          {["overview","seasons","h2h","streaks","points"].map(t=><button key={t} onClick={()=>setPTab(t)} style={{padding:"10px 14px",background:"transparent",border:"none",borderBottom:pTab===t?`3px solid ${RED}`:"3px solid transparent",color:pTab===t?"#111":"#888",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{t==="h2h"?"H2H Records":t}</button>)}
        </div>
        <div style={{padding:18}}>
          {pTab==="overview"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div><SL>Career Stats</SL><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:8}}><SB label="Total Pts" val={profile.totalPts} color={RED}/><SB label="Wins" val={profile.totalWins} color="#007a00"/><SB label="Losses" val={profile.totalLosses} color={RED}/><SB label="Win %" val={profile.winPct+"%"}/><SB label="Best Finish" val={profile.bestFinish?`#${profile.bestFinish}`:"—"} color={RED}/><SB label="Seasons" val={profile.seasons.length+(profile.cur?1:0)}/></div></div>
            <div><SL>Streaks & Ranked</SL><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:8}}><SB label="Win Streak" val={profile.longestWin+"G"} color="#007a00"/><SB label="Loss Streak" val={profile.longestLoss+"G"} color={RED}/><SB label="Ranked Wins" val={profile.rankedWins} color="#cc7700"/><SB label="Top 10 Wins" val={profile.top10Wins} color={RED}/></div></div>
          </div>}

          {pTab==="h2h"&&<div>
            <SL>Head-to-Head Records</SL>
            {Object.keys(profile.h2hMerged).length===0?<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>No head-to-head data yet. Records are tracked when opponent names match dynasty users.</div>:
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Opponent","W","L","W%","Result"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:h==="Opponent"?"left":"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800}}>{h}</th>)}</tr></thead>
              <tbody>{Object.entries(profile.h2hMerged).sort((a,b)=>(b[1].wins+b[1].losses)-(a[1].wins+a[1].losses)).map(([opp,rec])=>{const total=rec.wins+rec.losses;const wpct=total>0?((rec.wins/total)*100).toFixed(0):0;const winning=rec.wins>rec.losses;return(<tr key={opp} style={{borderBottom:"1px solid #eee",background:winning?"#f0f8f0":rec.wins<rec.losses?"#fff8f8":"transparent"}}><td style={{padding:"9px 10px",fontWeight:600,color:"#111"}}>{opp}</td><td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:"#007a00"}}>{rec.wins}</td><td style={{padding:"9px 10px",textAlign:"center",fontWeight:700,color:RED}}>{rec.losses}</td><td style={{padding:"9px 10px",textAlign:"center",color:"#555"}}>{wpct}%</td><td style={{padding:"9px 10px",textAlign:"center"}}><span style={{background:winning?RED:"#007a00",color:"#fff",borderRadius:2,padding:"2px 8px",fontSize:10,fontWeight:700}}>{winning?"LEADS":"TRAILS"}{rec.wins===rec.losses?" (TIED)":""}</span></td></tr>);})}</tbody>
            </table>}
          </div>}

          {pTab==="seasons"&&<div><SL>Season Breakdown</SL><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{borderBottom:`2px solid ${RED}`,background:"#f7f7f7"}}>{["Year","S","Team","W","L","W%","PTS","Rank"].map(h=><th key={h} style={{padding:"7px 5px",textAlign:"center",color:"#555",fontSize:9,letterSpacing:1,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead><tbody>{profile.seasons.map((s,i)=>{const pct=s.wins+s.losses>0?((s.wins/(s.wins+s.losses))*100).toFixed(0):0;return(<tr key={i} style={{borderBottom:"1px solid #eee",background:s.champion?"#fff8f8":"transparent"}}><td style={{padding:"8px 5px",textAlign:"center",color:s.champion?RED:"#111",fontWeight:s.champion?800:400}}>{s.year}{s.champion&&" 🏆"}</td><td style={{padding:"8px 5px",textAlign:"center",color:"#888"}}>S{s.seasonNum}</td><td style={{padding:"8px 5px",textAlign:"center",color:"#888",fontSize:11,whiteSpace:"nowrap"}}>{s.teamName}</td><td style={{padding:"8px 5px",textAlign:"center",color:"#007a00",fontWeight:700}}>{s.wins}</td><td style={{padding:"8px 5px",textAlign:"center",color:RED,fontWeight:700}}>{s.losses}</td><td style={{padding:"8px 5px",textAlign:"center"}}>{pct}%</td><td style={{padding:"8px 5px",textAlign:"center",fontWeight:800,color:RED}}>{s.total}</td><td style={{padding:"8px 5px",textAlign:"center",color:s.rank===1?RED:"#111",fontWeight:s.rank===1?800:400}}>#{s.rank}</td></tr>);})}
          {profile.cur&&<tr style={{borderBottom:"1px solid #eee",background:"#fff8f8"}}><td style={{padding:"8px 5px",textAlign:"center",color:RED,fontWeight:800}}>{START_YEAR+season-1} 🔴</td><td style={{padding:"8px 5px",textAlign:"center",color:RED}}>S{season}</td><td style={{padding:"8px 5px",textAlign:"center",color:"#888",fontSize:11}}>{profile.cur.teamName}</td><td style={{padding:"8px 5px",textAlign:"center",color:"#007a00",fontWeight:700}}>{profile.cur.wins}</td><td style={{padding:"8px 5px",textAlign:"center",color:RED,fontWeight:700}}>{profile.cur.losses}</td><td style={{padding:"8px 5px",textAlign:"center"}}>{profile.cur.wins+profile.cur.losses>0?((profile.cur.wins/(profile.cur.wins+profile.cur.losses))*100).toFixed(0):0}%</td><td style={{padding:"8px 5px",textAlign:"center",fontWeight:800,color:RED}}>{calcTotal(profile.cur)}</td><td style={{padding:"8px 5px",textAlign:"center",color:RED}}>Live</td></tr>}
          </tbody></table></div></div>}

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
function SetupPanel({entries,setup,postSeasonInputs,setPSI,handleStart,setCommissionerUnlocked,season,setEntries,setWeekResults,setSetup}) {
  const [setupRows,setSetupRows] = useState(setup?.rows?.length?setup.rows.map(r=>({userName:r.userName,teamName:r.teamName})):Array.from({length:4},()=>({userName:"",teamName:""})));
  const [setupLeague,setSetupLeague] = useState(setup?.leagueName||"");
  const setSR=(i,f,v)=>setSetupRows(p=>p.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const addRow=()=>setSetupRows(p=>[...p,{userName:"",teamName:""}]);
  const removeRow=(i)=>{if(setupRows.length<=2)return alert("Minimum 2 teams.");setSetupRows(p=>p.filter((_,idx)=>idx!==i));};
  function applySetup(){const valid=setupRows.filter(r=>r.userName.trim()&&r.teamName.trim());if(valid.length<2)return alert("Enter at least 2 users.");if(entries.length>0&&!window.confirm("This resets all standings. Continue?"))return;handleStart(setupLeague||"Dynasty League",valid);setCommissionerUnlocked(false);}
  function addMidSeason(){const last=setupRows[setupRows.length-1];if(!last?.userName?.trim()||!last?.teamName?.trim())return alert("Fill in the last row first.");if(entries.find(e=>e.teamName===last.teamName))return alert("That team is already in the dynasty.");const newE=INITIAL_ENTRY(last.userName.trim(),last.teamName.trim());setEntries(prev=>[...prev,newE]);setWeekResults(prev=>[...prev,{teamName:newE.teamName,userName:newE.userName,result:"none",ranked25:false,ranked10:false}]);if(postSeasonInputs)setPSI(prev=>({...prev,confStandings:[...prev.confStandings,{teamName:newE.teamName,rank:prev.confStandings.length+1}],bowls:[...prev.bowls,{teamName:newE.teamName,bowl:"none"}],recruiting:[...prev.recruiting,{teamName:newE.teamName,rank:prev.recruiting.length+1}]}));setSetup(prev=>({...prev,rows:[...(prev?.rows||[]),{userName:newE.userName,teamName:newE.teamName}]}));alert(`${newE.userName} (${newE.teamName}) added!`);}
  const isLive=entries.length>0;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {isLive&&<div style={{background:"#fff8f8",border:"1px solid #ffcccc",borderRadius:2,padding:"12px 14px",fontSize:13,color:RED,fontWeight:600}}>⚠️ Dynasty is live. "Add Team Mid-Season" adds a player without resetting. "Launch" resets everything.</div>}
      <Card><CardHead>League Name</CardHead><div style={{padding:"12px 14px"}}><input value={setupLeague} onChange={e=>setSetupLeague(e.target.value)} placeholder="e.g. Chrome Horn Dynasty 2025" style={{background:"#fff",border:"1px solid #ccc",borderRadius:2,padding:"9px 12px",color:"#111",fontFamily:ff,fontSize:14,width:"100%",boxSizing:"border-box"}}/></div></Card>
      <Card><CardHead bg={RED}>Users & Teams</CardHead>
        <div style={{padding:"0 0 8px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 32px",padding:"8px 14px 6px",borderBottom:"1px solid #f0f0f0"}}>
            <div style={{fontSize:10,color:"#999",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Username</div>
            <div style={{fontSize:10,color:"#999",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Team</div>
            <div/>
          </div>
          {setupRows.map((row,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 32px",borderBottom:"1px solid #f5f5f5",alignItems:"center"}}>
              <input value={row.userName} onChange={e=>setSR(i,"userName",e.target.value)} placeholder={"User "+(i+1)} style={{background:"transparent",border:"none",borderRight:"1px solid #f0f0f0",padding:"9px 14px",color:"#111",fontFamily:ff,fontSize:13,outline:"none"}}/>
              <input value={row.teamName} onChange={e=>setSR(i,"teamName",e.target.value)} placeholder="e.g. Troy" style={{background:"transparent",border:"none",borderRight:"1px solid #f0f0f0",padding:"9px 14px",color:"#111",fontFamily:ff,fontSize:13,outline:"none"}}/>
              <button onClick={()=>removeRow(i)} style={{background:"transparent",border:"none",color:"#ccc",cursor:"pointer",fontSize:18,padding:"0 8px"}}>×</button>
            </div>
          ))}
          <div style={{padding:"10px 14px"}}><button onClick={addRow} style={{background:"transparent",border:"1px dashed #ccc",borderRadius:2,padding:"7px 14px",color:"#888",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:600,width:"100%"}}>+ Add Player</button></div>
        </div>
      </Card>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button onClick={applySetup} style={{flex:1,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"13px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",minWidth:140}}>{isLive?"↺ Reset & Relaunch":"Launch Dynasty →"}</button>
        {isLive&&<button onClick={addMidSeason} style={{flex:1,background:"#007a00",color:"#fff",border:"none",borderRadius:2,padding:"13px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase",minWidth:140}}>+ Add Team Mid-Season</button>}
      </div>
    </div>
  );
}

// ── EnterResultsPanel ─────────────────────────────────────────────────────
function EnterResultsPanel({entries,weekResults,setWeekResults,week,imageFile,imagePreview,processingImage,imageResult,parsedFromImage,handleImageUpload,processImage,applyImageResults,setParsedFromImage,applyWeekResults,postSeasonInputs,setPSI,applyPostSeason,finalizeSeason,season,teamNames,schedule}) {
  const setWR=(i,f,v)=>setWeekResults(prev=>prev.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const thisWeekSchedule = schedule?.[week]||{};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card><div style={{padding:16}}>
        <SL>Upload CF27 Screenshot</SL>
        <p style={{fontSize:13,color:"#888",marginBottom:12,lineHeight:1.5}}>Take a photo of your Scores/Schedules screen and Claude will read results automatically.</p>
        <input type="file" accept="image/*" onChange={handleImageUpload} style={{color:"#111",fontSize:13,marginBottom:12,display:"block"}}/>
        {imagePreview&&<img src={imagePreview} alt="preview" style={{maxWidth:"100%",maxHeight:160,borderRadius:2,border:"1px solid #ddd",marginBottom:12,display:"block"}}/>}
        <button onClick={processImage} disabled={!imageFile||processingImage} style={{background:imageFile&&!processingImage?RED:"#ccc",color:"#fff",border:"none",borderRadius:2,padding:"9px 18px",cursor:imageFile&&!processingImage?"pointer":"not-allowed",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>{processingImage?"Reading...":"Read Screenshot"}</button>
        {imageResult&&<div style={{marginTop:10,background:"#f7f7f7",borderRadius:2,padding:10,fontSize:13,color:"#111",borderLeft:`3px solid ${imageResult.startsWith("✅")?"#007a00":imageResult.startsWith("❌")?RED:"#cc7700"}`}}>{imageResult}</div>}
        {parsedFromImage.length>0&&<div style={{marginTop:14}}>
          <SL>Review Results</SL>
          {parsedFromImage.map((p,i)=>{const entry=entries.find(e=>e.teamName.toLowerCase()===p.teamName.toLowerCase());return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap",padding:"7px 0",borderBottom:"1px solid #f0f0f0"}}><div style={{width:140}}><div style={{fontSize:13,color:"#111",fontWeight:600}}>{p.teamName}</div>{entry?<div style={{fontSize:11,color:"#888"}}>{entry.userName}</div>:<div style={{fontSize:11,color:RED}}>⚠ no match</div>}</div>{["win","loss"].map(opt=><button key={opt} onClick={()=>setParsedFromImage(prev=>prev.map((r,idx)=>idx===i?{...r,result:opt}:r))} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:p.result===opt?(opt==="win"?"#007a00":RED):"#ddd",background:p.result===opt?(opt==="win"?"#f0f8f0":"#fff8f8"):"#fff",color:p.result===opt?(opt==="win"?"#007a00":RED):"#888",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:700,textTransform:"uppercase"}}>{opt}</button>)}<label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}><input type="checkbox" checked={p.ranked25} onChange={e=>setParsedFromImage(prev=>prev.map((r,idx)=>idx===i?{...r,ranked25:e.target.checked,ranked10:false}:r))}/> Top 25</label><label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:RED,cursor:"pointer"}}><input type="checkbox" checked={p.ranked10} onChange={e=>setParsedFromImage(prev=>prev.map((r,idx)=>idx===i?{...r,ranked10:e.target.checked,ranked25:false}:r))}/> Top 10</label></div>);})}
          <button onClick={applyImageResults} style={{marginTop:8,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"9px 18px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Apply & Advance Week →</button>
        </div>}
      </div></Card>
      {week<=12&&<Card><div style={{padding:16}}>
        <SL>Manual Entry — Week {week}</SL>
        {Object.keys(thisWeekSchedule).length>0&&<div style={{background:"#f0f8f0",border:"1px solid #cce5cc",borderRadius:2,padding:"8px 12px",fontSize:12,color:"#555",marginBottom:12}}>✓ Schedule loaded — entering one team's result automatically updates their opponent's record.</div>}
        {weekResults.map((wr,i)=>(
          <div key={wr.teamName} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"9px 0",borderBottom:"1px solid #f0f0f0"}}>
            <div style={{width:130}}><div style={{fontSize:13,color:"#111",fontWeight:700}}>{wr.userName}</div><div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:0.5}}>{wr.teamName}</div></div>
            <div style={{display:"flex",gap:6}}>{["win","loss","none"].map(opt=><button key={opt} onClick={()=>setWR(i,"result",opt)} style={{padding:"5px 10px",borderRadius:2,border:"1px solid",borderColor:wr.result===opt?(opt==="win"?"#007a00":opt==="loss"?RED:"#cc7700"):"#ddd",background:wr.result===opt?(opt==="win"?"#f0f8f0":opt==="loss"?"#fff8f8":"#fffbf0"):"#fff",color:wr.result===opt?(opt==="win"?"#007a00":opt==="loss"?RED:"#cc7700"):"#888",cursor:"pointer",fontSize:11,fontFamily:ff,fontWeight:800,textTransform:"uppercase"}}>{opt==="none"?"BYE":opt}</button>)}</div>
            {wr.result==="win"&&<div style={{display:"flex",gap:10}}><label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888",cursor:"pointer"}}><input type="checkbox" checked={wr.ranked25} onChange={e=>setWR(i,"ranked25",e.target.checked)}/> vs Top 25</label><label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:RED,cursor:"pointer",fontWeight:700}}><input type="checkbox" checked={wr.ranked10} onChange={e=>setWR(i,"ranked10",e.target.checked)}/> vs Top 10</label></div>}
          </div>
        ))}
        <button onClick={applyWeekResults} style={{marginTop:14,background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 22px",cursor:"pointer",fontFamily:ff,fontSize:14,fontWeight:800,textTransform:"uppercase"}}>Submit Week {week} →</button>
      </div></Card>}
      {week>12&&postSeasonInputs&&<Card style={{borderTop:`3px solid ${RED}`}}><div style={{padding:16}}>
        <SL>Post Season — {START_YEAR+season-1}</SL>
        <div style={{marginBottom:14}}><div style={{fontSize:12,color:"#555",marginBottom:8,fontWeight:600}}>Final Conference Standings</div>{postSeasonInputs.confStandings.map((s,i)=><div key={s.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<3?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={s.teamName} onChange={e=>{const nv=e.target.value;const si=postSeasonInputs.confStandings.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.confStandings];[arr[i],arr[si]]=[arr[si],arr[i]];return{...prev,confStandings:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select><span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{CONF_STAND_PTS[i]}</span></div>)}</div>
        <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Made Conference Championship</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{teamNames.map(t=><button key={t} onClick={()=>setPSI(prev=>({...prev,confChamp:{...prev.confChamp,made:prev.confChamp.made.includes(t)?prev.confChamp.made.filter(x=>x!==t):[...prev.confChamp.made,t].slice(-2)}}))} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:postSeasonInputs.confChamp.made.includes(t)?RED:"#ddd",background:postSeasonInputs.confChamp.made.includes(t)?RED:"#fff",color:postSeasonInputs.confChamp.made.includes(t)?"#fff":"#888",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:600}}>{t}</button>)}</div></div>
        <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Conference Champion</div><select value={postSeasonInputs.confChamp.winner} onChange={e=>setPSI(prev=>({...prev,confChamp:{...prev.confChamp,winner:e.target.value}}))} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"6px 10px",fontFamily:ff,fontSize:13}}><option value="">-- Select --</option>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select></div>
        <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Bowl & Playoff Results</div>{postSeasonInputs.bowls.map((b,i)=><div key={b.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><div style={{width:120}}><div style={{fontSize:12,color:"#111",fontWeight:600}}>{b.teamName}</div><div style={{fontSize:10,color:"#888"}}>{entries.find(e=>e.teamName===b.teamName)?.userName}</div></div><select value={b.bowl} onChange={e=>setPSI(prev=>({...prev,bowls:prev.bowls.map((x,xi)=>xi===i?{...x,bowl:e.target.value}:x)}))} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"4px 8px",fontFamily:ff,fontSize:12}}><option value="none">No Bowl</option><option value="made">Made Bowl (+5)</option><option value="won">Won Bowl (+15)</option><option value="cfp">Made CFP (+15)</option><option value="cfpwon">Won Natty (+40)</option></select></div>)}</div>
        <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Recruiting (Top 5)</div>{postSeasonInputs.recruiting.map((r,i)=><div key={r.teamName} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><span style={{color:i<5?RED:"#bbb",width:22,textAlign:"right",fontSize:12,fontWeight:800}}>{i+1}.</span><select value={r.teamName} onChange={e=>{const nv=e.target.value;const si=postSeasonInputs.recruiting.findIndex(x=>x.teamName===nv);setPSI(prev=>{const arr=[...prev.recruiting];[arr[i],arr[si]]=[arr[si],arr[i]];return{...prev,recruiting:arr};});}} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"5px 8px",fontFamily:ff,fontSize:12}}>{teamNames.map(t=><option key={t} value={t}>{t}</option>)}</select>{i<5&&<span style={{fontSize:11,color:"#007a00",fontWeight:700}}>+{RECRUITING_PTS[i]}</span>}</div>)}</div>
        <div style={{marginBottom:12}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Heisman Winner</div><select value={postSeasonInputs.heisman} onChange={e=>setPSI(prev=>({...prev,heisman:e.target.value}))} style={{background:"#fff",color:"#111",border:"1px solid #ccc",borderRadius:2,padding:"6px 10px",fontFamily:ff,fontSize:13}}><option value="">-- None --</option>{teamNames.map(t=><option key={t} value={t}>{t} ({entries.find(e=>e.teamName===t)?.userName})</option>)}</select></div>
        <div style={{marginBottom:16}}><div style={{fontSize:12,color:"#555",marginBottom:6,fontWeight:600}}>Gained Prestige Star (+10)</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{teamNames.map(t=><button key={t} onClick={()=>setPSI(prev=>({...prev,prestigeGains:prev.prestigeGains.includes(t)?prev.prestigeGains.filter(x=>x!==t):[...prev.prestigeGains,t]}))} style={{padding:"4px 10px",borderRadius:2,border:"1px solid",borderColor:postSeasonInputs.prestigeGains.includes(t)?"#007a00":"#ddd",background:postSeasonInputs.prestigeGains.includes(t)?"#f0f8f0":"#fff",color:postSeasonInputs.prestigeGains.includes(t)?"#007a00":"#888",cursor:"pointer",fontSize:12,fontFamily:ff,fontWeight:600}}>{t}</button>)}</div></div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button onClick={applyPostSeason} style={{background:RED,color:"#fff",border:"none",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Apply Post Season Points</button>
          <button onClick={finalizeSeason} style={{background:"#fff",color:"#007a00",border:"2px solid #007a00",borderRadius:2,padding:"11px 20px",cursor:"pointer",fontFamily:ff,fontSize:13,fontWeight:800,textTransform:"uppercase"}}>Finalize & Start Season {season+1} →</button>
        </div>
      </div></Card>}
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
    const r = reporter;
    const byline = `You are ${r.name}, ${r.title} for Dynasty Central covering the "${leagueName}" dynasty. Your writing style is ${r.style}\n\nAlways sign your articles with your name and title at the end.\n\n`;

    const scheduleContext = upcomingSchedule ? `\n\nUPCOMING SCHEDULE:\n${upcomingSchedule}` : "";
    const prompts = {
      powerrankings: `${byline}Write weekly power rankings after Season ${season} Week ${week-1}.\n\nCurrent points standings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}${scheduleContext}\n\nRank all ${entries.length} teams 1-${entries.length} with a punchy 2-3 sentence blurb each. Reference actual matchups and upcoming schedules. Rankings can differ from points based on momentum and schedule difficulty. Be opinionated. Format as:\n1. [Team] — [blurb]\n2. etc.`,

      preview: `${byline}Write a Week ${week} game preview article for the "${leagueName}" dynasty, Season ${season}.\n\nCurrent standings:\n${standingsText}\n\nTHIS WEEK'S ACTUAL MATCHUPS:\n${thisWeekMatchups}\n\nWrite 400 words previewing the actual scheduled matchups above. Discuss storylines, what's at stake for each team, who has the edge. Reference the real games — do not make up different matchups. Write in your distinct voice.`,

      recap: `${byline}Write a dramatic weekly recap for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings after this week:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}\n\nWrite 400 words recapping last week's actual games. Make up exciting scores and game details for the real matchups listed above. Highlight upsets, dominant performances, and dynasty implications. Write in your distinct voice.`,

      seasonpreview: `${byline}Write a Season ${season} (${START_YEAR+season-1}) preview for the "${leagueName}" dynasty.\n\nTeams:\n${entries.map(e=>e.teamName).join("\n")}\n${history.length>0?`\nDefending champion: ${history[history.length-1].champion}`:"This is the inaugural season."}\n${upcomingSchedule?`\nEarly schedule:\n${upcomingSchedule}`:""}\n\nWrite 450 words previewing the season. Give each team a one-line outlook, predict a champion, name dark horses and sleepers, and build excitement. Write in your distinct voice.`,

      hotakes: `${byline}Write a spicy hot takes column for Season ${season} Week ${week-1} of the "${leagueName}" dynasty.\n\nStandings:\n${standingsText}\n\nLast week's matchups:\n${lastWeekMatchups}\n\nWrite 5 bold, controversial hot takes. Reference real matchups and team names. Each take 2-3 sentences, provocative and specific. Number 1-5. Write in your distinct voice.`,
    };

    try {
      const text = await callClaude(prompts[type]);
      const labels = {powerrankings:"📊 Power Rankings",preview:"🔭 Week Preview",recap:"📰 Weekly Recap",seasonpreview:"🏈 Season Preview",hotakes:"🔥 Hot Takes"};
      const label = labels[type]||"📰 Article";
      const newArticles = [{id:Date.now(),type,label,week,season,text,reporter:r.name,reporterColor:r.color,reporterAvatar:r.avatar},...articles].slice(0,30);
      setArticles(newArticles);
      dbSave({articles:newArticles});
    } catch(e) {
      alert("Error: "+e.message);
    }
    setGenerating(null);
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
          <div style={{padding:"12px 16px",fontSize:13,color:"#555",lineHeight:1.6}}>{a.text.slice(0,180)}...</div>
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
                <div style={{fontSize:13,fontWeight:700,color:"#111",lineHeight:1.4}}>{a.text.slice(0,80).trim()}...</div>
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
            {sorted.map((t,i)=><div key={t.teamName} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,fontWeight:800,color:i===0?RED:"#bbb",width:18,textAlign:"right"}}>{i+1}</span><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:"#111",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.teamName}</div></div><span style={{fontSize:13,fontWeight:900,color:i===0?RED:"#333",flexShrink:0}}>{calcT(t)}</span></div>)}
          </div></Card>
    </div>
  );
}


export default function App() {
  const [setup,setSetup] = useState(null);
  const [tab,setTab] = useState("Standings");
  const [season,setSeason] = useState(1);
  const [week,setWeek] = useState(1);
  const [entries,setEntries] = useState([]);
  const [history,setHistory] = useState([]);
  const [weekResults,setWeekResults] = useState([]);
  const [postSeasonInputs,setPSI] = useState(null);
  const [imageFile,setImageFile] = useState(null);
  const [imagePreview,setImagePreview] = useState(null);
  const [processingImage,setProcessingImage] = useState(false);
  const [imageResult,setImageResult] = useState("");
  const [parsedFromImage,setParsedFromImage] = useState([]);
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
        if (row.setup) setSetup(row.setup);
        if (row.season) setSeason(row.season);
        if (row.week) setWeek(row.week);
        if (row.entries) { if (row.entries.length) setEntries(row.entries); }
        if (row.history) { if (row.history.length) setHistory(row.history); }
        if (row.post_season_inputs) setPSI(row.post_season_inputs);
        if (row.articles) { if (row.articles.length) setArticles(row.articles); }
        if (row.schedule) setSchedule(row.schedule);
        const hasEntries = row.entries ? row.entries.length > 0 : false;
        if (hasEntries) {
          setWeekResults(row.entries.map(function(e) { return {teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false}; }));
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
  const stateRef = { setup, season, week, entries, history, postSeasonInputs, articles, schedule };
  async function saveToDb(overrides) {
    var ovr = overrides || {};
    var data = {
      setup: ovr.setup !== undefined ? ovr.setup : stateRef.setup,
      season: ovr.season !== undefined ? ovr.season : stateRef.season,
      week: ovr.week !== undefined ? ovr.week : stateRef.week,
      entries: ovr.entries !== undefined ? ovr.entries : stateRef.entries,
      history: ovr.history !== undefined ? ovr.history : stateRef.history,
      post_season_inputs: ovr.post_season_inputs !== undefined ? ovr.post_season_inputs : stateRef.postSeasonInputs,
      articles: ovr.articles !== undefined ? ovr.articles : stateRef.articles,
      schedule: ovr.schedule !== undefined ? ovr.schedule : stateRef.schedule,
    };
    try { await dbSave(data); setLastSaved(new Date()); }
    catch(err) { console.error("Save failed:", err); }
  }

  function handleStart(leagueName,rows) {
    const initial=rows.map(r=>INITIAL_ENTRY(r.userName.trim(),r.teamName.trim()));
    const newSetup={leagueName,rows};
    const newPSI={confStandings:initial.map((e,i)=>({teamName:e.teamName,rank:i+1})),confChamp:{made:[],winner:""},bowls:initial.map(e=>({teamName:e.teamName,bowl:"none"})),recruiting:initial.map((e,i)=>({teamName:e.teamName,rank:i+1})),heisman:"",prestigeGains:[],maxPrestige:[]};
    setSetup(newSetup);setEntries(initial);setSeason(1);setWeek(1);
    setWeekResults(initial.map(e=>({teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false})));
    setPSI(newPSI);
    dbSave({setup:newSetup,season:1,week:1,entries:initial,history:[],post_season_inputs:newPSI,articles:[]});
  }

  const sorted=[...entries].sort((a,b)=>calcTotal(b)-calcTotal(a));
  const leader=sorted[0]?calcTotal(sorted[0]):0;
  const teamNames=entries.map(e=>e.teamName);
  const leagueName=setup?.leagueName||"Dynasty Central";

  function applyWeekResults() {
    const thisWeekSchedule = schedule[week] || {};
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
        const log={week,result:effectiveResult,ranked25:effectiveR25,ranked10:effectiveR10,pts:pts+bonus,opponent:opp||"Unknown"};
        // Update H2H if opponent is a dynasty member
        const h2h={...entry.h2h||{}};
        if(opp&&opp!=="CPU"&&opp!=="BYE"){
          if(!h2h[opp])h2h[opp]={wins:0,losses:0};
          if(effectiveResult==="win")h2h[opp].wins++;
          else if(effectiveResult==="loss")h2h[opp].losses++;
        }
        return{...entry,wins:effectiveResult==="win"?entry.wins+1:entry.wins,losses:effectiveResult==="loss"?entry.losses+1:entry.losses,gamePts:entry.gamePts+pts,rankedBonusPts:entry.rankedBonusPts+bonus,weekLog:[...(entry.weekLog||[]),log],h2h};
      });
    });
    setWeekResults(prev=>prev.map(r=>({...r,result:"none",ranked25:false,ranked10:false})));
    const newWeek=week+1;
    setWeek(newWeek);
    setTimeout(()=>saveToDb({week:newWeek}),100);
  }

  function applyImageResults() {
    if(!parsedFromImage.length)return;
    setEntries(prev=>prev.map(entry=>{
      const r=parsedFromImage.find(p=>p.teamName.toLowerCase()===entry.teamName.toLowerCase());
      if(!r)return entry;
      let pts=0,bonus=0;
      if(r.result==="win"){pts=15;bonus=r.ranked10?10:r.ranked25?5:0;}
      const log={week,result:r.result,ranked25:r.ranked25,ranked10:r.ranked10,pts:pts+bonus};
      return{...entry,wins:r.result==="win"?entry.wins+1:entry.wins,losses:r.result==="loss"?entry.losses+1:entry.losses,gamePts:entry.gamePts+pts,rankedBonusPts:entry.rankedBonusPts+bonus,weekLog:[...(entry.weekLog||[]),log]};
    }));
    const newWeek = week+1;
    setWeek(newWeek);setParsedFromImage([]);setImageResult("");setImagePreview(null);setImageFile(null);
    setTimeout(() => saveToDb({week: newWeek}), 100);
  }

  function applyPostSeason() {
    if(!postSeasonInputs)return;
    setEntries(prev=>prev.map(entry=>{
      const si=postSeasonInputs.confStandings.findIndex(s=>s.teamName===entry.teamName);
      const sp=si>=0?(CONF_STAND_PTS[si]||0):0;
      let cc=0;if(postSeasonInputs.confChamp.made.includes(entry.teamName))cc+=10;if(postSeasonInputs.confChamp.winner===entry.teamName)cc+=15;
      const be=postSeasonInputs.bowls.find(b=>b.teamName===entry.teamName);
      let bp=0;if(be?.bowl==="made")bp=5;if(be?.bowl==="won")bp=15;if(be?.bowl==="cfp")bp=15;if(be?.bowl==="cfpwon")bp=40;
      const ri=postSeasonInputs.recruiting.findIndex(r=>r.teamName===entry.teamName);
      const rp=ri>=0?(RECRUITING_PTS[ri]||0):0;
      let pp=0;if(postSeasonInputs.prestigeGains.includes(entry.teamName))pp+=10;
      const hp=postSeasonInputs.heisman===entry.teamName?15:0;
      return{...entry,confStandPts:entry.confStandPts+sp,confChampPts:entry.confChampPts+cc,bowlPts:entry.bowlPts+bp,recruitingPts:entry.recruitingPts+rp,prestigePts:entry.prestigePts+pp,heismanPts:entry.heismanPts+hp};
    }));
    setTimeout(() => saveToDb(), 200);
  }

  function finalizeSeason() {
    const year=START_YEAR+season-1;
    const fin=entries.map(e=>({...e}));
    const srt=[...fin].sort((a,b)=>calcTotal(b)-calcTotal(a));
    setHistory(prev=>[...prev,{year,seasonNum:season,finalStandings:fin,champion:srt[0]?.userName||"",confChampion:postSeasonInputs?.confChamp.winner||"",heisman:postSeasonInputs?.heisman||""}]);
    const fresh=entries.map(e=>INITIAL_ENTRY(e.userName,e.teamName));
    setEntries(fresh);setWeek(1);setSeason(s=>s+1);
    setWeekResults(fresh.map(e=>({teamName:e.teamName,userName:e.userName,result:"none",ranked25:false,ranked10:false})));
    const newPSI={confStandings:fresh.map((e,i)=>({teamName:e.teamName,rank:i+1})),confChamp:{made:[],winner:""},bowls:fresh.map(e=>({teamName:e.teamName,bowl:"none"})),recruiting:fresh.map((e,i)=>({teamName:e.teamName,rank:i+1})),heisman:"",prestigeGains:[],maxPrestige:[]};
    setPSI(newPSI);
    const newSeason = season+1;
    dbSave({season:newSeason, week:1, entries:fresh, post_season_inputs:newPSI});
  }

  async function handleImageUpload(e) {
    const file=e.target.files[0];if(!file)return;
    setImageFile(file);const reader=new FileReader();reader.onload=ev=>setImagePreview(ev.target.result);reader.readAsDataURL(file);
    setParsedFromImage([]);setImageResult("");
  }

  async function processImage() {
    if(!imageFile||!entries.length)return;
    setProcessingImage(true);setParsedFromImage([]);
    const teamList=entries.map(e=>`${e.teamName} (user: ${e.userName})`).join(", ");
    try {
      setImageResult("Reading image...");
      const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=ev=>res(ev.target.result.split(",")[1]);r.onerror=()=>rej(new Error("Read failed"));r.readAsDataURL(imageFile);});
      setImageResult("Sending to Claude...");
      const response=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:{data:base64,media_type:imageFile.type||"image/jpeg"},prompt:`CF27 Scores screen. Dynasty teams: ${teamList}. For each visible team determine win/loss from score. Return ONLY raw JSON array:\n[{"teamName":"Troy","result":"win","ranked25":false,"ranked10":false}]\nOnly include dynasty teams you can see.`,max_tokens:1000})});
      if(!response.ok){const t=await response.text();setImageResult(`❌ API error ${response.status}: ${t.slice(0,200)}`);setProcessingImage(false);return;}
      const data=await response.json();if(data.error){setImageResult(`❌ ${data.error}`);setProcessingImage(false);return;}
      const text=data.text||"";
      if(!text){setImageResult("❌ Empty response.");setProcessingImage(false);return;}
      try{const m=text.replace(/```json|```/g,"").trim().match(/\[[\s\S]*\]/);const parsed=JSON.parse(m?m[0]:text);if(!Array.isArray(parsed)||!parsed.length){setImageResult("⚠️ No dynasty teams found. Enter manually. Claude saw: "+text.slice(0,200));}else{setParsedFromImage(parsed);setImageResult(`✅ Found ${parsed.length} result(s) — review and apply below.`);}}catch{setImageResult("⚠️ Could not parse. Enter manually. Claude said: "+text.slice(0,200));}
    }catch(err){setImageResult("❌ "+err.message);}
    setProcessingImage(false);
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
    <div style={{minHeight:"100vh",background:"#f0f0f0",color:"#111",fontFamily:ff,overflowX:"hidden",maxWidth:"100vw"}}>
      {/* Top black bar */}
      <div style={{background:"#111",padding:"0 12px",height:44,display:"flex",alignItems:"center",gap:10,position:"sticky",top:0,zIndex:200}}>
        <div style={{fontSize:22,fontWeight:900,color:"#fff",fontStyle:"italic",letterSpacing:-1,flexShrink:0}}>ESPN</div>
        <div style={{width:1,height:20,background:"#444",flexShrink:0}}/>
        <div style={{fontSize:isMobile?9:12,color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{leagueName}</div>
        <div style={{display:"flex",gap:isMobile?8:14,alignItems:"center",flexShrink:0}}>
          {[["S",season],["YR",START_YEAR+season-1],["WK",week>12?"PS":week]].map(([l,v])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:7,color:"#666",letterSpacing:1,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:isMobile?13:15,fontWeight:900,color:"#fff",lineHeight:1}}>{v}</div></div>)}
        </div>
      </div>

      {/* Nav tabs */}
      <div style={{background:RED,display:"flex",alignItems:"center",overflowX:"auto"}}>
        {["Standings","History","Profiles","Rules"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:isMobile?"1 0 auto":"none",padding:isMobile?"0 12px":"0 14px",height:40,background:tab===t?"rgba(255,255,255,0.18)":"transparent",border:"none",borderBottom:tab===t?"3px solid #fff":"3px solid transparent",color:"#fff",cursor:"pointer",fontSize:isMobile?11:11,fontWeight:tab===t?800:500,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{t}</button>
        ))}
      </div>

      {/* Scores ticker */}
      <div style={{background:"#1a1a1a",borderBottom:"2px solid #cc0000",padding:isMobile?"5px 10px":"6px 16px",display:"flex",gap:0,overflowX:"auto",alignItems:"center"}}>
        <span style={{fontSize:8,color:RED,fontWeight:800,textTransform:"uppercase",letterSpacing:1.5,marginRight:10,flexShrink:0}}>SCORES</span>
        {sorted.length===0&&<span style={{fontSize:11,color:"#666",fontStyle:"italic"}}>Season not started</span>}
        {sorted.map((t,i)=>(
          <div key={t.teamName} style={{display:"flex",alignItems:"center",gap:5,padding:"0 10px",borderRight:"1px solid #333",flexShrink:0}}>
            <span style={{fontSize:9,fontWeight:800,color:i===0?RED:"#555",width:10}}>{i+1}</span>
            <span style={{fontSize:isMobile?10:11,fontWeight:700,color:"#fff",whiteSpace:"nowrap"}}>{t.teamName}</span>
            <span style={{fontSize:isMobile?11:13,fontWeight:900,color:i===0?"#e8c84a":"#999",marginLeft:3}}>{calcTotal(t)}</span>
          </div>
        ))}
      </div>

      {/* Mobile top strip - quick stats */}
      {isMobile&&sorted.length>0&&(
        <div style={{background:"#fff",borderBottom:"1px solid #eee",padding:"10px 12px",display:"flex",gap:0,overflowX:"auto"}}>
          {sorted.slice(0,6).map((t,i)=>(
            <div key={t.teamName} style={{flexShrink:0,textAlign:"center",padding:"0 10px",borderRight:"1px solid #f0f0f0",minWidth:60}}>
              <div style={{fontSize:9,color:i===0?RED:"#aaa",fontWeight:800,textTransform:"uppercase"}}>{i===0?"LEAD":`#${i+1}`}</div>
              <div style={{fontSize:11,fontWeight:700,color:"#111",marginTop:1,whiteSpace:"nowrap",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis"}}>{t.teamName.split(" ")[0]}</div>
              <div style={{fontSize:13,fontWeight:900,color:i===0?RED:"#333"}}>{calcTotal(t)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main layout */}
      <div style={{maxWidth:1180,margin:"0 auto",padding:isMobile?"8px 8px":"16px 12px",display:"grid",gridTemplateColumns:isMobile?"1fr":"200px 1fr 260px",gap:isMobile?10:16,alignItems:"start"}}>

        {/* Left sidebar - desktop only */}
        {isMobile?null:<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card><CardHead>Dynasty Info</CardHead><div style={{padding:"8px 0"}}>{[["Season",season],["Year",START_YEAR+season-1],["Week",week>12?"Post":week],["Teams",entries.length]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #f5f5f5"}}><span style={{fontSize:12,color:"#888"}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:"#111"}}>{v}</span></div>)}</div></Card>
          <Card><CardHead>Quick Links</CardHead><div style={{padding:"4px 0"}}>{["Standings","History","Profiles","Rules"].map(l=><div key={l} onClick={()=>setTab(l)} style={{padding:"8px 12px",fontSize:12,color:RED,cursor:"pointer",borderBottom:"1px solid #f5f5f5",fontWeight:500}}>🏈 {l}</div>)}</div></Card>
          <Card><CardHead bg={RED}>Points Leader</CardHead>{sorted.length===0?<div style={{padding:"14px 12px",textAlign:"center",color:"#bbb",fontSize:12}}>Not started</div>:sorted.slice(0,1).map(t=><div key={t.teamName} style={{padding:"14px 12px",textAlign:"center"}}><div style={{fontSize:26,fontWeight:900,color:RED}}>{calcTotal(t)}</div><div style={{fontSize:14,fontWeight:700,color:"#111",marginTop:2}}>{t.teamName}</div><div style={{fontSize:11,color:"#555",marginTop:4}}>{t.wins}W - {t.losses}L</div></div>)}</Card>
        </div>}

        {/* Center content */}
        <div style={{display:"flex",flexDirection:"column",gap:isMobile?10:14}}>

          {/* Page header - compact on mobile */}
          <Card style={{padding:isMobile?"10px 12px":"14px 16px",borderLeft:`4px solid ${RED}`}}>
            <div style={{fontSize:isMobile?15:18,fontWeight:900,color:"#111",textTransform:"uppercase"}}>{tab==="Standings"?"Dynasty Standings":tab==="History"?"Season History":tab==="Profiles"?"Player Profiles":"Points System Rules"}</div>
            <div style={{fontSize:10,color:"#888",marginTop:2}}>{leagueName} · S{season} · {START_YEAR+season-1} · {week>12?"Post":`Wk ${week}`}</div>
          </Card>

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
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{articles[0].text.slice(0,70)}...</div>
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
                      {(isMobile?["RK","SCHOOL","PTS","BACK","W","L"]:["RK","SCHOOL","PTS","BACK","W","L","GAME","BONUS","CONF","CC","BOWL","REC","AWD"]).map(h=>(
                        <th key={h} style={{padding:isMobile?"8px 6px":"9px 7px",textAlign:h==="SCHOOL"?"left":"center",color:"#555",fontSize:8,letterSpacing:1,textTransform:"uppercase",fontWeight:800,whiteSpace:"nowrap",borderRight:"1px solid #eee"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{sorted.map((t,i)=>{const tot=calcTotal(t);const beh=leader-tot;return(
                      <tr key={t.teamName} style={{borderBottom:"1px solid #eee",background:i===0?"#fff8f8":i%2===0?"#fafafa":"#fff"}}>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",fontWeight:900,fontSize:isMobile?13:14,color:i===0?RED:"#bbb",borderRight:"1px solid #eee"}}>{i+1}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",fontWeight:i===0?800:600,color:"#111",whiteSpace:"nowrap",borderRight:"1px solid #eee",maxWidth:isMobile?90:140,overflow:"hidden",textOverflow:"ellipsis"}}>{t.teamName}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",fontWeight:900,color:i===0?RED:"#111",fontSize:isMobile?14:16,background:i===0?"#fff0f0":"transparent",borderRight:"2px solid #ddd"}}>{tot}</td>
                        <td style={{padding:isMobile?"8px 6px":"10px 7px",textAlign:"center",color:beh===0?"#007a00":RED,fontWeight:700,fontSize:isMobile?11:12,borderRight:isMobile?"none":"2px solid #ddd",whiteSpace:"nowrap"}}>{beh===0?"-":isMobile?`-${beh}`:`-${beh}`}</td>
                        {isMobile?null:<><td style={{padding:"10px 7px",textAlign:"center",color:"#007a00",fontWeight:700,borderRight:"1px solid #eee"}}>{t.wins}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",color:RED,fontWeight:700,borderRight:"1px solid #eee"}}>{t.losses}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.gamePts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",color:"#cc7700",fontWeight:700,borderRight:"1px solid #eee"}}>{t.rankedBonusPts>0?`+${t.rankedBonusPts}`:"—"}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.confStandPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.confChampPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.bowlPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center",borderRight:"1px solid #eee"}}>{t.recruitingPts}</td>
                        <td style={{padding:"10px 7px",textAlign:"center"}}>{t.prestigePts+t.heismanPts}</td></>}
                        {isMobile&&<><td style={{padding:"8px 6px",textAlign:"center",color:"#007a00",fontWeight:700}}>{t.wins}</td>
                        <td style={{padding:"8px 6px",textAlign:"center",color:RED,fontWeight:700}}>{t.losses}</td></>}
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
                        <div style={{fontSize:12,fontWeight:700,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{a.text.slice(0,60)}...</div>
                      </div>
                      <div style={{color:"#ccc",fontSize:16,flexShrink:0}}>›</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>)}

          {tab==="History"&&<HistoryTab history={history}/>}
          {tab==="Profiles"&&<ProfileTab history={history} setupRows={setup?.rows||[]} currentEntries={entries} season={season}/>}
          {tab==="Rules"&&<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
            {[["🏈 Regular Season",[["Win","15 pts"],["Win vs Top 25","+5 bonus"],["Win vs Top 10","+10 bonus"],["Loss","0 pts"]]],["📊 Conference Standings",[["1st","50"],["2nd","43"],["3rd","36"],["4th","30"],["5th","24"],["6th","18"],["7th","14"],["8th","10"],["9th","7"],["10th","5"],["11th","3"],["12th","1"]]],["🏆 Conference Championship",[["Make the Game","10 pts"],["Win the Game","15 pts"]]],["🥣 Bowl & Playoff",[["Make a Bowl","5 pts"],["Win a Bowl","10 pts"],["Make the CFP","15 pts"],["Win National Championship","25 pts"]]],["🎓 Recruiting (Top 5)",[["#1","15 pts"],["#2","10 pts"],["#3","7 pts"],["#4","5 pts"],["#5","3 pts"]]],["⭐ Prestige & Awards",[["Gain a Prestige Star","10 pts"],["Reach Max Prestige","10 pts"],["Heisman Winner","15 pts"]]]].map(([title,rows])=><Card key={title} style={{overflow:"hidden"}}><CardHead bg={RED}>{title}</CardHead><table style={{width:"100%",borderCollapse:"collapse"}}><tbody>{rows.map(([l,p])=><tr key={l} style={{borderBottom:"1px solid #f0f0f0"}}><td style={{padding:"8px 12px",color:"#333",fontSize:13}}>{l}</td><td style={{padding:"8px 12px",textAlign:"right",color:RED,fontWeight:800,fontSize:13}}>{p}</td></tr>)}</tbody></table></Card>)}
          </div>}
        </div>

        {/* Right rail - desktop only */}
        {!isMobile&&<RightRail sorted={sorted} articles={articles} entries={entries} week={week} season={season} leader={leader} setActiveArticle={setActiveArticle}/>}
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
          {["Enter Results","Schedule","Content","League Setup"].map(t=><button key={t} onClick={()=>setCommTab(t)} style={{padding:"11px 18px",background:"transparent",border:"none",borderBottom:commTab===t?`3px solid ${RED}`:"3px solid transparent",color:commTab===t?"#fff":"#888",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:ff,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{t}</button>)}
        </div>
        <div style={{maxWidth:800,margin:"0 auto",padding:"20px 14px"}}>
          {commTab==="Enter Results"&&<EnterResultsPanel entries={entries} weekResults={weekResults} setWeekResults={setWeekResults} week={week} imageFile={imageFile} imagePreview={imagePreview} processingImage={processingImage} imageResult={imageResult} parsedFromImage={parsedFromImage} handleImageUpload={handleImageUpload} processImage={processImage} applyImageResults={applyImageResults} setParsedFromImage={setParsedFromImage} applyWeekResults={applyWeekResults} postSeasonInputs={postSeasonInputs} setPSI={setPSI} applyPostSeason={applyPostSeason} finalizeSeason={finalizeSeason} season={season} teamNames={teamNames} schedule={schedule}/>}
          {commTab==="Schedule"&&<SchedulePanel entries={entries} schedule={schedule} setSchedule={setSchedule}/>}
          {commTab==="Content"&&<ContentHub sorted={sorted} entries={entries} week={week} season={season} leagueName={leagueName} history={history} leader={leader} articles={articles} setArticles={setArticles} setActiveArticle={setActiveArticle} schedule={schedule}/>}
          {commTab==="League Setup"&&<SetupPanel entries={entries} setup={setup} postSeasonInputs={postSeasonInputs} setPSI={setPSI} handleStart={handleStart} setCommissionerUnlocked={setCommUnlocked} season={season} setEntries={setEntries} setWeekResults={setWeekResults} setSetup={setSetup}/>}
        </div>
      </div>}
    </div>
  );
}
