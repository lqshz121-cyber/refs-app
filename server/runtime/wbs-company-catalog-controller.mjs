import {canonicalRequestHash} from './request-hash.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const CURRENCY=/^[A-Z]{3}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEY=/(?:^|_)(?:authorization|cookie|credential|password|secret|token|api_?key|private_?key)(?:$|_)/i;
const TOP=['catalogVersion','generatedAt','providerEnvironment','source','accountBookControl','companies'];
const SOURCE=['name','version','rawFileHash','catalogHash','rowControl'];
const ROW_CONTROL=['sourceRowCount','acceptedRowCount','rejectedRows'];
const REJECT=['sourceRowKey','reason','rowHash'];
const BOOK_CONTROL=['total','open','closed','companiesWithBooks'];
const COMPANY_FIELDS=['companyCode','wbsCompanyId','displayName','legalName','activeStatus','entityType','baseCurrency','operationallyActive2026','accountBooks','accountBookCount','openAccountBookCount','domains'];
const BOOK_FIELDS=['accountBookId','accountName','accountStatus','externalCompanyId'];
const DOMAIN_FIELDS=['rowCount','minDate','maxDate','pbStatus','reconStart'];
const DOMAIN_NAMES=new Set(['PAYABLES','BANK','JOURNAL','AUTOREC']);

export class WbsCompanyCatalogControllerError extends Error{
  constructor(code,message){super(message);this.name='WbsCompanyCatalogControllerError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsCompanyCatalogControllerError(code,message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys,label)=>{if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!keys.includes(key)))fail('WBS_COMPANY_CATALOG_INVALID',`${label} has an invalid shape.`);};
const cleanText=(value,max)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const date=value=>{if(typeof value!=='string'||!DATE.test(value))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;};
const utc=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value));
const assertNoCredentials=(value,path='catalog')=>{if(!object(value)&&!Array.isArray(value))return;for(const [key,item] of Object.entries(value)){if(FORBIDDEN_KEY.test(key))fail('WBS_COMPANY_CATALOG_CREDENTIAL_FORBIDDEN',`${path}.${key} is credential-like and cannot be retained.`);assertNoCredentials(item,`${path}.${key}`);}};
const nullableText=(value,max)=>value==null?null:(cleanText(value,max)?value:null);
const normalizeDate=value=>typeof value==='string'&&value.length>=10?value.slice(0,10):value;

export function wbsCompanyCatalogCanonicalHash(value){
  exact(value,TOP,'catalog');
  const source=value.source;
  if(!object(source))fail('WBS_COMPANY_CATALOG_INVALID','source has an invalid shape.');
  return canonicalRequestHash({catalogVersion:value.catalogVersion,generatedAt:value.generatedAt,providerEnvironment:value.providerEnvironment,source:{name:source.name,version:source.version,rawFileHash:source.rawFileHash,rowControl:source.rowControl},accountBookControl:value.accountBookControl,companies:value.companies});
}

function normalizeReject(value,index){
  exact(value,REJECT,`source.rowControl.rejectedRows[${index}]`);
  if(!cleanText(value.sourceRowKey,256)||!cleanText(value.reason,1000)||!HASH.test(value.rowHash||''))fail('WBS_COMPANY_CATALOG_INVALID',`source.rowControl.rejectedRows[${index}] is invalid.`);
  return {source_row_key:value.sourceRowKey,reason:value.reason,row_hash:value.rowHash};
}

function finding(severity,code,message,details={},rowOrdinal=null){
  const value={row_ordinal:rowOrdinal,severity,code,message,details};
  return Object.freeze({...value,finding_hash:canonicalRequestHash(value)});
}

