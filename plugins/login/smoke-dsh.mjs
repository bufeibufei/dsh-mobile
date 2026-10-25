/** Isolated official DSH 0.2.1-alpha.2 smoke; no supplier credential or model prompt. */
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {provisionInitial} from './credentials.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const app=process.env.B0_DSH_APP?resolve(process.env.B0_DSH_APP):resolve(here,'../..');
const cli=join(app,'node_modules/@deepseek-ai/dsh/lib/bin.js');
assert.equal(JSON.parse(await readFile(join(app, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version,
  '0.2.1-alpha.2', 'Requires official DSH 0.2.1-alpha.2');
async function freePort(){
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
const temp=await mkdtemp(join(tmpdir(),'jarvis-auth-dsh-'));
const home=join(temp,'dsh-home'),workspace=join(temp,'workspace');
await mkdir(home,{mode:0o700});await mkdir(workspace,{mode:0o700});
const {status}=await provisionInitial(join(home,'jarvis-auth.json'),join(temp,'delivery.txt'));
assert.equal(status,'created');
const credentials=Object.fromEntries((await readFile(join(temp,'delivery.txt'),'utf8')).trim().split('\n').map(line=>line.split('=')));
const port=await freePort(),base=`http://127.0.0.1:${port}`;
const patch=join(temp,'login.patch.yml');
await writeFile(patch,[
  '- id: session-title-llm','  disabled: true',
  '- id: llm-pi-ai','  disabled: true',
  '- id: llm-deepseek','  disabled: true',
  '- insert:',`    - id: jarvis-b0-login`,`      name: ${JSON.stringify(join(here,'index.mjs'))}`,
  '      config:','        authorities:',`          - "127.0.0.1:${port}"`
].join('\n')+'\n');
const env={PATH:process.env.PATH,HOME:temp,DSH_HOME:home,DSH_AGENTS_HOME:join(temp,'agents-home'),DSH_TELEMETRY_DISABLED:'1',NO_COLOR:'1'};
let child,exited=false;
async function start(){
  exited=false;
  child=spawn(process.execPath,[cli,'web','--patch',patch,'--no-open','--host','127.0.0.1','--port',String(port)],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  // Native stdout may contain its launch token. Never emit or persist it.
  child.stdout.resume();child.stderr.resume();child.on('exit',()=>{exited=true;});
  let ready=false;
  for(let i=0;i<150;i++){
    if(exited)break;
    try{const response=await fetch(base+'/jarvis-auth',{signal:AbortSignal.timeout(300)});if(response.status===405){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(ready,true,'Official DSH did not mount Jarvis login route');
}
async function stop(){
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(exited)resolve();else child.once('exit',resolve);});
}
const post=(path,form,headers={})=>fetch(base+path,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(form),signal:AbortSignal.timeout(10000)});
async function rpc(method,args,cookie){
  const response=await fetch(`${base}/api/${method}`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload:{args}}),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.result?.ok,true,`Native ${method} rejected`);
  return result.result.value;
}
async function websocketStatus(cookie){
  return new Promise((resolve,reject)=>{
    const req=httpRequest(`${base}/api/remote.mux`,{headers:{connection:'Upgrade',upgrade:'websocket','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-version':'13',origin:base,...cookie?{cookie}:{}}});
    req.once('upgrade',(res,socket)=>{socket.destroy();resolve(res.statusCode);});
    req.once('response',res=>{res.resume();resolve(res.statusCode);});
    req.once('error',reject);req.end();
  });
}
try{
  await start();
  assert.equal((await fetch(base+'/')).status,401);
  assert.equal((await post('/jarvis-auth',{username:credentials.username,password:'incorrect'})).status,401);
  assert.equal((await post('/jarvis-auth',credentials,{origin:'https://other.example'})).status,403);
  assert.equal((await post('/jarvis-auth',credentials,{origin:'null'})).status,303);
  assert.equal((await post('/jarvis-auth',credentials,{origin:'null','sec-fetch-site':'cross-site'})).status,403);
  for(let i=0;i<5;i++)assert.equal((await post('/jarvis-auth',{username:'unknown',password:'incorrect'})).status,401);
  assert.equal((await post('/jarvis-auth',{username:'unknown',password:'incorrect'})).status,429);
  const login=await post('/jarvis-auth',credentials);
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('dsh-auth-'));
  assert.equal(login.headers.get('location'),'./');
  assert.equal((await fetch(base+'/',{headers:{cookie}})).status,200);
  await rpc('session/list',{_request:{}},cookie);
  assert.equal(await websocketStatus(),401);
  assert.equal(await websocketStatus(cookie),101);
  await writeFile(join(workspace,'fictional.txt'),'hello\n');
  await rpc('workspace/create',{request:{path:workspace}},cookie);
  const sessionId=`auth-fixture-${randomUUID()}`;
  await rpc('session/create',{request:{sessionId,cwd:workspace,agentPreset:'minimal'}},cookie);
  const file=await rpc('workspaceFiles/stat',{workspaceFileScopeId:sessionId,path:'fictional.txt'},cookie);
  assert.equal(file.bytes,6);
  const readMethod='workspaceFiles/readBytes';
  const read=await fetch(`${base}/api/${readMethod}`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:base},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method:readMethod,payload:{args:{workspaceFileScopeId:sessionId,path:'fictional.txt',options:{}}}}),signal:AbortSignal.timeout(10000)});
  assert.equal(read.status,200);
  const readBody=Buffer.from(await read.arrayBuffer());
  assert.ok(readBody.includes(Buffer.from('hello\n')),'Native file bytes missing');
  assert.equal((await post('/jarvis-auth/password',{oldPassword:'incorrect',newPassword:'next-fixture-password-123'},{cookie})).status,403);
  assert.equal((await post('/jarvis-auth/password',{oldPassword:credentials.password,newPassword:'next-fixture-password-123'},{cookie,origin:'null'})).status,403);
  assert.equal((await post('/jarvis-auth/password',{oldPassword:credentials.password,newPassword:'next-fixture-password-123'},{cookie})).status,204);
  assert.equal((await post('/jarvis-auth',credentials)).status,401);
  assert.equal((await fetch(base+'/',{headers:{cookie}})).status,200);
  assert.equal((await post('/jarvis-auth',{username:credentials.username,password:'next-fixture-password-123'})).status,303);
  await stop();
  await start();
  assert.equal((await fetch(base+'/',{headers:{cookie}})).status,200);
  await rpc('session/list',{_request:{}},cookie);
  console.log(JSON.stringify({result:'passed',official_dsh:'0.2.1-alpha.2',login:303,opaque_origin_login:303,cross_site_login:403,opaque_origin_password_change:403,wrong_password:401,limited:429,password_changed:204,authenticated_page:200,native_session_list_ok:true,websocket:101,file_read_bytes:6,cookie_survived_restart:true,model_requests:0}));
}finally{
  if(child&&!exited)await stop();
  await rm(temp,{recursive:true,force:true});
}
