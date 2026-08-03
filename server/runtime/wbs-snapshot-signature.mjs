import {createPublicKey,verify} from 'node:crypto';

export function createWbsSnapshotSignatureVerifier({publicKeyPem}={}){
  if(typeof publicKeyPem!=='string'||publicKeyPem.trim().length<64)throw new Error('WBS snapshot Ed25519 public key is required');
  let publicKey;
  try{publicKey=createPublicKey(publicKeyPem.replace(/\\n/g,'\n'));}
  catch{throw new Error('WBS snapshot public key is invalid');}
  if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('WBS snapshot public key must be Ed25519');
  return async snapshot=>{
    const signature=snapshot?.detached_signature;
    if(!signature||signature.algorithm!=='Ed25519'||typeof signature.value!=='string'||!signature.value.length)return false;
    try{return verify(null,Buffer.from(snapshot.package_hash,'utf8'),publicKey,Buffer.from(signature.value,'base64'));}
    catch{return false;}
  };
}
