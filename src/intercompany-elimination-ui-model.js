const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const canonicalDate=value=>DATE.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export function authorizedIntercompanyEliminationScopes(scopes){
 if(!Array.isArray(scopes))return [];
 const seen=new Set();return scopes.filter(scope=>{
  if(!scope||!UUID.test(scope.entity_id||'')||!UUID.test(scope.period_id||'')||!canonicalDate(scope.period_start)||!canonicalDate(scope.period_end)||scope.period_start>scope.period_end||!/^[A-Z]{3}$/.test(scope.base_currency||'')||typeof scope.entity_code!=='string'||typeof scope.entity_name!=='string'||typeof scope.period_code!=='string')return false;
  const key=`${scope.entity_id.toLowerCase()}:${scope.period_id.toLowerCase()}`;if(seen.has(key))return false;seen.add(key);return true;
 });
}

export function alignedIntercompanyCounterpartyScopes(scopes,sourceScope){
 if(!sourceScope)return [];
 return authorizedIntercompanyEliminationScopes(scopes).filter(scope=>scope.entity_id.toLowerCase()!==sourceScope.entity_id.toLowerCase()&&scope.period_start===sourceScope.period_start&&scope.period_end===sourceScope.period_end&&scope.base_currency===sourceScope.base_currency);
}

export const intercompanyEliminationScopeKey=scope=>scope?`${scope.entity_id.toLowerCase()}:${scope.period_id.toLowerCase()}`:'';
