import {isAbsolute} from 'node:path';
import {provisionInitial} from './credentials.mjs';

const [config,delivery,uidText,gidText]=process.argv.slice(2);
const uid=Number(uidText),gid=Number(gidText);
if(!config||!delivery||!isAbsolute(config)||!isAbsolute(delivery)||!Number.isInteger(uid)||!Number.isInteger(gid)||uid<0||gid<0){
  console.error('Usage: node provision.mjs ABS_CONFIG ABS_PRIVATE_DELIVERY UID GID');
  process.exitCode=1;
}else{
  try{
    const result=await provisionInitial(config,delivery,uid,gid);
    console.log(JSON.stringify(result));
  }catch{
    console.error('Private account provisioning failed; inspect paths and permissions');
    process.exitCode=1;
  }
}