function normalizeDomain(value,name,rowOrdinal,findings,generatedDate){
  if(!object(value)){findings.push(finding('ERROR','DOMAIN_SHAPE_INVALID',`${name} coverage must be an object.`,{domain:name},rowOrdinal));return {};}
  if(Object.keys(value).some(key=>!DOMAIN_FIELDS.includes(key)))findings.push(finding('ERROR','DOMAIN_FIELD_UNEXPECTED',`${name} contains an unexpected field.`,{domain:name},rowOrdinal));
  const rowCount=value.rowCount;
  if(name!=='AUTOREC'&&!integer(rowCount))findings.push(finding('ERROR','DOMAIN_ROW_COUNT_INVALID',`${name} row count must be a non-negative integer.`,{domain:name},rowOrdinal));
  const minDate=normalizeDate(value.minDate),maxDate=normalizeDate(value.maxDate);
  if(name!=='AUTOREC'&&integer(rowCount)&&rowCount>0&&(!date(minDate)||!date(maxDate)))findings.push(finding('ERROR','POSITIVE_COUNT_DATE_RANGE_REQUIRED',`${name} positive coverage requires min and max dates.`,{domain:name,row_count:rowCount},rowOrdinal));
  if(date(minDate)&&date(maxDate)&&minDate>maxDate)findings.push(finding('ERROR','DOMAIN_DATE_RANGE_INVALID',`${name} minimum date follows maximum date.`,{domain:name,min_date:minDate,max_date:maxDate},rowOrdinal));
  if(date(maxDate)&&maxDate>generatedDate)findings.push(finding('REVIEW','FUTURE_DATED_SOURCE_ACTIVITY',`${name} contains a date after catalog generation.`,{domain:name,max_date:maxDate,generated_date:generatedDate},rowOrdinal));
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key.replace(/[A-Z]/g,letter=>`_${letter.toLowerCase()}`),item]));
}

function normalizeCompany(value,rowOrdinal,generatedDate){
  if(!object(value))fail('WBS_COMPANY_CATALOG_INVALID',`companies[${rowOrdinal}] must be an object.`);
  if(Object.keys(value).some(key=>!COMPANY_FIELDS.includes(key)))fail('WBS_COMPANY_CATALOG_INVALID',`companies[${rowOrdinal}] contains an unexpected field.`);
  for(const key of COMPANY_FIELDS)if(!Object.hasOwn(value,key))fail('WBS_COMPANY_CATALOG_INVALID',`companies[${rowOrdinal}] is missing ${key}.`);
  if(!Array.isArray(value.accountBooks)||value.accountBooks.length>500||!object(value.domains))fail('WBS_COMPANY_CATALOG_INVALID',`companies[${rowOrdinal}] has invalid accountBooks or domains.`);
  const findings=[];
  const companyCode=cleanText(value.companyCode,64)?value.companyCode:null;
  if(!COMPANY.test(companyCode||''))findings.push(finding('ERROR','COMPANY_CODE_INVALID','Company code must be canonical uppercase WBS identity.',{observed:value.companyCode??null},rowOrdinal));
  if(!cleanText(value.wbsCompanyId,128))findings.push(finding('ERROR','WBS_COMPANY_ID_MISSING','WBS company identity is missing.',{},rowOrdinal));
  if(!cleanText(value.displayName,200)||!cleanText(value.legalName,200))findings.push(finding('REVIEW','COMPANY_NAME_REQUIRES_CONTROLLER','Display and legal names require Controller confirmation.',{},rowOrdinal));
  if([value.displayName,value.legalName].some(name=>typeof name==='string'&&/(?:¨C|脧|锛|�)/u.test(name)))findings.push(finding('REVIEW','COMPANY_NAME_ENCODING_SUSPECT','Company name contains a known encoding-corruption marker.',{},rowOrdinal));
  if(typeof value.displayName==='string'&&/\(Consolidated\)\s*$/i.test(value.displayName))findings.push(finding('REVIEW','CONSOLIDATION_NODE_CLASSIFICATION_REQUIRED','A consolidation node cannot be approved as a direct legal-entity binding.',{},rowOrdinal));
  if(!['ACTIVE','INACTIVE','CLOSED'].includes(value.activeStatus))findings.push(finding('REVIEW','ACTIVE_STATUS_REQUIRES_CONTROLLER','Source does not provide an approval-ready active status.',{observed:value.activeStatus??null},rowOrdinal));
  if(!['LEGAL_ENTITY','CONSOLIDATION','INACTIVE','TEST','OTHER'].includes(value.entityType))findings.push(finding('REVIEW','ENTITY_TYPE_REQUIRES_CONTROLLER','Entity type requires Controller classification.',{observed:value.entityType??null},rowOrdinal));
  if(!CURRENCY.test(value.baseCurrency||''))findings.push(finding('ERROR','BASE_CURRENCY_INVALID','Base currency must be an authoritative ISO currency.',{observed:value.baseCurrency??null},rowOrdinal));
  const books=value.accountBooks.map((book,index)=>{
    if(!object(book)||Object.keys(book).some(key=>!BOOK_FIELDS.includes(key))||BOOK_FIELDS.some(key=>!Object.hasOwn(book,key)))fail('WBS_COMPANY_CATALOG_INVALID',`companies[${rowOrdinal}].accountBooks[${index}] has an invalid shape.`);
    if(!cleanText(book.accountBookId,128)||!['O','C'].includes(book.accountStatus)||!cleanText(book.accountName,256))findings.push(finding('ERROR','ACCOUNT_BOOK_INVALID','Account book identity, name, or status is invalid.',{account_book_index:index},rowOrdinal));
    return {account_book_id:book.accountBookId,account_name:book.accountName,account_status:book.accountStatus,external_company_id:book.externalCompanyId??null};
  });
  if(!integer(value.accountBookCount)||value.accountBookCount!==books.length)findings.push(finding('ERROR','ACCOUNT_BOOK_COUNT_MISMATCH','Per-company account book count does not match retained detail.',{declared:value.accountBookCount,recomputed:books.length},rowOrdinal));
  const open=books.filter(book=>book.account_status==='O').length;
  if(!integer(value.openAccountBookCount)||value.openAccountBookCount!==open)findings.push(finding('ERROR','OPEN_ACCOUNT_BOOK_COUNT_MISMATCH','Per-company open account book count does not match retained detail.',{declared:value.openAccountBookCount,recomputed:open},rowOrdinal));
  const domains={};
  for(const [name,domain] of Object.entries(value.domains)){if(!DOMAIN_NAMES.has(name)){findings.push(finding('ERROR','DOMAIN_UNSUPPORTED','Catalog contains an unsupported source domain.',{domain:name},rowOrdinal));continue;}domains[name]=normalizeDomain(domain,name,rowOrdinal,findings,generatedDate);}
  findings.push(finding('INFO','CATALOG_ROW_RETAINED','Candidate row was retained without granting admission or accounting authority.',{company_code:companyCode},rowOrdinal));
  const row={row_ordinal:rowOrdinal,company_code:companyCode,wbs_company_id:nullableText(value.wbsCompanyId,128),display_name:nullableText(value.displayName,200),legal_name:nullableText(value.legalName,200),active_status:nullableText(value.activeStatus,64),entity_type:nullableText(value.entityType,64),base_currency:nullableText(value.baseCurrency,3),operationally_active_2026:value.operationallyActive2026===true,account_books:books,domains,account_book_count:integer(value.accountBookCount)?value.accountBookCount:0,open_account_book_count:integer(value.openAccountBookCount)?value.openAccountBookCount:0};
  return {row:Object.freeze({...row,row_hash:canonicalRequestHash(row)}),findings};
}

