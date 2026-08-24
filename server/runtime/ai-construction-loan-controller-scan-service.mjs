import {classifyConstructionLoanBatch} from './ai-construction-loan-classifier.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const PRESENTATION=Object.freeze({
  BLOCKED:Object.freeze({risk_level:'HIGH',suggested_action:'Resolve the missing, conflicting, or unsupported retained loan evidence before selecting an accounting treatment.'}),
  INTEREST_REVIEW:Object.freeze({risk_level:'MEDIUM',suggested_action:'Review project status and the approved interest-capitalization policy before preparing any Journal Entry.'}),
  LOAN_FEE_REVIEW:Object.freeze({risk_level:'MEDIUM',suggested_action:'Review the loan term and approved deferred-financing-cost policy before preparing any amortization or expense entry.'}),
  ESCROW_RESERVE:Object.freeze({risk_level:'MEDIUM',suggested_action:'Confirm whether the retained amount is an escrow asset, reserve, or lender-controlled liability before preparing any Journal Entry.'}),
  LOAN_DRAW:Object.freeze({risk_level:'LOW',suggested_action:'Confirm the cash and construction-loan payable accounts and source-to-bank match before preparing any Draft Journal Entry.'}),
  PRINCIPAL_REPAYMENT:Object.freeze({risk_level:'LOW',suggested_action:'Confirm the principal allocation, cash account, and lender statement match before preparing any Draft Journal Entry.'})
});

export function createAiConstructionLoanControllerScanService({sourceReader}={}){
  if(typeof sourceReader!=='function')throw Object.assign(new Error('Construction loan Controller scan requires an authoritative source reader'),{code:'AI_LOAN_CONTROLLER_SCAN_CONFIG_INVALID'});
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=500}={}){
      if(typeof tenantId!=='string'||tenantId.length===0||typeof entityId!=='string'||entityId.length===0||typeof accountingPeriodId!=='string'||accountingPeriodId.length===0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Construction loan Controller scan requires exact scope and a bounded limit'),{code:'AI_LOAN_CONTROLLER_SCAN_SCOPE_INVALID'});
      const rows=await sourceReader({tenantId,entityId,accountingPeriodId,limit});
      if(!Array.isArray(rows))throw Object.assign(new Error('Construction loan source reader must return a closed array'),{code:'AI_LOAN_CONTROLLER_SOURCE_INVALID'});
      if(rows.length>=limit)throw Object.assign(new Error('The bounded construction loan source read cannot prove population completeness'),{code:'AI_LOAN_CONTROLLER_POPULATION_INCOMPLETE'});
      const results=rows.length===0?[]:classifyConstructionLoanBatch(rows).results;
      const findings=Object.freeze(results.map(row=>Object.freeze({...row,entity_id:entityId,accounting_period_id:accountingPeriodId,...PRESENTATION[row.classification]})));
      return Object.freeze({schema_version:'AI_CONSTRUCTION_LOAN_TRANSACTION_CONTROLLER_SCAN_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_source_line_count:rows.length,finding_count:findings.length,findings,action_flags:ACTIONS});
    }
  });
}
