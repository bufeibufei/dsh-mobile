/** Compare and replace only the reviewed B0 provider profile. */
import {randomBytes} from 'node:crypto';
import {open,readFile,lstat,rename,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function switchProfile(mode,live,stage){
  if(mode!=='activate'&&mode!=='rollback')throw new Error('Invalid profile switch mode');
  if(!isAbsolute(live)||!isAbsolute(stage))throw new Error('Profile paths must be absolute');
  const before=join(stage,'provider.patch.before');
  const candidate=join(stage,'provider.patch.candidate');
  const expected=mode==='activate'?before:candidate;
  const replacement=mode==='activate'?candidate:before;
  for(const path of [live,expected,replacement]){
    const stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Profile path must be a regular file');
  }
  const [current,oldBytes,newBytes]=await Promise.all([readFile(live),readFile(expected),readFile(replacement)]);
  if(!current.equals(oldBytes))throw new Error('Live profile changed since this candidate was staged; rebuild the candidate');
  const liveStat=await lstat(live);
  const temp=join(dirname(live),`.provider.patch.next.${randomBytes(12).toString('hex')}`);
  let created=false;
  try{
    const handle=await open(temp,'wx',0o600);
    created=true;
    try{
      await handle.writeFile(newBytes);
      await handle.chown(liveStat.uid,liveStat.gid);
      await handle.chmod(liveStat.mode&0o777);
      await handle.sync();
    }finally{await handle.close();}
    // Recheck immediately before rename; a changed live profile must survive.
    const latest=await readFile(live);
    if(!latest.equals(oldBytes))throw new Error('Live profile changed during switch; no replacement made');
    await rename(temp,live);
    created=false;
    // Rename is the commit point; a later directory sync failure cannot undo it.
    try{
      const directory=await open(dirname(live),'r');
      try{await directory.sync();}finally{await directory.close();}
    }catch{}
  }finally{if(created)await unlink(temp).catch(()=>{});}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const [mode,live,stage]=process.argv.slice(2);
  if(!mode||!live||!stage){
    console.error('Usage: node switch-profile.mjs activate|rollback ABS_LIVE_PROFILE ABS_STAGE_DIR');
    process.exitCode=1;
  }else{
    try{await switchProfile(mode,live,stage);console.log(`Profile ${mode} complete; restart your DSH service after review`);}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
