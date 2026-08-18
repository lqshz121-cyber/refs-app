import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const SOURCE_MONEY=/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/;
const TOTAL_MONEY=/^(?:0|[1-9]\d{0,17})\.\d{4}$/;
const MAX_ROWS=500;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
export const parseWbsFinal1Money4=value=>{if(typeof value!=='string'||!SOURCE_MONEY.test(value))fail('WBS_FINAL1_CONTROL_MONEY_INVALID','Signed source amounts must be fixed-point strings with at most four decimals.');const negative=value.startsWith('-'),raw=negative?value.slice(1):value,[whole,fraction='']=raw.split('.');return (negative?-1n:1n)*(BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4)));};
export const formatWbsFinal1Money4=value=>{const negative=value<0n,absolute=negative?-value:value;return `${negative?'-':''}${absolute/10000n}.${String(absolute%10000n).padStart(4,'0')}`;};
export const wbsFinal1ControlTotalsHash=value=>canonicalRequestHash(value);

export function validateWbsFinal1SignedControlTotals(value,{label='Provider',expected=null}={}){
  if(!exactKeys(value,['control_totals','control_totals_hash'])||!HASH.test(value.control_totals_hash||''))fail('WBS_FINAL1_CONTROL_INVALID',`${label} signed control totals are incomplete.`);
  const totals=value.control_totals;
  if(!exactKeys(totals,['row_count','currency_totals'])||!Number.isSafeInteger(totals.row_count)||totals.row_count<1||totals.row_count>MAX_ROWS||!Array.isArray(totals.currency_totals)||totals.currency_totals.length<1||totals.currency_totals.length>MAX_ROWS)fail('WBS_FINAL1_CONTROL_INVALID',`${label} signed control totals are malformed.`);
  let prior='',count=0;
  for(const row of totals.currency_totals){
    if(!exactKeys(row,['currency','row_count','amount_total'])||!/^[A-Z]{3}$/.test(row.currency||'')||!Number.isSafeInteger(row.row_count)||row.row_count<1||row.row_count>MAX_ROWS||!TOTAL_MONEY.test(row.amount_total||'')||row.currency<=prior)fail('WBS_FINAL1_CONTROL_INVALID',`${label} currency totals are not canonical ordered MONEY4 rows.`);
    prior=row.currency;count+=row.row_count;
  }
  if(count!==totals.row_count)fail('WBS_FINAL1_CONTROL_INVALID',`${label} currency row counts differ from the signed population.`);
  if(wbsFinal1ControlTotalsHash(totals)!==value.control_totals_hash)fail('WBS_FINAL1_CONTROL_HASH_MISMATCH',`${label} control totals hash is not canonical.`);
  if(expected&&canonicalRequestBody(value)!==canonicalRequestBody(expected))fail('WBS_FINAL1_CONTROL_DRIFT',`${label} signed totals differ from the exact signed row population.`);
  return value;
}

export function computeWbsFinal1ControlTotals({rows,currencyOf,amountOf}={}){
  if(!Array.isArray(rows)||rows.length<1||typeof currencyOf!=='function'||typeof amountOf!=='function')fail('WBS_FINAL1_CONTROL_INVALID','A non-empty signed row population and exact control rules are required.');
  if(rows.length>MAX_ROWS)fail('WBS_FINAL1_CONTROL_INVALID','Signed row population exceeds the fixed control bound.');
  const totals=new Map();
  for(const row of rows){const currency=currencyOf(row);if(!/^[A-Z]{3}$/.test(currency||''))fail('WBS_FINAL1_CONTROL_CURRENCY_INVALID','Signed rows require exact ISO currency authority.');let amount=amountOf(row);if(typeof amount!=='bigint')fail('WBS_FINAL1_CONTROL_MONEY_INVALID','Control amount rule must return fixed-point units.');if(amount<0n)amount=-amount;const prior=totals.get(currency)||{row_count:0,amount:0n};prior.row_count++;prior.amount+=amount;totals.set(currency,prior);}
  const currency_totals=[...totals].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([currency,total])=>Object.freeze({currency,row_count:total.row_count,amount_total:formatWbsFinal1Money4(total.amount)}));
  const control_totals=Object.freeze({row_count:rows.length,currency_totals:Object.freeze(currency_totals)});
  return Object.freeze({control_totals,control_totals_hash:wbsFinal1ControlTotalsHash(control_totals)});
}
