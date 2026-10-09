import {KernelError} from './db.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=()=>{throw new KernelError('WBS_BANK_REQUEST_SCOPE_DENIED','An explicit single-company H1 month and at most ten Bank records are required');};
function validateConfiguredScope(scope){
  if(!UUID.test(scope?.tenantId||'')||!UUID.test(scope?.entityId||'')||!UUID.test(scope?.periodId||'')||!/^[A-Z0-9][A-Z0-9_:-]{0,63}$/.test(scope?.companyCode||'')||!/^2026-0[1-6]-01$/.test(scope?.dateFrom||'')||scope?.dateTo!==new Date(Date.UTC(2026,Number(scope.dateFrom.slice(5,7)),0)).toISOString().slice(0,10))throw new KernelError('WBS_BANK_REQUEST_CONFIG_INVALID','Exact configured Bank request scope required');
}

// Import-only adapter candidate. Never wire this into range, START or Match.
// Pure scope validation is not authorization: the authenticated caller kernel
// must assert the new database request permission before Provider or service work.
export function createBoundedBankRequestAuthorizer({kernel,scope}={}){
  if(typeof kernel?.assertBoundedWbsBankImportRequest!=='function')throw new KernelError('WBS_BANK_REQUEST_CONFIG_INVALID','Authenticated request kernel required');
  validateConfiguredScope(scope);
  const configured=Object.freeze({...scope});
  return async selection=>{
    if(!selection||selection.tenantId!==configured.tenantId||selection.entityId!==configured.entityId||selection.companyCode!==configured.companyCode||selection.periodId!==configured.periodId||selection.dateFrom!==configured.dateFrom||selection.dateTo!==configured.dateTo||!Number.isSafeInteger(selection.limit)||selection.limit<1||selection.limit>10)deny();
    const month=selection.dateFrom?.slice(0,7);
    if(!/^2026-0[1-6]$/.test(month||'')||selection.dateFrom!==`${month}-01`||selection.dateTo!==new Date(Date.UTC(2026,Number(month.slice(5)),0)).toISOString().slice(0,10))deny();
    await kernel.assertBoundedWbsBankImportRequest({tenantId:selection.tenantId,entityId:selection.entityId,periodId:selection.periodId,companyCode:selection.companyCode,dateFrom:selection.dateFrom,dateTo:selection.dateTo,limit:selection.limit});
    return true;
  };
}

export function boundedBankRequestConfig(environment,importScope){
  const mode=String(environment.REFS_WBS_BANK_REQUEST_MODE||'DISABLED').trim().toUpperCase();
  if(mode==='DISABLED')return null;
  if(mode!=='ENABLED'||environment.REFS_DEPLOYMENT_ENV!=='staging'||!importScope)throw new KernelError('WBS_BANK_REQUEST_CONFIG_INVALID','Bank request mode requires explicit staging import scope');
  const scope={tenantId:importScope.tenantId,entityId:importScope.entityId,companyCode:importScope.companyCode,periodId:environment.REFS_WBS_BANK_REQUEST_PERIOD_ID,dateFrom:environment.REFS_WBS_BANK_REQUEST_DATE_FROM,dateTo:environment.REFS_WBS_BANK_REQUEST_DATE_TO};
  // Validate configuration only; no permission is issued or asserted at startup.
  validateConfiguredScope(scope);
  return Object.freeze(scope);
}

export async function boundedBankRequestReady(pool){
  const present=await pool.query("SELECT COALESCE(has_function_privilege('refs_app',to_regprocedure('refs_assert_bounded_wbs_bank_import_request(uuid,uuid,uuid,text,date,date,integer)'),'EXECUTE'),false) AND COALESCE(has_function_privilege('refs_app',to_regprocedure('refs_bounded_wbs_bank_request_ready()'),'EXECUTE'),false) AS ready");
  if(present.rows?.[0]?.ready!==true)return false;
  const result=await pool.query('SELECT refs_bounded_wbs_bank_request_ready() AS ready');
  return result.rows?.[0]?.ready===true;
}
