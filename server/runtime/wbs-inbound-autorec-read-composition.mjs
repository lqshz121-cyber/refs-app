import {canonicalRequestHash} from './request-hash.mjs';
import {projectPersistedWbsInboundAutoRec} from './wbs-inbound-autorec-projection.mjs';

const text=value=>value==null?'':String(value).trim();
const freeze=value=>Object.freeze(value);
const empty=(code,replayed=false)=>freeze({status:'BLOCKED',code,replayed,candidates:freeze([]),exceptions:freeze([freeze({stage:'EXCEPTION',code,can_dispatch:false,can_post:false})]),controls:freeze({candidate_count:0,can_dispatch:false,can_post:false}),can_dispatch:false,can_create_draft:false,can_post:false});
const selectionFor=input=>{
  const tenantId=text(input?.tenantId),entityId=text(input?.entityId),companyKey=text(input?.companyKey),replayKey=text(input?.replayKey);
  const sourceRecordIds=[...new Set((input?.sourceRecordIds||[]).map(text).filter(Boolean))].sort();
  if(!tenantId||!entityId||!companyKey||!replayKey||!sourceRecordIds.length)return null;
  return freeze({tenantId,entityId,companyKey,sourceRecordIds:freeze(sourceRecordIds),replayKey});
};
const scoped=(rows,selection)=>Array.isArray(rows)&&rows.every(row=>row&&text(row.tenant_id)===selection.tenantId&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey&&selection.sourceRecordIds.includes(text(row.source_record_id)));

// Composition-only seam. The injected repository is read-only and must return
// persisted rows; this module never opens a transaction or dispatches a JE.
export function createWbsInboundAutoRecReadComposition({repository}={}){
  const replays=new Map();
  return freeze({
    async read(input={}){
      const selection=selectionFor(input);if(!selection)return empty('WBS_AUTOREC_READ_SELECTION_INVALID');
      const requestHash=canonicalRequestHash({tenantId:selection.tenantId,entityId:selection.entityId,companyKey:selection.companyKey,sourceRecordIds:selection.sourceRecordIds});
      const prior=replays.get(selection.replayKey);if(prior){if(prior.request_hash!==requestHash)return empty('WBS_AUTOREC_READ_REPLAY_CONFLICT',true);return freeze({...prior.result,replayed:true});}
      const methods=['readPersistedWbsInboundRows','readPersistedWbsControlRows','readApprovedWbsAutoRecMappings'];
      if(!repository||methods.some(name=>typeof repository[name]!=='function'))return empty('WBS_AUTOREC_READ_CAPABILITY_UNAVAILABLE');
      let inbound,control,mappings;
      try{[inbound,control,mappings]=await Promise.all([repository.readPersistedWbsInboundRows({...selection,read_only:true}),repository.readPersistedWbsControlRows({...selection,read_only:true}),repository.readApprovedWbsAutoRecMappings({...selection,read_only:true})]);}catch{return empty('WBS_AUTOREC_READ_FAILED');}
      if(!scoped(inbound,selection)||!control||!scoped(control.companyRows,selection)||!scoped(control.detailRows,selection)||!scoped(control.persistedRows,selection)||!Array.isArray(mappings)||!mappings.every(row=>row&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey))return empty('WBS_AUTOREC_READ_SCOPE_INVALID');
      const projection=projectPersistedWbsInboundAutoRec({rows:inbound,mappings,companyControlRows:control.companyRows,detailControlRows:control.detailRows,persistedControlRows:control.persistedRows,scope:{tenant_id:selection.tenantId,entity_id:selection.entityId,company_key:selection.companyKey}});
      const result=freeze({status:'READ_ONLY_PROJECTED',request_hash:requestHash,replayed:false,...projection,can_dispatch:false,can_create_draft:false,can_post:false});
      replays.set(selection.replayKey,freeze({request_hash:requestHash,result}));return result;
    }
  });
}
