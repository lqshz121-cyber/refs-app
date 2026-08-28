const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

export function createAiIntercompanyControllerScanService({pairReader,reconciliationReader,detector,paymentInvoiceReader,paymentInvoiceDetector}={}){
  if(typeof pairReader!=='function'||typeof reconciliationReader!=='function'||typeof detector!=='function'||typeof paymentInvoiceReader!=='function'||typeof paymentInvoiceDetector!=='function')throw new TypeError('Intercompany Controller scan requires authoritative pair, reconciliation, payment-invoice, and detection boundaries.');
  return Object.freeze({
    async analyze({tenantId,entityId,currentAccountingPeriodId,limit=500}={}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>2000)fail('AI_INTERCOMPANY_SCAN_SCOPE_INVALID','Intercompany Controller scan requires exact tenant, entity, period, and bounded limit.');
      const pairLimit=Math.min(limit,100),pairs=await pairReader({tenantId,entityId,periodId:currentAccountingPeriodId,limit:pairLimit+1});
      if(!Array.isArray(pairs)||pairs.some(pair=>!pair||!UUID.test(pair.counterparty_entity_id||'')||!UUID.test(pair.counterparty_period_id||'')))fail('AI_INTERCOMPANY_COUNTERPARTY_POPULATION_INVALID','Intercompany counterparty discovery returned malformed evidence.');
      if(pairs.length>pairLimit)fail('AI_INTERCOMPANY_COUNTERPARTY_POPULATION_INCOMPLETE','Intercompany counterparty discovery exceeded its bounded complete population limit.');
      const findings=[];
      for(const pair of pairs){
        if(findings.length>=limit)fail('AI_INTERCOMPANY_FINDING_POPULATION_INCOMPLETE','Intercompany findings reached their bounded population limit.');
        const rows=await reconciliationReader({tenantId,entityId,periodId:currentAccountingPeriodId,counterpartyEntityId:pair.counterparty_entity_id,counterpartyPeriodId:pair.counterparty_period_id});
        const remaining=Math.min(limit-findings.length,500),batch=detector(rows,{entityId,counterpartyEntityId:pair.counterparty_entity_id,limit:remaining});
        if(!batch||!Array.isArray(batch.findings))fail('AI_INTERCOMPANY_RECONCILIATION_INVALID','Intercompany reconciliation returned malformed evidence.');
        for(const finding of batch.findings)findings.push(Object.freeze({...finding,accounting_period_id:currentAccountingPeriodId}));
        if(findings.length>=limit)fail('AI_INTERCOMPANY_FINDING_POPULATION_INCOMPLETE','Intercompany findings reached their bounded population limit.');
        const paymentLimit=Math.min(limit-findings.length,500),paymentRows=await paymentInvoiceReader({tenantId,entityId,periodId:currentAccountingPeriodId,counterpartyEntityId:pair.counterparty_entity_id,counterpartyPeriodId:pair.counterparty_period_id,limit:paymentLimit+1});
        const paymentBatch=paymentInvoiceDetector(paymentRows,{entityId,accountingPeriodId:currentAccountingPeriodId,counterpartyEntityId:pair.counterparty_entity_id,counterpartyPeriodId:pair.counterparty_period_id,limit:paymentLimit});
        if(!paymentBatch||!Array.isArray(paymentBatch.findings))fail('AI_INTERCOMPANY_PAYMENT_INVOICE_INVALID','Cross-entity payment-invoice review returned malformed evidence.');
        for(const finding of paymentBatch.findings)findings.push(finding);
        if(findings.length>=limit)fail('AI_INTERCOMPANY_FINDING_POPULATION_INCOMPLETE','Intercompany findings reached their bounded population limit.');
      }
      return Object.freeze({schema_version:'AI_INTERCOMPANY_FULL_CONTROLLER_SCAN_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_counterparty_count:pairs.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
    }
  });
}
