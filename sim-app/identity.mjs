import { randomBytes, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const random = () => randomBytes(32).toString('base64url');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (res, status, data, headers = {}) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));return true;};
async function body(req) {
  if (req.body !== undefined) {
    const size = Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (size > 32768) throw Object.assign(new Error('Request too large.'), { status: 413 });
    try {
      return typeof req.body === 'string' ? (req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(req.body)) : JSON.parse(req.body || '{}')) : req.body;
    } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
let value='';for await(const chunk of req){value+=chunk;if(value.length>32768)throw Error('Request too large');}return req.headers['content-type']?.includes('application/json')?JSON.parse(value || '{}'):Object.fromEntries(new URLSearchParams(value));}

export async function createIdentityHandler({pool, worldId}) {
  const original=await readFile(new URL('./public/cis2/index.html',import.meta.url),'utf8');
  const style=original.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const page=(res,title,content,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Local Staff Identity</title><style>${style}</style></head><body><main id="main"><div class="container"><img src="/control/brands/staff-identity.svg" width="48" alt="Staff Identity"><h1>${escape(title)}</h1>${content}</div></main><footer class="footer">Fictional staff sign-in · Local copy · No real smartcard or security key</footer></body></html>`);return true;};
  const saved=(await pool.query('SELECT value FROM sim.local_settings WHERE world_id=$1 AND key=$2',[worldId,'cis2'])).rows[0]?.value;
  let settings=saved || {scenario:'normal',tokenLifetimeSeconds:900,clients:null};
  const staff=(await pool.query("SELECT body FROM sim.resources WHERE world_id=$1 AND kind='staff' ORDER BY resource_id LIMIT 100",[worldId])).rows.map(({body:r})=>({sub:r.id,name:r.title,role:r.data?.role || 'staff',organisation:r.data?.department || r.owner}));
  const requests=new Map(),codes=new Map(),tokens=new Map(),sessions=new Map();
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const kid=random();const jwk={...publicKey.export({format:'jwk'}),kid,use:'sig',alg:'RS256'};
  const jwt=claims=>{const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid})).toString('base64url');const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');const input=`${header}.${payload}`;return `${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;};
  const active=(map,key)=>{const record=map.get(key);if(!record || record.expires<=Date.now()){map.delete(key);return null;}return record;};
  const revoke=()=>{requests.clear();codes.clear();tokens.clear();sessions.clear();};
  const cookie=req=>String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('local-cis2='))?.slice(11);
  return async function identity(req,res,url) {
    const path=url.pathname;
    if(!path.startsWith('/cis2/') && path!=='/api/operator/cis2')return false;
    if(path==='/cis2/' || path==='/cis2/index.html')return false;
    const origin=url.origin;
    const clients=()=>settings.clients || [{id:'nhs-sim-client',name:'NHS Simulation local client',redirectUris:[`${origin}/cis2/callback`]}];
    const respondSettings=()=>json(res,200,{...settings,clients:clients(),active:{tokens:[...tokens.values()].filter(t=>t.expires>Date.now()).length,sessions:[...sessions.values()].filter(t=>t.expires>Date.now()).length}});
    const redirect=destination=>{res.writeHead(302,{Location:destination,'Cache-Control':'no-store'});res.end();return true;};
    try {
      if(path==='/cis2/.well-known/openid-configuration')return json(res,200,{issuer:`${origin}/cis2`,authorization_endpoint:`${origin}/cis2/authorize`,token_endpoint:`${origin}/cis2/token`,userinfo_endpoint:`${origin}/cis2/userinfo`,jwks_uri:`${origin}/cis2/jwks`,response_types_supported:['code'],grant_types_supported:['authorization_code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['openid','profile']});
      if(path==='/cis2/jwks' || path==='/cis2/.well-known/jwks.json')return json(res,200,{keys:[jwk]});
      if(path==='/api/operator/cis2'){
        if(req.headers.authorization!=='Bearer local-operator')return json(res,403,{error:'Local operator token required.'});
        if(req.method==='GET')return respondSettings();
        if(req.method==='DELETE'){revoke();return respondSettings();}
        if(req.method==='PUT'){
          const input=await body(req);
          if(!['normal','deny','unavailable','expired-session'].includes(input.scenario)||!Number.isInteger(input.tokenLifetimeSeconds)||input.tokenLifetimeSeconds<30||input.tokenLifetimeSeconds>3600||!Array.isArray(input.clients)||input.clients.some(c=>!c.id||!Array.isArray(c.redirectUris)||c.redirectUris.some(uri=>{try{return !['localhost','127.0.0.1','[::1]'].includes(new URL(uri).hostname);}catch{return true;}})))return json(res,400,{error:'Invalid local identity settings or callback URLs.'});
          settings={scenario:input.scenario,tokenLifetimeSeconds:input.tokenLifetimeSeconds,clients:input.clients};
          await pool.query('INSERT INTO sim.local_settings(world_id,key,value) VALUES($1,$2,$3) ON CONFLICT(world_id,key) DO UPDATE SET value=EXCLUDED.value',[worldId,'cis2',settings]);revoke();return respondSettings();
        }
        return json(res,405,{error:'Method not allowed'});
      }
      if(path==='/cis2/session'){
        if(req.method==='DELETE'){sessions.delete(cookie(req));return json(res,200,{identity:null},{'Set-Cookie':'local-cis2=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
        const session=active(sessions,cookie(req));return json(res,200,{identity:session?.identity || null,authenticated:!!session,expiresAt:session?.expires || null});
      }
      if(path==='/cis2/logout'){
        if(req.method!=='POST')return json(res,405,{error:'Use POST to sign out.'});sessions.delete(cookie(req));return json(res,200,{identity:null},{'Set-Cookie':'local-cis2=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
      }
      if(path==='/cis2/authorize' && req.method==='GET'){
        const p=Object.fromEntries(url.searchParams);const client=clients().find(c=>c.id===p.client_id);
        if(!client?.redirectUris.includes(p.redirect_uri))return page(res,'Invalid application','<p>Client or callback URL is not registered.</p>',400);
        if(p.response_type!=='code'||p.code_challenge_method!=='S256'||!/^[-_A-Za-z0-9]{43}$/.test(p.code_challenge || ''))return json(res,400,{error:'invalid_request',error_description:'Authorization code with PKCE S256 is required.'});
        if(settings.scenario==='unavailable')return page(res,'Identity service unavailable','<p>The local scenario is set to unavailable.</p>',503);
        if(settings.scenario==='deny'){const back=new URL(p.redirect_uri);back.searchParams.set('error','access_denied');if(p.state)back.searchParams.set('state',p.state);return redirect(back.href);}
        const id=random();requests.set(id,{...p,expires:Date.now()+300000});
        return page(res,'Choose a simulated staff member',`<p>This sign-in only identifies a fictional member of staff in the local simulation.</p><form method="post" action="/cis2/authorize"><input type="hidden" name="request" value="${id}"><label class="field"><span>Staff identity</span><select name="identity" required>${staff.map(s=>`<option value="${escape(s.sub)}">${escape(s.name)} · ${escape(s.role)} · ${escape(s.organisation)}</option>`).join('')}</select></label><button class="primary" type="submit" ${staff.length?'':'disabled'}>Continue with selected identity</button></form><p><a href="/cis2/">Cancel sign-in</a></p>`);
      }
      if(path==='/cis2/authorize' && req.method==='POST'){
        const input=await body(req);const pending=active(requests,input.request);const person=staff.find(s=>s.sub===input.identity);
        if(!pending||!person)return json(res,400,{error:'invalid_request',error_description:'Sign-in request expired or identity is unknown.'});
        requests.delete(input.request);const code=random();codes.set(code,{...pending,identity:person,expires:Date.now()+60000});const target=new URL(pending.redirect_uri);target.searchParams.set('code',code);if(pending.state)target.searchParams.set('state',pending.state);return redirect(target.href);
      }
      if(path==='/cis2/token' && req.method==='POST'){
        const input=await body(req);const code=active(codes,input.code);
        if(!code || input.grant_type!=='authorization_code' || input.client_id!==code.client_id || input.redirect_uri!==code.redirect_uri || !/^[-._~A-Za-z0-9]{43,128}$/.test(input.code_verifier || '') || createHash('sha256').update(input.code_verifier || '').digest('base64url')!==code.code_challenge)return json(res,400,{error:'invalid_grant'});
        codes.delete(input.code);const accessToken=random(),session=random();const expires=Date.now()+(settings.scenario==='expired-session'?0:settings.tokenLifetimeSeconds*1000);const record={identity:code.identity,expires};tokens.set(accessToken,record);sessions.set(session,record);
        const now=Math.floor(Date.now()/1000);const claims={iss:`${origin}/cis2`,aud:code.client_id,iat:now,exp:Math.floor(expires/1000),...code.identity,...(code.nonce?{nonce:code.nonce}:{})};
        return json(res,200,{access_token:accessToken,token_type:'Bearer',expires_in:Math.max(0,Math.floor((expires-Date.now())/1000)),id_token:jwt(claims),scope:'openid profile'},{'Set-Cookie':`local-cis2=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${settings.tokenLifetimeSeconds}`});
      }
      if(path==='/cis2/userinfo'){
        const token=active(tokens,req.headers.authorization?.replace(/^Bearer\s+/i,''));return token?json(res,200,token.identity):json(res,401,{error:'invalid_token'});
      }
      if(path==='/cis2/callback')return page(res,'Staff sign-in',`<p id="status" role="status">Completing local sign-in…</p><div id="identity"></div><p><a href="/gp/">Open GP Records</a> · <a href="/control/">Open neighbourhood</a> · <a href="/cis2/">Staff identity</a></p><script>(async()=>{const status=document.getElementById('status');try{const p=new URLSearchParams(location.search);const saved=JSON.parse(sessionStorage.getItem('cis2-demo')||'null');if(!saved||saved.state!==p.get('state'))throw Error('Sign-in state did not match. Start again.');sessionStorage.removeItem('cis2-demo');if(p.get('error'))throw Error(p.get('error'));const response=await fetch('/cis2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'nhs-sim-client',redirect_uri:location.origin+'/cis2/callback',code:p.get('code'),code_verifier:saved.verifier})});const token=await response.json();if(!response.ok)throw Error(token.error);const session=await fetch('/cis2/session').then(r=>r.json());status.textContent=session.identity?'Signed in to the local simulation.':'The simulated session is expired.';document.getElementById('identity').textContent=session.identity?session.identity.name+' · '+session.identity.role:'';history.replaceState(null,'','/cis2/callback');}catch(error){status.textContent=error.message;}})();</script>`);
      return json(res,404,{error:'Local identity endpoint not implemented.'});
    }catch(error){return json(res,400,{error:'invalid_request',message:error.message});}
  };
}
