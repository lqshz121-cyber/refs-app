import {createPublicKey,verify} from 'node:crypto';

const KEY_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function keyring(publicKeys){
  if(!publicKeys||typeof publicKeys!=='object'||Array.isArray(publicKeys))throw new Error('WBS snapshot Ed25519 public keyring is required');
  const entries=Object.entries(publicKeys);if(!entries.length)throw new Error('WBS snapshot Ed25519 public keyring is required');
  const keys=new Map();
  for(const [keyId,pem] of entries){
    if(!KEY_ID.test(keyId))throw new Error('WBS snapshot key id is invalid');
    if(typeof pem!=='string'||pem.trim().length<64)throw new Error(`WBS snapshot public key is invalid for ${keyId}`);
    let key;try{key=createPublicKey(pem.replace(/\\n/g,'\n'));}catch{throw new Error(`WBS snapshot public key is invalid for ${keyId}`);}
    if(key.asymmetricKeyType!=='ed25519')throw new Error(`WBS snapshot public key must be Ed25519 for ${keyId}`);
    keys.set(keyId,key);
  }
  return keys;
}

export function createWbsSnapshotSignatureVerifier({publicKeys}={}){
  const keys=keyring(publicKeys);
  return async snapshot=>{
    const signature=snapshot?.detached_signature;
    if(!signature||!KEY_ID.test(signature.key_id||'')||signature.algorithm!=='Ed25519'||typeof signature.value!=='string'||!signature.value.length)return false;
    const publicKey=keys.get(signature.key_id);if(!publicKey)return false;
    try{return verify(null,Buffer.from(snapshot.package_hash,'utf8'),publicKey,Buffer.from(signature.value,'base64'));}
    catch{return false;}
  };
}
