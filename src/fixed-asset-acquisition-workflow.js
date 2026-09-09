const RESUMABLE_STATUSES=new Set(['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED']);

export const canResumeFixedAssetAcquisitionJournal=status=>RESUMABLE_STATUSES.has(status);

export const resolveFixedAssetAcquisitionJournalScope=(config,scopeCatalog,periodId)=>
  Array.isArray(scopeCatalog)?scopeCatalog.find(row=>row.entity_id===config?.entityId&&row.period_id===periodId)||null:null;
