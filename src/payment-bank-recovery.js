export class PaymentBankRecoveryError extends Error {}
import {validPaymentBankCommand} from './payment-bank-api.js';
const DB='refs-accounting-payment-command-intents',STORE='paymentBankMatches';
export const paymentBankIntentKey=({config,bankSourceId,actorId})=>JSON.stringify([config.baseUrl,config.entityId,bankSourceId,actorId]);
function open(factory){
 return new Promise((resolve,reject)=>{
  if(!factory?.open){reject(new PaymentBankRecoveryError('Request recovery storage is unavailable. Enable site storage before matching.'));return;}
  const request=factory.open(DB,1);let rejected=false;
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});};
  request.onerror=()=>reject(new PaymentBankRecoveryError('Request recovery storage could not be opened. Retry.'));
  request.onblocked=()=>{rejected=true;reject(new PaymentBankRecoveryError('Close older REFS tabs and retry opening request recovery.'));};
  request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
 });
}
async function transact(factory,mode,work){
 const db=await open(factory);
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode,mode==='readwrite'?{durability:'strict'}:undefined);let result;
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new PaymentBankRecoveryError('The request could not be saved for recovery. Retry before submitting.'));tx.onerror=()=>{};
  try{work(tx.objectStore(STORE),value=>{result=value;});}catch(error){tx.abort();reject(error);}
 });}finally{db.close();}
}
async function validated(record,scope){
 if(record==null)return null;
 if(typeof record!=='object'||Array.isArray(record)||record.schemaVersion!==1||record.key!==paymentBankIntentKey(scope)||Object.keys(record).length!==3||!await validPaymentBankCommand({...scope,command:record.command}))throw new PaymentBankRecoveryError('Saved request recovery data could not be verified. Do not submit a replacement until the bank record has been reviewed.');
 return {command:record.command};
}
export async function readPaymentBankIntent(scope,{indexedDB=globalThis.indexedDB}={}){
 const record=await transact(indexedDB,'readonly',(store,set)=>{const request=store.get(paymentBankIntentKey(scope));request.onsuccess=()=>set(request.result);});
 return validated(record,scope);
}
export async function reservePaymentBankIntent(scope,command,{indexedDB=globalThis.indexedDB}={}){
 if(!await validPaymentBankCommand({...scope,command}))throw new PaymentBankRecoveryError('The match request cannot be saved because its scope or contents changed.');
 const key=paymentBankIntentKey(scope),record={schemaVersion:1,key,command};
 const retained=await transact(indexedDB,'readwrite',(store,set)=>{const request=store.get(key);request.onsuccess=()=>{
  // IndexedDB serializes read/write transactions on this store. Another tab
  // cannot overwrite the original unconfirmed command with a new nonce.
  if(request.result){set(request.result);return;}store.add(record);set(record);
 };});
 return validated(retained,scope);
}
export async function releasePaymentBankIntent(scope,idempotencyKey,{indexedDB=globalThis.indexedDB}={}){
 return transact(indexedDB,'readwrite',(store,set)=>{const key=paymentBankIntentKey(scope),request=store.get(key);request.onsuccess=()=>{
  if(request.result?.command?.idempotencyKey===idempotencyKey){store.delete(key);set(true);}else set(false);
 };});
}
