import {canonicalRequestHash} from './request-hash.mjs';
import {buildWbsLivePilotObservation} from './wbs-live-pilot-read-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const BARE_HASH=/^[0-9a-f]{64}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const isoDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;};
const text=value=>value==null?'':String(value).trim();
const freeze=value=>Object.freeze(value);

export class WbsOperatorAttestedPayableError extends Error{
  constructor(code,message){super(message);this.name='WbsOperatorAttestedPayableError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsOperatorAttestedPayableError(code,message);};

export function createWbsOperatorAttestedPayableService({client,kernel}={}){
  if(!client||typeof client.initialize!=='function'||typeof client.listTools!=='function'||typeof client.readView!=='function'||!kernel||typeof kernel.assertWbsOperatorPayableAttest!=='function'||typeof kernel.attestWbsOperatorPayables!=='function')fail('WBS_OPERATOR_ATTEST_CONFIG_INVALID','Operator-attested WBS Payable requires the read client and persistence kernel.');
  let ready=null;
  const prepare=()=>ready??=(async()=>{await client.initialize();await client.listTools();return true;})().catch(error=>{ready=null;throw error;});
  return freeze({
    mode:'WBS_OPERATOR_ATTESTED_PAYABLE_V1',
    async attest({tenantId,entityId,expectedObservationHash,expectedProviderContentSha256,expectedCompanyCode=null,dateFrom=null,dateTo=null,reason,limit,idempotencyKey}={}){
      const company=expectedCompanyCode==null||expectedCompanyCode===''?null:text(expectedCompanyCode),hasDates=dateFrom!=null||dateTo!=null;
      if(!UUID.test(text(tenantId))||!UUID.test(text(entityId))||!HASH.test(text(expectedObservationHash))||!BARE_HASH.test(text(expectedProviderContentSha256))||!Number.isSafeInteger(limit)||limit<1||limit>10||text(reason).length<8||text(reason).length>2000||(company!==null&&!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/.test(company))||(hasDates&&(!isoDate(dateFrom)||!isoDate(dateTo)||dateFrom>dateTo)))fail('WBS_OPERATOR_ATTEST_INPUT_INVALID','Exact observation hashes, reason, scope, and limit are required.');
      await kernel.assertWbsOperatorPayableAttest({tenantId,entityId});
      let observed;
      const providerArgs={limit};if(company!==null)providerArgs.company_code=company;if(hasDates){providerArgs.date_from=dateFrom;providerArgs.date_to=dateTo;}
      try{await prepare();observed=await client.readView({toolName:'list_payables',args:providerArgs});}catch{fail('WBS_OPERATOR_ATTEST_PROVIDER_UNAVAILABLE','The WBS Payable provider response was unavailable or unsafe.');}
      const publicObservation=buildWbsLivePilotObservation({observed,entityId,tool:'list_payables',requestedScope:{company_code:company,date_from:hasDates?dateFrom:null,date_to:hasDates?dateTo:null}});
      if(publicObservation.observation_hash!==expectedObservationHash||publicObservation.provider_content_sha256!==expectedProviderContentSha256)fail('WBS_OPERATOR_ATTEST_STALE_OBSERVATION','WBS Payable evidence changed; refresh the GET-only observation before attesting.');
      if(publicObservation.record_count===0)fail('WBS_OPERATOR_ATTEST_EMPTY','An empty WBS Payable observation cannot be operator-attested.');
      const ids=new Set();
      const rows=observed.rows.map(raw=>{
        if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('WBS_OPERATOR_ATTEST_ROW_INVALID','Every WBS Payable row must be an object.');
        const sourceRecordId=text(raw.ap_guid);
        if(!sourceRecordId||sourceRecordId.length>128||CONTROL.test(sourceRecordId)||ids.has(sourceRecordId))fail('WBS_OPERATOR_ATTEST_ROW_INVALID','Every WBS Payable row requires one unique immutable ap_guid.');
        ids.add(sourceRecordId);
        const rowHash=canonicalRequestHash(raw),captured=text(observed.captured_at);
        return freeze({source_record_id:sourceRecordId,source_version:`operator:${captured}:${rowHash.slice(7,39)}`,row_hash:rowHash,raw:structuredClone(raw)});
      });
      const rowCompanyCodes=[...new Set(observed.rows.map(row=>text(row?.company_code)).filter(Boolean))].sort();
      const providerCompanyCodes=[...new Set(publicObservation.scope.company_codes.map(text).filter(Boolean))].sort();
      const companyCodes=providerCompanyCodes.length?providerCompanyCodes:rowCompanyCodes;
      if(companyCodes.length>10||rowCompanyCodes.some(value=>!companyCodes.includes(value)))fail('WBS_OPERATOR_ATTEST_SCOPE_INVALID','Operator attestation company evidence is inconsistent with the provider observation.');
      let persisted;
      try{persisted=await kernel.attestWbsOperatorPayables({tenantId,entityId,capturedAt:observed.captured_at,providerContentHash:`sha256:${observed.content_sha256}`,observationHash:publicObservation.observation_hash,companyCodes,rows,reason:text(reason),idempotencyKey});}
      catch(cause){throw cause;}
      if(!persisted||persisted.status!=='EXCEPTION_REVIEW_REQUIRED'||persisted.provenance_mode!=='OPERATOR_ATTESTED'||persisted.signature_verified!==false||!['UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED'].includes(persisted.company_scope_status)||['can_import_to_staging','can_review','can_create_draft','can_approve','can_post'].some(flag=>persisted[flag]!==false))fail('WBS_OPERATOR_ATTEST_RESULT_INVALID','Operator attestation returned an unsafe persistence result.');
      return freeze(persisted);
    }
  });
}
