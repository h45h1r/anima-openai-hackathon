import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {createIdentityHandler} from './identity.mjs';

test('local staff flow validates PKCE, signs tokens, sets session and rejects code replay',async t=>{
  let persisted;
  const pool={query:async(sql,args)=>{
    if(sql.includes('SELECT value'))return {rows:[]};
    if(sql.includes("kind='staff'"))return {rows:[{body:{id:'staff-0',title:'Dr Ada Sim 0',data:{role:'doctor',department:'A&E'}}}]};
    persisted=args[2];return {rows:[]};
  }};
  const handler=await createIdentityHandler({pool,worldId:'test'});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,`http://${req.headers.host}`))){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const verifier='a'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
  const authorization=new URLSearchParams({client_id:'nhs-sim-client',redirect_uri:base+'/cis2/callback',response_type:'code',code_challenge_method:'S256',code_challenge:challenge,state:'test-state',nonce:'test-nonce'});
  const page=await fetch(base+'/cis2/authorize?'+authorization).then(r=>r.text());
  assert.match(page,/Dr Ada Sim 0/);
  const request=page.match(/name="request" value="([^"]+)"/)[1];
  const selected=await fetch(base+'/cis2/authorize',{method:'POST',body:new URLSearchParams({request,identity:'staff-0'}),redirect:'manual'});
  assert.equal(selected.status,302);const callback=new URL(selected.headers.get('location'));assert.equal(callback.searchParams.get('state'),'test-state');
  const fields={grant_type:'authorization_code',client_id:'nhs-sim-client',redirect_uri:base+'/cis2/callback',code:callback.searchParams.get('code'),code_verifier:'b'.repeat(64)};
  const exchange=()=>fetch(base+'/cis2/token',{method:'POST',body:new URLSearchParams(fields)});
  assert.equal((await exchange()).status,400);fields.code_verifier=verifier;
  const response=await exchange();assert.equal(response.status,200);const token=await response.json();
  assert.equal((await exchange()).status,400,'authorization code is single-use');
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const session=await fetch(base+'/cis2/session',{headers:{cookie}}).then(r=>r.json());assert.equal(session.identity.name,'Dr Ada Sim 0');assert.equal(session.identity.role,'doctor');
  const info=await fetch(base+'/cis2/userinfo',{headers:{authorization:'Bearer '+token.access_token}}).then(r=>r.json());assert.equal(info.sub,'staff-0');
  const keys=await fetch(base+'/cis2/jwks').then(r=>r.json());const [head,payload,signature]=token.id_token.split('.');assert.ok(verify('RSA-SHA256',Buffer.from(head+'.'+payload),createPublicKey({key:keys.keys[0],format:'jwk'}),Buffer.from(signature,'base64url')));assert.equal(JSON.parse(Buffer.from(payload,'base64url')).nonce,'test-nonce');
  assert.equal((await fetch(base+'/api/operator/cis2')).status,403);
  const settings={scenario:'deny',tokenLifetimeSeconds:60,clients:[{id:'nhs-sim-client',name:'Local test',redirectUris:[base+'/cis2/callback']}]};
  assert.equal((await fetch(base+'/api/operator/cis2',{method:'PUT',headers:{authorization:'Bearer local-operator','content-type':'application/json'},body:JSON.stringify(settings)})).status,200);
  assert.equal(persisted.scenario,'deny');assert.equal((await fetch(base+'/cis2/session',{headers:{cookie}}).then(r=>r.json())).identity,null,'settings revoke sessions');
  const denied=await fetch(base+'/cis2/authorize?'+authorization,{redirect:'manual'});assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');
});
