import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,lstat,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {switchProfile} from './switch-profile.mjs';

test('activation and rollback preserve only their exact reviewed profile',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jarvis-profile-switch-'));
  try{
    const stage=join(root,'stage'),live=join(root,'provider.patch.yml');
    await mkdir(stage);
    await writeFile(join(stage,'provider.patch.before'),'model: original\n');
    await writeFile(join(stage,'provider.patch.candidate'),'model: original\nlogin: enabled\n');
    await writeFile(live,'model: newer\n');
    await assert.rejects(switchProfile('activate',live,stage),/changed since/);
    assert.equal(await readFile(live,'utf8'),'model: newer\n');
    await writeFile(live,'model: original\n');
    await chmod(live,0o640);
    await switchProfile('activate',live,stage);
    assert.equal(await readFile(live,'utf8'),'model: original\nlogin: enabled\n');
    assert.equal((await lstat(live)).mode&0o777,0o640);
    await writeFile(live,'model: newer\nlogin: enabled\n');
    await assert.rejects(switchProfile('rollback',live,stage),/changed since/);
    assert.equal(await readFile(live,'utf8'),'model: newer\nlogin: enabled\n');
    await writeFile(live,'model: original\nlogin: enabled\n');
    await switchProfile('rollback',live,stage);
    assert.equal(await readFile(live,'utf8'),'model: original\n');
    assert.equal((await lstat(live)).mode&0o777,0o640);
  }finally{await rm(root,{recursive:true,force:true});}
});
