import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {open,lstat,readFile,link,rename,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback);
const SALT_BYTES=32;
const HASH_BYTES=64;
const PARAMS={N:16384,r:8,p:1,maxmem:32*1024*1024};
const same=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());

async function hashPassword(password,salt){
  return Buffer.from(await scrypt(password,salt,HASH_BYTES,PARAMS));
}
function validRecord(value){
  const encoded=value?.salt&&value?.hash;
  if(!encoded||!/^[A-Za-z0-9_-]+$/.test(value.salt)||!/^[A-Za-z0-9_-]+$/.test(value.hash))return false;
  return value?.version===1 && typeof value.username==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.username)
    && Buffer.from(value.salt,'base64url').length===SALT_BYTES
    && Buffer.from(value.hash,'base64url').length===HASH_BYTES
    && Buffer.from(value.salt,'base64url').toString('base64url')===value.salt
    && Buffer.from(value.hash,'base64url').toString('base64url')===value.hash;
}
export async function readCredentials(path){
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid())throw new Error('Invalid private auth file');
  const value=JSON.parse(await readFile(path,'utf8'));
  if(!validRecord(value))throw new Error('Invalid private auth record');
  return value;
}
export async function matches(record,username,password){
  const actual=await hashPassword(password,Buffer.from(record.salt,'base64url'));
  const expected=Buffer.from(record.hash,'base64url');
  const passwordMatches=timingSafeEqual(actual,expected);
  const usernameMatches=same(username,record.username);
  return passwordMatches&&usernameMatches;
}
async function syncDirectory(path){
  const handle=await open(dirname(path),'r');
  try{await handle.sync();}finally{await handle.close();}
}
export async function replacePassword(path,record,newPassword){
  const salt=randomBytes(SALT_BYTES);
  const next={version:1,username:record.username,salt:salt.toString('base64url'),hash:(await hashPassword(newPassword,salt)).toString('base64url')};
  const temporary=join(dirname(path),`.jarvis-auth-${randomBytes(12).toString('hex')}.tmp`);
  const handle=await open(temporary,'wx',0o600);
  try{
    await handle.writeFile(JSON.stringify(next)+'\n');
    await handle.sync();
  }finally{await handle.close();}
  // The rename is the commit point. A directory fsync failure after it must
  // not be reported as a rejected password change while the new verifier lives.
  try{await rename(temporary,path);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
  await syncDirectory(path).catch(()=>{});
}
export async function provisionInitial(configPath,deliveryPath,ownerUid=process.getuid(),ownerGid=process.getgid()){
  try{
    const existing=await lstat(configPath);
    if(!existing.isFile()||existing.isSymbolicLink()||(existing.mode&0o777)!==0o600||existing.uid!==ownerUid||!validRecord(JSON.parse(await readFile(configPath,'utf8'))))throw new Error('Existing auth file is invalid');
    return {status:'existing'};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const username=`jarvis-${randomBytes(8).toString('hex')}`;
  const password=randomBytes(32).toString('base64url');
  const salt=randomBytes(SALT_BYTES);
  const record={version:1,username,salt:salt.toString('base64url'),hash:(await hashPassword(password,salt)).toString('base64url')};
  const delivery=await open(deliveryPath,'wx',0o600);
  let created=false;
  try{
    await delivery.writeFile(`username=${username}\npassword=${password}\n`);
    await delivery.sync();
    const temporary=join(dirname(configPath),`.jarvis-auth-${randomBytes(12).toString('hex')}.tmp`);
    const handle=await open(temporary,'wx',0o600);
    try{
      await handle.writeFile(JSON.stringify(record)+'\n');
      await handle.chown(ownerUid,ownerGid);
      await handle.sync();
    }finally{await handle.close();}
    try{await link(temporary,configPath);created=true;await syncDirectory(configPath);}finally{await unlink(temporary).catch(()=>{});}
  }finally{
    await delivery.close();
    if(!created)await unlink(deliveryPath).catch(()=>{});
  }
  return {status:'created',deliveryPath};
}
