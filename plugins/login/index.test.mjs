import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {provisionInitial} from './credentials.mjs';
import {apply} from './index.mjs';

// These integration tests exercise real HTTP framing. Restricted sandboxes may
// prohibit loopback listeners; skip only that explicit environmental limitation.
const httpUnavailable = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', error => {
    if (['EPERM', 'EACCES'].includes(error.code)) resolve(`Loopback HTTP listener unavailable: ${error.code}`);
    else reject(error);
  });
  probe.listen(0, '127.0.0.1', () => probe.close(() => resolve(false)));
});

async function fixture(){
  const home=await mkdtemp(join(tmpdir(),'jarvis-login-'));
  const delivery=join(home,'delivery.txt');
  assert.equal((await provisionInitial(join(home,'jarvis-auth.json'),delivery)).status,'created');
  assert.equal((await provisionInitial(join(home,'jarvis-auth.json'),join(home,'ignored.txt'))).status,'existing');
  const credentials=Object.fromEntries((await readFile(delivery,'utf8')).trim().split('\n').map(line=>line.split('=')));
  const routes=new Map();let dispose;
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const handler=routes.get(path);
    if(handler)handler(req,res).catch(()=>{res.writeHead(500);res.end();});
    else{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  process.env.DSH_HOME=home;
  let synthetic;
  const ctx={
    webServer:{register(route){routes.set(route.path,route.handler);return()=>routes.delete(route.path);}},
    connection:{
      requestRejection(req){
        if(req.headers['sec-fetch-site']==='cross-site')return 403;
        if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return 403;
        return req.headers.cookie==='dsh-test=valid'?undefined:401;
      },
      authenticatedUrl(base){return base+'?token=private-fixture';},
      authorizeIndex(req,res){
        synthetic=req;
        assert.equal(req.method,'GET');
        assert.equal(req.url,'/?token=private-fixture');
        res.writeHead(303,{'location':'./','cache-control':'no-store','set-cookie':'dsh-test=valid; HttpOnly; SameSite=Strict'});
        res.end();
        return false;
      }
    },
    effect(fn){dispose=fn();}
  };
  await apply(ctx,{authorities:[`127.0.0.1:${port}`]});
  const base=`http://127.0.0.1:${port}`;
  const post=(path,fields,headers={})=>fetch(base+path,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:fields});
  return {home,server,base,credentials,post,get synthetic(){return synthetic;},async close(){dispose();await new Promise(resolve=>server.close(resolve));await rm(home,{recursive:true,force:true});}};
}

test('oversized chunked HTTP body returns 400 without resetting the connection',{skip: httpUnavailable},async()=>{
  const f=await fixture();
  try{
    const status=await new Promise((resolve,reject)=>{
      const req=request(f.base+'/jarvis-auth',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));
      });
      req.on('error',reject);
      req.write('username=fictional&password=');
      req.write('x'.repeat(5000));
      req.end();
    });
    assert.equal(status,400);
  }finally{await f.close();}
});

test('official exchange shape, admission and atomic password change',{skip: httpUnavailable},async()=>{
  const f=await fixture();
  try{
    const {username,password}=f.credentials;
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password:'wrong'}))).status,401);
    assert.equal((await f.post('/jarvis-auth',`username=${username}&username=again&password=x`)).status,400);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password:'x'.repeat(5000)}))).status,400);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password}),{origin:'https://different.example'})).status,403);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password}),{origin:'null'})).status,303);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password}),{origin:'null','sec-fetch-site':'cross-site'})).status,403);
    const login=await f.post('/jarvis-auth',new URLSearchParams({username,password}));
    assert.equal(login.status,303);
    assert.equal(login.headers.get('location'),'./');
    assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    assert.equal(f.synthetic.headers.host,new URL(login.url).host);
    assert.equal((await f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:password,newPassword:'another-long-password'}))).status,401);
    const cookie={cookie:'dsh-test=valid'};
    assert.equal((await f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:password,newPassword:'another-long-password'}),{...cookie,origin:'null'})).status,403);
    assert.equal((await f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:'incorrect',newPassword:'another-long-password'}),cookie)).status,403);
    assert.equal((await f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:password,newPassword:'short'}),cookie)).status,400);
    assert.equal((await f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:password,newPassword:'another-long-password'}),cookie)).status,204);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password}))).status,401);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password:'another-long-password'}))).status,303);
  }finally{await f.close();}
});

test('wrong credentials are limited without signing a cookie',{skip: httpUnavailable},async()=>{
  const f=await fixture();
  try{
    const {username}=f.credentials;
    for(let i=0;i<5;i++){
      const response=await f.post('/jarvis-auth',new URLSearchParams({username,password:'wrong'}));
      assert.equal(response.status,401);
      assert.equal(response.headers.get('set-cookie'),null);
    }
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password:'wrong'}))).status,429);
  }finally{await f.close();}
});

test('concurrent password changes commit only one verifier',{skip: httpUnavailable},async()=>{
  const f=await fixture();
  try{
    const oldPassword=f.credentials.password,headers={cookie:'dsh-test=valid'};
    const attempts=await Promise.all([
      f.post('/jarvis-auth/password',new URLSearchParams({oldPassword,newPassword:'first-long-password-123'}),headers),
      f.post('/jarvis-auth/password',new URLSearchParams({oldPassword,newPassword:'second-long-password-123'}),headers)
    ]);
    assert.deepEqual(attempts.map(response=>response.status).sort(),[204,403]);
    const first=(await f.post('/jarvis-auth',new URLSearchParams({username:f.credentials.username,password:'first-long-password-123'}))).status;
    const second=(await f.post('/jarvis-auth',new URLSearchParams({username:f.credentials.username,password:'second-long-password-123'}))).status;
    assert.deepEqual([first,second].sort(),[303,401]);
  }finally{await f.close();}
});

test('an old password login cannot complete after a concurrent change commits',{skip: httpUnavailable},async()=>{
  const f=await fixture();
  try{
    const {username,password}=f.credentials;
    const next='race-long-password-123';
    const order=[];
    const change=f.post('/jarvis-auth/password',new URLSearchParams({oldPassword:password,newPassword:next}),{cookie:'dsh-test=valid'})
      .then(response=>{order.push(['change',response.status]);return response;});
    const login=f.post('/jarvis-auth',new URLSearchParams({username,password}))
      .then(response=>{order.push(['login',response.status]);return response;});
    const [changed,oldLogin]=await Promise.all([change,login]);
    assert.equal(changed.status,204);
    if(order[0][0]==='change')assert.equal(oldLogin.status,401);
    else assert.equal(oldLogin.status,303);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password}))).status,401);
    assert.equal((await f.post('/jarvis-auth',new URLSearchParams({username,password:next}))).status,303);
  }finally{await f.close();}
});