export function normalizeWbsCompanyCatalogCandidate(value){
  assertNoCredentials(value);exact(value,TOP,'catalog');exact(value.source,SOURCE,'source');exact(value.source.rowControl,ROW_CONTROL,'source.rowControl');exact(value.accountBookControl,BOOK_CONTROL,'accountBookControl');
  if(!cleanText(value.catalogVersion,128)||!utc(value.generatedAt)||value.providerEnvironment!=='PRODUCTION'||!cleanText(value.source.name,128)||!cleanText(value.source.version,128)||!HASH.test(value.source.rawFileHash||'')||!HASH.test(value.source.catalogHash||'')||!Array.isArray(value.source.rowControl.rejectedRows)||value.source.rowControl.rejectedRows.length>1000||!Array.isArray(value.companies)||value.companies.length<1||value.companies.length>500)fail('WBS_COMPANY_CATALOG_INVALID','Catalog header, source metadata, or bounded company rows are invalid.');
  if(value.source.catalogHash!==wbsCompanyCatalogCanonicalHash(value))fail('WBS_COMPANY_CATALOG_HASH_MISMATCH','Catalog hash does not bind the exact canonical catalog.');
  const rejected=value.source.rowControl.rejectedRows.map(normalizeReject),accepted=value.source.rowControl.acceptedRowCount,sourceCount=value.source.rowControl.sourceRowCount;
  if(!integer(accepted)||!integer(sourceCount)||accepted!==value.companies.length||sourceCount!==accepted+rejected.length)fail('WBS_COMPANY_CATALOG_SOURCE_CONTROL_INVALID','Source row count must equal retained plus explicitly hashed rejected rows.');
  for(const key of BOOK_CONTROL)if(!integer(value.accountBookControl[key]))fail('WBS_COMPANY_CATALOG_INVALID',`accountBookControl.${key} must be a non-negative integer.`);
  const generatedDate=new Date(value.generatedAt).toISOString().slice(0,10),normalized=value.companies.map((company,index)=>normalizeCompany(company,index,generatedDate));
  const rows=normalized.map(item=>item.row),findings=normalized.flatMap(item=>item.findings);
  const codeIndexes=new Map();for(const row of rows){if(!row.company_code)continue;const list=codeIndexes.get(row.company_code)||[];list.push(row.row_ordinal);codeIndexes.set(row.company_code,list);}for(const [code,indexes] of codeIndexes)if(indexes.length>1)for(const index of indexes)findings.push(finding('ERROR','COMPANY_CODE_DUPLICATE','Company code appears more than once in the retained catalog.',{company_code:code,rows:indexes},index));
  const bookIndexes=new Map(),externalIndexes=new Map();for(const row of rows)for(const book of row.account_books){if(book.account_book_id){const list=bookIndexes.get(book.account_book_id)||[];list.push(row.row_ordinal);bookIndexes.set(book.account_book_id,list);}if(book.external_company_id!==null){const key=String(book.external_company_id),set=externalIndexes.get(key)||new Set();if(row.company_code)set.add(row.company_code);externalIndexes.set(key,set);}}
  for(const [id,indexes] of bookIndexes)if(indexes.length>1)for(const index of indexes)findings.push(finding('ERROR','ACCOUNT_BOOK_ID_DUPLICATE','Account book ID is duplicated across company rows.',{account_book_id:id,rows:indexes},index));
  for(const [id,codes] of externalIndexes)if(codes.size>1)for(const code of codes){const index=rows.find(row=>row.company_code===code)?.row_ordinal??null;findings.push(finding('REVIEW','EXTERNAL_COMPANY_ID_NOT_MAPPING_KEY','External company ID is shared by multiple company codes.',{external_company_id:id,company_codes:[...codes].sort()},index));}
  const recomputed={total:rows.reduce((sum,row)=>sum+row.account_books.length,0),open:rows.reduce((sum,row)=>sum+row.account_books.filter(book=>book.account_status==='O').length,0),closed:rows.reduce((sum,row)=>sum+row.account_books.filter(book=>book.account_status==='C').length,0),companiesWithBooks:rows.filter(row=>row.account_books.length>0).length};
  for(const [key,code] of [['total','ACCOUNT_BOOK_TOTAL_MISMATCH'],['open','ACCOUNT_BOOK_OPEN_MISMATCH'],['closed','ACCOUNT_BOOK_CLOSED_MISMATCH'],['companiesWithBooks','ACCOUNT_BOOK_COMPANY_COUNT_MISMATCH']])if(value.accountBookControl[key]!==recomputed[key])findings.push(finding('ERROR',code,'Catalog account book control does not reconcile to retained detail.',{declared:value.accountBookControl[key],recomputed:recomputed[key]}));
  const catalog={catalog_version:value.catalogVersion,generated_at:new Date(value.generatedAt).toISOString(),provider_environment:'PRODUCTION',source_name:value.source.name,source_version:value.source.version,raw_file_hash:value.source.rawFileHash,catalog_hash:value.source.catalogHash,source_control:{source_row_count:sourceCount,accepted_row_count:accepted,rejected_row_count:rejected.length,rejected_rows:rejected},account_book_control:{declared_total:value.accountBookControl.total,declared_open:value.accountBookControl.open,declared_closed:value.accountBookControl.closed,declared_companies_with_books:value.accountBookControl.companiesWithBooks,recomputed_total:recomputed.total,recomputed_open:recomputed.open,recomputed_closed:recomputed.closed,recomputed_companies_with_books:recomputed.companiesWithBooks},rows,findings};
  return Object.freeze(catalog);
}

export function normalizeWbsCompanyClassification(value){
  const keys=['companyCode','displayName','legalName','entityType','activeStatus','baseCurrency'];exact(value,keys,'classification');
  if(!COMPANY.test(value.companyCode||'')||!cleanText(value.displayName,200)||!cleanText(value.legalName,200)||!['LEGAL_ENTITY','CONSOLIDATION','INACTIVE','TEST','OTHER'].includes(value.entityType)||!['ACTIVE','INACTIVE','CLOSED'].includes(value.activeStatus)||!CURRENCY.test(value.baseCurrency||''))fail('WBS_COMPANY_CLASSIFICATION_INVALID','Controller classification is invalid.');
  return Object.freeze({company_code:value.companyCode,display_name:value.displayName,legal_name:value.legalName,entity_type:value.entityType,active_status:value.activeStatus,base_currency:value.baseCurrency});
}
