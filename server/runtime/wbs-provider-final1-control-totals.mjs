import {canonicalRequestBody,canonicalRequestHash} from './request-hash.mjs';
import {WbsSignedDeliveryAdmissionError} from './wbs-signed-delivery-admission.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code,message)=>{throw new WbsSignedDeliveryAdmissionError(code,message);};
export const parseWbsFinal1Money4=value=>{if(typeof value!=='string'||!MONEY.test(value))fail('WBS_FINAL1_CONTROL_MONEY_INVALID','Signed control amounts must be fixed-point strings with at most four decimals.');const negative=value.startsWith('-'),raw=negative?value.slice(1):value,[whole,fraction='']=raw.split('.');return (negative?-1n:1n)*(BigInt(whole)*10000n+BigInt((fraction+'0000').slice(0,4)));};
export const formatWbsFinal1Money4=value=>{const negative=value<0n,absolute=negative?-value:value;return `${negative?'-':''}${absolute/10000n}.${String(absolute%10000n).padStart(4,'0')}`;};
export const wbsFinal1ControlTotalsHash=value=>canonicalRequestHash({row_count:value.row_count,per_currency_totals:value.per_currency_totals});

export function validateWbsFinal1SignedControlTotals(value,{label='Provider',expected=null}={}){
  if(!exactKeys(value,['row_count','per_currency_totals','control_totals_hash'])||!Number.isSafeInteger(value.row_count)||value.row_count<1||!Array.isArray(value.per_currency_totals)||value.per_currency_totals.length<1||!HASH.test(value.control_totals_hash||''))fail('WBS_FINAL1_CONTROL_INVALID',`${label} signed control totals are incomplete.`);
  let prior='';
  for(const row of value.per_currency_totals){if(!exactKeys(row,['currency','gross_amount'])||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY.test(row.gross_amount||'')||row.currency<=prior||formatWbsFinal1Money4(parseWbsFinal1Money4(row.gross_amount))!==row.gross_amount)fail('WBS_FINAL1_CONTROL_INVALID',`${label} per-currency totals are not canonical ordered MONEY4 rows.`);prior=row.currency;}
  if(wbsFinal1ControlTotalsHash(value)!==value.control_totals_hash)fail('WBS_FINAL1_CONTROL_HASH_MISMATCH',`${label} control totals hash is not canonical.`);
  if(expected&&canonicalRequestBody(value)!==canonicalRequestBody(expected))fail('WBS_FINAL1_CONTROL_DRIFT',`${label} signed totals differ from the exact signed row population.`);
  return value;
}

export function computeWbsFinal1ControlTotals({rows,currencyOf,amountOf}={}){
  if(!Array.isArray(rows)||rows.length<1||typeof currencyOf!=='function'||typeof amountOf!=='function')fail('WBS_FINAL1_CONTROL_INVALID','A non-empty signed row population and exact control rules are required.');
  const totals=new Map();
  for(const row of rows){const currency=currencyOf(row);if(!/^[A-Z]{3}$/.test(currency||''))fail('WBS_FINAL1_CONTROL_CURRENCY_INVALID','Signed rows require exact ISO currency authority.');let amount=amountOf(row);if(typeof amount!=='bigint')fail('WBS_FINAL1_CONTROL_MONEY_INVALID','Control amount rule must return fixed-point units.');if(amount<0n)amount=-amount;totals.set(currency,(totals.get(currency)||0n)+amount);}
  const per_currency_totals=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,total])=>Object.freeze({currency,gross_amount:formatWbsFinal1Money4(total)}));
  const base={row_count:rows.length,per_currency_totals};return Object.freeze({...base,control_totals_hash:wbsFinal1ControlTotalsHash(base)});
}
