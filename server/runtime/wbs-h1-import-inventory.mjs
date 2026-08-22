const SHA=/^sha256:[0-9a-f]{64}$/;
const DATE=/^2026-(?:0[1-6])-(?:0[1-9]|[12][0-9]|3[01])$/;
const MONTH=/^2026-0[1-6]$/;
const MONEY=/^-?(?:0|[1-9][0-9]{0,19})\.[0-9]{4}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const optionalText=(value,max=128)=>value===null||typeof value==='string'&&value.length>=1&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const COUNT_KEYS=['source_record_count','source_amount','controlled_test_posted_count','formal_mapping_posted_count','mapping_missing_count','mapping_ready_count','mapping_ambiguous_count'];
const counts=value=>exact(value,COUNT_KEYS)&&MONEY.test(value.source_amount||'')&&COUNT_KEYS.filter(key=>key!=='source_amount').every(key=>Number.isSafeInteger(value[key])&&value[key]>=0);
const row=value=>exact(value,['source_record_hash','accounting_date','amount','project_code','cost_code','vendor_no','import_state','mapping_state'])&&SHA.test(value.source_record_hash||'')&&DATE.test(value.accounting_date||'')&&MONEY.test(value.amount||'')&&optionalText(value.project_code)&&optionalText(value.cost_code)&&optionalText(value.vendor_no)&&['SOURCE_STAGED','CONTROLLED_TEST_POSTED'].includes(value.import_state)&&['MAPPING_MISSING','MAPPING_READY_FOR_REVIEW','MAPPING_AMBIGUOUS','FORMAL_MAPPING_POSTED'].includes(value.mapping_state);

export function assertWbsH1ImportInventory(value,{limit,offset}={}){
  const keys=['schema_version','company_code','currency','date_from','date_to','limit','offset','totals','months','rows','source_mode','accounting_authority','can_create_draft','can_review','can_approve','can_post'];
  if(!exact(value,keys)||value.schema_version!=='WBS_H1_IMPORT_INVENTORY_V1'||!COMPANY.test(value.company_code||'')||!/^[A-Z]{3}$/.test(value.currency||'')||value.date_from!=='2026-01-01'||value.date_to!=='2026-06-30'||value.limit!==limit||value.offset!==offset||!counts(value.totals)||!Array.isArray(value.months)||value.months.length!==6||!Array.isArray(value.rows)||value.rows.length>limit||value.source_mode!=='REAL_WBS_STAGED'||value.accounting_authority!=='NONE'||[value.can_create_draft,value.can_review,value.can_approve,value.can_post].some(Boolean))throw new Error('WBS_H1_IMPORT_INVENTORY_INVALID');
  if(value.months.some((month,index)=>!exact(month,['period_code',...COUNT_KEYS])||month.period_code!==`2026-${String(index+1).padStart(2,'0')}`||!MONTH.test(month.period_code)||!counts(Object.fromEntries(COUNT_KEYS.map(key=>[key,month[key]])))))throw new Error('WBS_H1_IMPORT_INVENTORY_INVALID');
  if(value.rows.some(item=>!row(item))||new Set(value.rows.map(item=>item.source_record_hash)).size!==value.rows.length)throw new Error('WBS_H1_IMPORT_INVENTORY_INVALID');
  const sum=key=>value.months.reduce((total,month)=>total+month[key],0);
  for(const key of COUNT_KEYS.filter(key=>key!=='source_amount'))if(sum(key)!==value.totals[key])throw new Error('WBS_H1_IMPORT_INVENTORY_INVALID');
  return value;
}
