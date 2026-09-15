const CONTROLS=Object.freeze([
  Object.freeze({bankMemberRef:'INTERNAL_TEST_BANK',cashAccountCode:'111990',currency:'USD',effectiveFrom:'2026-01-01',effectiveTo:'2026-09-14'}),
  Object.freeze({bankMemberRef:'INTERNAL_TEST_BANK_DESTINATION',cashAccountCode:'111991',currency:'USD',effectiveFrom:'2026-01-01',effectiveTo:null})
]);

export async function bootstrapInternalTestCashControls({makerKernel,approverKernel,tenantId,entityId}={}){
  if(!makerKernel||typeof makerKernel.createCashTransferBankAccountControl!=='function'||typeof makerKernel.readCashTransferBankAccountControls!=='function'||!approverKernel||typeof approverKernel.approveCashTransferBankAccountControl!=='function')throw new Error('Internal-test cash-control bootstrap kernels are unavailable');
  const existing=await makerKernel.readCashTransferBankAccountControls({tenantId,entityId,asOfDate:null});
  const rows=Array.isArray(existing?.rows)?existing.rows:[];
  for(const control of CONTROLS){
    const key=`internal-test-cash-control-v2-${control.bankMemberRef.toLowerCase()}-${entityId}`;
    const found=rows.find(row=>row.bank_member_ref===control.bankMemberRef&&row.cash_account_code===control.cashAccountCode&&row.currency===control.currency&&row.effective_from===control.effectiveFrom&&(row.effective_to??null)===(control.effectiveTo??null));
    if(found?.status==='APPROVED')continue;
    const created=found??await makerKernel.createCashTransferBankAccountControl({...control,tenantId,entityId,idempotencyKey:key});
    if(created.status!=='APPROVED')await approverKernel.approveCashTransferBankAccountControl({tenantId,entityId,controlId:created.cash_transfer_bank_account_control_id??created.control_id,expectedVersion:created.revision,idempotencyKey:`${key}-approve`});
  }
  return CONTROLS;
}

export {CONTROLS as INTERNAL_TEST_CASH_CONTROLS};
