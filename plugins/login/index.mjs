/** Single-user password entry into the official DSH browser session. */
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {join} from 'node:path';
import {TextDecoder} from 'node:util';
import {matches,readCredentials,replacePassword} from './credentials.mjs';

export const name='jarvis-b0-login';
export const inject=['webServer','connection'];
const BODY_LIMIT=4096;
const WINDOW_MS=15*60*1000;
const LIMITS={ip:20,account:10,pair:5};
const textDecoder=new TextDecoder('utf-8',{fatal:true});
const formType=/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i;
const localHost=host=>host.startsWith('127.')||host.startsWith('localhost:');
const noStore={'cache-control':'no-store','content-type':'text/plain; charset=utf-8'};

function reply(res,status,message=''){
  res.writeHead(status,noStore);
  res.end(message);
}
function decodeField(part){return decodeURIComponent(part.replace(/\+/g,' '));}
async function form(req,fields){
  if(!formType.test(req.headers['content-type']??''))return null;
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>BODY_LIMIT))return null;
  const chunks=[];let bytes=0;
  const complete=await new Promise(resolve=>{
    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;
      req.off('data',data);req.off('end',end);req.off('error',error);
      if(!value)req.resume();
      resolve(value);
    };
    const data=part=>{
      const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);
      bytes+=chunk.length;
      if(bytes>BODY_LIMIT)return finish(false);
      chunks.push(chunk);
    };
    const end=()=>finish(true);
    const error=()=>finish(false);
    req.on('data',data);req.once('end',end);req.once('error',error);
  });
  if(!complete)return null;
  let raw;
  try{raw=textDecoder.decode(Buffer.concat(chunks));}catch{return null;}
  if(!raw||/%(?![\da-fA-F]{2})/.test(raw))return null;
  const values=Object.create(null);
  try{
    for(const pair of raw.split('&')){
      const at=pair.indexOf('=');
      if(at<0)return null;
      const key=decodeField(pair.slice(0,at));
      if(!fields.includes(key)||Object.hasOwn(values,key))return null;
      values[key]=decodeField(pair.slice(at+1));
    }
  }catch{return null;}
  if(Object.keys(values).length!==fields.length||fields.some(key=>typeof values[key]!=='string'))return null;
  return values;
}
function validUsername(value){return value.length>0&&Buffer.byteLength(value,'utf8')<=128;}
function validPassword(value,minimum){return Array.from(value).length>=minimum&&Buffer.byteLength(value,'utf8')<=1024;}
function address(req){
  const remote=req.socket.remoteAddress??'unknown';
  if(remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1'){
    const forwarded=req.headers['x-forwarded-for'];
    if(typeof forwarded==='string'&&!forwarded.includes(',')&&isIP(forwarded.trim()))return forwarded.trim();
  }
  return remote;
}
function gate(req,ctx,authorities,allowOpaqueLogin=false){
  const host=req.headers.host;
  if(typeof host!=='string'||!authorities.has(host.toLowerCase()))return false;
  const expected=`${localHost(host)?'http':'https'}://${host.toLowerCase()}`;
  const forwarded=req.headers['x-forwarded-proto'];
  if(!localHost(host)&&forwarded!=='https')return false;
  const origin=req.headers.origin;
  const opaque=allowOpaqueLogin&&origin==='null';
  if(origin!==undefined&&!opaque){
    if(typeof origin!=='string')return false;
    try{if(new URL(origin).origin!==expected)return false;}catch{return false;}
  }
  // WebView.postUrl can produce an opaque Origin. Remove only that marker from
  // the official Host/Fetch-Site fence for password login; no Cookie is needed.
  const admission=opaque?{headers:{...req.headers,origin:undefined}}:req;
  if(ctx.connection.requestRejection(admission)===403)return false;
  return true;
}
function limiter(){
  const state=new Map();
  const account=value=>createHash('sha256').update(value).digest('hex');
  const keys=(ip,user)=>[`ip:${ip}`,`account:${account(user)}`,`pair:${ip}:${account(user)}`];
  const blocked=(ip,user)=>{
    const now=Date.now();
    return keys(ip,user).some(key=>{const row=state.get(key);return row&&row.until>now&&row.count>=LIMITS[key.split(':',1)[0]];});
  };
  const failure=(ip,user)=>{
    const now=Date.now();
    for(const key of keys(ip,user)){
      const row=state.get(key);
      state.set(key,row&&row.until>now?{count:row.count+1,until:row.until}:{count:1,until:now+WINDOW_MS});
    }
    if(state.size>10000){
      for(const [key,row] of state){if(row.until<=now)state.delete(key);}
      while(state.size>10000)state.delete(state.keys().next().value);
    }
  };
  const success=(ip,user)=>{for(const key of keys(ip,user))state.delete(key);};
  return {blocked,failure,success};
}

