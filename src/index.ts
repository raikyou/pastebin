const ONE_DAY_SECONDS = 86400;
const ID_LENGTH = 6;
const MAX_PASTE_SIZE = 1024 * 512; // 512 KB

function generateId(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface PasteData {
  content: string;
  passwordHash: string | null;
  createdAt: number;
}

// ─── API Handlers ──────────────────────────────────────────

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ content: string; password?: string }>();

  if (!body.content || typeof body.content !== "string") {
    return Response.json({ error: "Content is required" }, { status: 400 });
  }

  if (body.content.length > MAX_PASTE_SIZE) {
    return Response.json({ error: "Content too large (max 512 KB)" }, { status: 413 });
  }

  const id = generateId();
  const passwordHash = body.password ? await hashPassword(body.password) : null;

  const paste: PasteData = {
    content: body.content,
    passwordHash,
    createdAt: Date.now(),
  };

  await env.PASTES.put(id, JSON.stringify(paste), { expirationTtl: ONE_DAY_SECONDS });

  const url = new URL(request.url);
  return Response.json({ id, url: `${url.origin}/${id}` });
}

async function handleGet(id: string, request: Request, env: Env): Promise<Response> {
  const raw = await env.PASTES.get(id);
  if (!raw) {
    return Response.json({ error: "Paste not found or expired" }, { status: 404 });
  }

  const paste: PasteData = JSON.parse(raw);

  if (paste.passwordHash) {
    const url = new URL(request.url);
    const password = url.searchParams.get("p");
    if (!password) {
      return Response.json({ error: "Password required", protected: true }, { status: 401 });
    }
    const hash = await hashPassword(password);
    if (hash !== paste.passwordHash) {
      return Response.json({ error: "Wrong password", protected: true }, { status: 403 });
    }
  }

  return Response.json({
    content: paste.content,
    createdAt: paste.createdAt,
    expiresIn: ONE_DAY_SECONDS - Math.floor((Date.now() - paste.createdAt) / 1000),
  });
}

// ─── HTML Pages ────────────────────────────────────────────

function page(body: string, title = "paste"): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f6f4f0;--surface:#ffffff;--border:#e0ddd6;
  --text:#2c2a25;--dim:#8a8680;--accent:#c44820;--accent2:#b07020;
  --red:#c43030;--green:#2a7a48;
  --mono:'JetBrains Mono',monospace;--sans:'DM Sans',sans-serif;
  --radius:10px;--shadow:0 1px 3px rgba(0,0,0,.06),0 4px 12px rgba(0,0,0,.04);
}
html{background:var(--bg);color:var(--text);font-family:var(--sans)}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:3rem 1rem}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

.noise{position:fixed;inset:0;z-index:-1;opacity:.025;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:200px}

header{text-align:center;margin-bottom:2.5rem;animation:fadeIn .5s ease}
header h1{font-family:var(--mono);font-size:1.6rem;font-weight:700;letter-spacing:-.02em;color:var(--text)}
header h1 span{color:var(--accent)}
header p{color:var(--dim);font-size:.85rem;margin-top:.4rem}

.card{
  width:100%;max-width:640px;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:1.5rem;box-shadow:var(--shadow);
  animation:slideUp .4s ease;
}

textarea{
  width:100%;min-height:220px;resize:vertical;
  background:var(--bg);color:var(--text);
  border:1px solid var(--border);border-radius:var(--radius);
  padding:1rem;font-family:var(--mono);font-size:.875rem;line-height:1.6;
  transition:border-color .2s;
}
textarea:focus{outline:none;border-color:var(--accent)}
textarea::placeholder{color:var(--dim)}

.row{display:flex;gap:.75rem;margin-top:1rem;align-items:center;flex-wrap:wrap}
.row label{color:var(--dim);font-size:.8rem;font-family:var(--mono)}

input[type="password"],input[type="text"]{
  background:var(--bg);color:var(--text);
  border:1px solid var(--border);border-radius:var(--radius);
  padding:.5rem .75rem;font-family:var(--mono);font-size:.85rem;min-width:220px;flex:1;
  transition:border-color .2s;
}
input:focus{outline:none;border-color:var(--accent)}

button{
  background:var(--accent);color:#fff;
  border:none;border-radius:var(--radius);
  padding:.6rem 1.5rem;font-family:var(--mono);font-size:.85rem;font-weight:700;
  cursor:pointer;transition:transform .1s,background .15s;
  margin-left:auto;
}
button:hover{background:#a93d18}
button:active{transform:scale(.97)}
button:disabled{opacity:.4;cursor:not-allowed}

.result{
  margin-top:1rem;padding:1rem;
  background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
  display:none;
}
.result.show{display:block;animation:slideUp .3s ease}
.result .url{
  font-family:var(--mono);font-size:.95rem;font-weight:500;color:var(--green);
  word-break:break-all;
}
.result .meta{color:var(--dim);font-size:.75rem;margin-top:.5rem;font-family:var(--mono)}

.copied{color:var(--accent);font-size:.75rem;font-family:var(--mono);margin-top:.35rem;opacity:0;transition:opacity .2s}
.copied.show{opacity:1}

/* View page */
.content-box{
  background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
  padding:1rem;font-family:var(--mono);font-size:.875rem;line-height:1.6;
  white-space:pre-wrap;word-break:break-word;max-height:70vh;overflow-y:auto;
}
.expire-tag{
  display:inline-block;font-family:var(--mono);font-size:.7rem;
  color:var(--accent2);border:1px solid var(--accent2);border-radius:4px;
  padding:.15rem .5rem;margin-bottom:1rem;
}
.error{color:var(--red);font-family:var(--mono);font-size:.9rem;text-align:center;padding:2rem}
.pw-form{display:flex;flex-direction:column;gap:.75rem;align-items:center;padding:1.5rem}
.pw-form p{color:var(--dim);font-size:.85rem;font-family:var(--mono)}

.back{display:inline-block;margin-top:1.5rem;font-family:var(--mono);font-size:.8rem;color:var(--dim)}
.back:hover{color:var(--accent)}

.content-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem}
.copy-btn{
  display:inline-flex;align-items:center;gap:.35rem;
  background:var(--bg);border:1px solid var(--border);border-radius:6px;
  padding:.3rem .6rem;font-family:var(--mono);font-size:.7rem;color:var(--dim);
  cursor:pointer;transition:color .15s,border-color .15s;
}
.copy-btn:hover{color:var(--accent);border-color:var(--accent)}
.copy-btn svg{width:14px;height:14px}

