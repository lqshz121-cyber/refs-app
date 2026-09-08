export class SalesBankRecoveryError extends Error {}
import {validSalesBankCommand} from './sales-receipt-bank-api.js';
const DB='refs-accounting-command-intents',STORE='salesBankMatches';
export const salesBankIntentKey=({config,bankSourceId,actorId})=>JSON.stringify([config.baseUrl,config.entityId,bankSourceId,actorId]);
function open(factory){
 return new Promise((resolve,reject)=>{
  if(!factory?.open){reject(new SalesBankRecoveryError('Request recovery storage is unavailable. Enable site storage before matching.'));return;}
  const request=factory.open(DB,1);let rejected=false;
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});};
  request.onerror=()=>reject(new SalesBankRecoveryError('Request recovery storage could not be opened. Retry.'));
  request.onblocked=()=>{rejected=true;reject(new SalesBankRecoveryError('Close older REFS tabs and retry opening request recovery.'));};
  request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
 });
}
async function transact(factory,mode,work){
 const db=await open(factory);
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined);let result;
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new SalesBankRecoveryError('The request could not be saved for recovery. Retry before submitting.'));tx.onerror=()=>{};
  try{work(tx.objectStore(STORE),value=>{result=value;});}catch(error){tx.abort();reject(error);}
 });}finally{db.close();}
}
async function validated(record,scope){
 if(record==null)return null;
 if(typeof record!=='object'||Array.isArray(record)||record.schemaVersion!==1||record.key!==salesBankIntentKey(scope)||Object.keys(record).length!==3||!await validSalesBankCommand({...scope,command:record.command}))throw new SalesBankRecoveryError('Saved request recovery data could not be verified. Do not submit a replacement until the bank record has been reviewed.');
 return {command:record.command};
}
export async function readSalesBankIntent(scope,{indexedDB=globalThis.indexedDB}={}){
 const record=await transact(indexedDB,'readonly',(store,set)=>{const request=store.get(salesBankIntentKey(scope));request.onsuccess=()=>set(request.result);});
 return validated(record,scope);
}
export async function reserveSalesBankIntent(scope,command,{indexedDB=globalThis.indexedDB}={}){
 if(!await validSalesBankCommand({...scope,command}))throw new SalesBankRecoveryError('The match request cannot be saved because its scope or contents changed.');
 const key=salesBankIntentKey(scope),record={schemaVersion:1,key,command};
 const retained=await transact(indexedDB,'readwrite',(store,set)=>{const request=store.get(key);request.onsuccess=()=>{
  // IndexedDB serializes read/write transactions on this store. Another tab
  // cannot overwrite the original unconfirmed command with a new nonce.
  if(request.result){set(request.result);return;}store.add(record);set(record);
 };});
 return validated(retained,scope);
}
export async function releaseSalesBankIntent(scope,idempotencyKey,{indexedDB=globalThis.indexedDB}={}){
 return transact(indexedDB,'readwrite',(store,set)=>{const key=salesBankIntentKey(scope),request=store.get(key);request.onsuccess=()=>{
  if(request.result?.command?.idempotencyKey===idempotencyKey){store.delete(key);set(true);}else set(false);
 };});
}