export async function apply(ctx,config={}){
  const home=process.env.DSH_HOME;
  if(!home)throw new Error('Private Jarvis authentication home missing');
  const list=config.authorities;
  if(!Array.isArray(list)||list.length===0||list.some(value=>typeof value!=='string'||!/^[a-zA-Z0-9.-]+:\d{1,5}$/.test(value)))throw new Error('Jarvis authentication authorities missing');
  const authorities=new Set(list.map(value=>value.toLowerCase()));
  const path=join(home,'jarvis-auth.json');
  await readCredentials(path);
  const attempts=limiter();
  let queued=0,credentialTail=Promise.resolve();
  const credentialOperation=async(fn)=>{
    if(queued>=4)return {busy:true};
    queued++;
    const current=credentialTail.then(fn,fn);
    credentialTail=current.catch(()=>{});
    try{return {value:await current};}finally{queued--;}
  };
  ctx.effect(()=>{
    const login=ctx.webServer.register({kind:'exact',path:'/jarvis-auth',handler:async(req,res)=>{
      if(req.method!=='POST')return reply(res,405);
      if(!gate(req,ctx,authorities,true))return reply(res,403);
      let fields;
      try{fields=await form(req,['username','password']);}catch{return reply(res,400);}
      if(!fields||!validUsername(fields.username)||!validPassword(fields.password,1))return reply(res,400);
      const ip=address(req);
      if(attempts.blocked(ip,fields.username))return reply(res,429);
      try{
        const check=await credentialOperation(async()=>{
          if(!await matches(await readCredentials(path),fields.username,fields.password)){
            attempts.failure(ip,fields.username);
            return false;
          }
          attempts.success(ip,fields.username);
          const host=req.headers.host;
          // Issuance and password replacement share one bounded serial boundary.
          const privateUrl=new URL(ctx.connection.authenticatedUrl(`http://${host}/`));
          const synthetic={method:'GET',url:`/${privateUrl.search}`,headers:{host}};
          if(ctx.connection.authorizeIndex(synthetic,res))throw new Error('Native authorization rejected');
          return true;
        });
        if(check.busy)return reply(res,429);
        if(!check.value)return reply(res,401,'Invalid credentials');
        // The official handler owns the 303, Cookie and no-store response.
      }catch{return reply(res,503);}
    }});
    const password=ctx.webServer.register({kind:'exact',path:'/jarvis-auth/password',handler:async(req,res)=>{
      if(req.method!=='POST')return reply(res,405);
      if(!gate(req,ctx,authorities))return reply(res,403);
      const rejection=ctx.connection.requestRejection(req);
      if(rejection!==undefined)return reply(res,rejection);
      let fields;
      try{fields=await form(req,['oldPassword','newPassword']);}catch{return reply(res,400);}
      if(!fields||!validPassword(fields.oldPassword,1)||!validPassword(fields.newPassword,12))return reply(res,400);
      const ip=address(req);
      try{
        const result=await credentialOperation(async()=>{
          const record=await readCredentials(path);
          if(attempts.blocked(ip,record.username))return 429;
          if(!await matches(record,record.username,fields.oldPassword)){
            attempts.failure(ip,record.username);return 403;
          }
          await replacePassword(path,record,fields.newPassword);
          attempts.success(ip,record.username);
          return 204;
        });
        return reply(res,result.busy?429:result.value);
      }catch{return reply(res,503);}
    }});
    return ()=>{password();login();};
  });
}