@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="noise"></div>
<header>
  <h1><span>/</span>paste</h1>
  <p>ephemeral sharing &mdash; expires in 24h</p>
</header>
${body}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

function homePage(): Response {
  return page(`
<div class="card">
  <textarea id="content" placeholder="Paste something here..." autofocus></textarea>
  <div class="row">
    <label>password (optional)</label>
    <input type="password" id="password" placeholder="leave empty for public">
    <button id="btn" onclick="submit()">share</button>
  </div>
  <div class="result" id="result">
    <div class="url" id="url"></div>
    <div class="meta" id="meta"></div>
    <div class="copied" id="copied">copied to clipboard</div>
  </div>
</div>
<script>
async function submit(){
  const btn=document.getElementById('btn');
  const content=document.getElementById('content').value.trim();
  if(!content)return;
  btn.disabled=true;btn.textContent='...';
  try{
    const body={content};
    const pw=document.getElementById('password').value;
    if(pw)body.password=pw;
    const r=await fetch('/api/paste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok){alert(d.error);return}
    const el=document.getElementById('url');
    el.textContent=d.url;
    document.getElementById('meta').textContent='expires in 24 hours';
    document.getElementById('result').classList.add('show');
    el.style.cursor='pointer';
    el.onclick=()=>{
      navigator.clipboard.writeText(d.url);
      document.getElementById('copied').classList.add('show');
      setTimeout(()=>document.getElementById('copied').classList.remove('show'),2000);
    };
    navigator.clipboard.writeText(d.url).then(()=>{
      document.getElementById('copied').classList.add('show');
      setTimeout(()=>document.getElementById('copied').classList.remove('show'),2000);
    });
  }catch(e){alert('Something went wrong')}
  finally{btn.disabled=false;btn.textContent='share'}
}
document.getElementById('content').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')submit()});
</script>
  `);
}

function viewPage(id: string): Response {
  return page(`
<div class="card" id="card">
  <div id="loading" style="text-align:center;color:var(--dim);font-family:var(--mono);padding:2rem">loading...</div>
</div>
<a href="/" class="back">&larr; new paste</a>
<script>
const id="${id}";
async function load(pw){
  const q=pw?'?p='+encodeURIComponent(pw):'';
  const r=await fetch('/api/paste/'+id+q);
  const d=await r.json();
  const card=document.getElementById('card');
  if(r.status===401){
    card.innerHTML=\`<div class="pw-form">
      <p>this paste is password-protected</p>
      <input type="password" id="pw" placeholder="enter password" autofocus>
      <button onclick="unlock()">unlock</button>
    </div>\`;
    document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});
    return;
  }
  if(r.status===403){
    card.innerHTML=\`<div class="pw-form">
      <p style="color:var(--red)">wrong password</p>
      <input type="password" id="pw" placeholder="try again" autofocus>
      <button onclick="unlock()">unlock</button>
    </div>\`;
    document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});
    return;
  }
  if(!r.ok){card.innerHTML='<div class="error">'+d.error+'</div>';return}
  const mins=Math.floor(d.expiresIn/60);
  const hrs=Math.floor(mins/60);
  const tag=hrs>0?hrs+'h '+mins%60+'m remaining':mins+'m remaining';
  card.innerHTML='<div class="content-header"><span class="expire-tag">'+tag+'</span><button class="copy-btn" onclick="copyContent()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span id="copy-label">copy</span></button></div><div class="content-box">'+escapeHtml(d.content)+'</div>';
  window._pasteContent=d.content;
}
function copyContent(){
  navigator.clipboard.writeText(window._pasteContent);
  const l=document.getElementById('copy-label');
  l.textContent='copied!';setTimeout(()=>l.textContent='copy',1500);
}
function unlock(){load(document.getElementById('pw').value)}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
load();
</script>
  `, `paste /${id}`);
}

// ─── Router ────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path === "/api/paste" && request.method === "POST") {
      return handleCreate(request, env);
    }

    if (path.startsWith("/api/paste/")) {
      const id = path.slice("/api/paste/".length);
      if (id && request.method === "GET") {
        return handleGet(id, request, env);
      }
    }

    // Pages
    if (path === "/" || path === "") {
      return homePage();
    }

    // Short paste URLs: /<id>
    const match = path.match(/^\/([a-z2-9]{6})$/);
    if (match) {
      return viewPage(match[1]);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
