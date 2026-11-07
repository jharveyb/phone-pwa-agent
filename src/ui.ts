// Chat UI served by the agent itself at GET /ui (plain HTTP on the tailnet, works from any browser/phone on it).
// Talks to the same-origin control API: POST /prompt, GET /events (SSE), GET /state, POST /abort.
export const UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>phone-agent</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0e0f12;color:#e6e6e6;font:15px/1.45 system-ui,sans-serif;display:flex;flex-direction:column;height:100dvh}
header{display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid #26282e;font-size:13px;color:#9aa}
header b{color:#7fd;font-size:15px}#st{margin-left:auto;white-space:nowrap}
main{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.m{max-width:min(820px,95%);padding:10px 13px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
.user{align-self:flex-end;background:#2b4a7a}.bot{align-self:flex-start;background:#1c1f26}.tool{align-self:flex-start;background:#15171c;border:1px solid #2a2d35;font:12.5px/1.4 ui-monospace,monospace;color:#bcc;max-height:260px;overflow:auto}
.tool b{color:#fc6}.err{border-color:#a33}.sys{align-self:center;color:#778;font-size:12px}
form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #26282e;padding-bottom:max(10px,env(safe-area-inset-bottom))}
textarea{flex:1;resize:none;background:#15171c;color:#eee;border:1px solid #2a2d35;border-radius:10px;padding:10px;font:inherit;min-height:44px;max-height:160px}
button{background:#7fd;color:#000;border:0;border-radius:10px;padding:0 16px;font-weight:600}button.sec{background:#2a2d35;color:#ddd}
</style></head><body>
<header><b>phone-agent</b><span id="model"></span><span id="st">connecting…</span></header>
<main id="log"></main>
<form id="f"><textarea id="t" placeholder="Ask the agent on the phone… (Enter to send, Shift+Enter for newline)"></textarea><button class="sec" type="button" id="abort">stop</button><button type="submit">send</button></form>
<script>
const log=document.getElementById('log'),st=document.getElementById('st'),ta=document.getElementById('t'),f=document.getElementById('f');
const add=(cls,html)=>{const d=document.createElement('div');d.className='m '+cls;d.innerHTML=html;log.appendChild(d);log.scrollTop=log.scrollHeight;return d};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let busy=false,current=null,tools={};
function setBusy(b){busy=b;st.textContent=(b?'thinking…':'idle')+(stateTxt?' · '+stateTxt:'')}
let stateTxt='';
async function refreshState(){try{const s=await (await fetch('/state')).json();document.getElementById('model').textContent=s.agent.model||'';stateTxt='up '+s.uptimeS+'s · '+s.agent.messages+' msgs · heap '+(s.memory?s.memory.usedJSHeapMB+'MB':'?');setBusy(!!s.agent.isStreaming)}catch(e){st.textContent='unreachable'}}
function text(msg){return (msg.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('')}
function connect(){const es=new EventSource('/events?since=0');
 es.onopen=()=>{st.textContent='connected'};es.onerror=()=>{st.textContent='reconnecting…'};
 es.addEventListener('hello',e=>{const d=JSON.parse(e.data);(d.state?.agent?.model)&&(document.getElementById('model').textContent=d.state.agent.model)});
 es.addEventListener('message_end',e=>{const m=JSON.parse(e.data).message;if(m.role==='user'){const t=typeof m.content==='string'?m.content:text(m);if(t)add('user',esc(t));}});
 es.addEventListener('turn_start',()=>setBusy(true));
 es.addEventListener('tool_execution_start',e=>{const d=JSON.parse(e.data);tools[d.toolCallId]=add('tool','<b>▶ '+esc(d.toolName)+'</b> '+esc(JSON.stringify(d.args)).slice(0,600))});
 es.addEventListener('tool_execution_end',e=>{const d=JSON.parse(e.data);const out=(d.result?.content?.[0]?.text)||'';const el=tools[d.toolCallId]||add('tool','');el.classList.toggle('err',!!d.isError);el.innerHTML+='\\n'+esc(out.slice(0,2500))+(out.length>2500?'\\n…':'')+' <span style="color:#778">('+(d.durationMs??'?')+'ms)</span>';log.scrollTop=log.scrollHeight});
 es.addEventListener('turn_end',e=>{const d=JSON.parse(e.data);if(d.message?.role==='assistant'){const t=text(d.message);if(t)add('bot',esc(t));}});
 es.addEventListener('agent_end',()=>{setBusy(false);refreshState()});
 es.addEventListener('error',e=>{try{add('tool err','<b>error</b> '+esc(JSON.parse(e.data).text))}catch{}});
 es.addEventListener('heartbeat',()=>{});}
f.onsubmit=async e=>{e.preventDefault();const v=ta.value.trim();if(!v)return;ta.value='';const r=await fetch('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:v})});if(!r.ok)add('sys','prompt rejected: '+await r.text());else setBusy(true)};
ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();f.requestSubmit()}};
document.getElementById('abort').onclick=()=>fetch('/abort',{method:'POST'});
add('sys','pi agent running inside a Chrome tab on the phone · tools: read/write/edit/bash/ls/web_fetch/python');
refreshState();connect();setInterval(refreshState,20000);
</script></body></html>`;
