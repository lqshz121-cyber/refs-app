const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const formatAuthoritativeDate=value=>{
  if(typeof value!=='string'||!value)return 'Date unavailable';
  const parsed=ISO_DATE.test(value)?new Date(`${value}T00:00:00.000Z`):new Date(value);
  if(Number.isNaN(parsed.valueOf()))return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(parsed);
};

export function authoritativeScopePresentation(config,coaRows=[]){
  const rows=Array.isArray(coaRows)?coaRows:[];
  const period=rows.find(row=>row?.period_id===config?.periodId&&/^\d{4}-(0[1-9]|1[0-2])$/.test(row?.period_code||''));
  const inEntity=row=>!row?.entity_id||row.entity_id===config?.entityId;
  const scopedRows=rows.filter(row=>inEntity(row));
  const cash=scopedRows.find(row=>row?.account_code===config?.cashAccountCode&&typeof row?.account_name==='string'&&row.account_name.trim());
  const namedEntityRows=scopedRows.filter(row=>row?.entity_id===config?.entityId);
  const entityName=namedEntityRows.find(row=>typeof row?.entity_name==='string'&&row.entity_name.trim())?.entity_name?.trim()
    || namedEntityRows.find(row=>typeof row?.entity_display_name==='string'&&row.entity_display_name.trim())?.entity_display_name?.trim();
  const entityNameReturned=Boolean(entityName);
  const periodReturned=Boolean(period?.period_code);
  return {
    entityLabel:entityName||'Configured entity',
    entityDetail:UUID.test(config?.entityId||'')?config.entityId:'Identifier unavailable',
    entityNameReturned,
    entityHint:entityNameReturned?'':'The authenticated API did not return an entity display name.',
    periodLabel:period?.period_code||'Configured period',
    periodDetail:period?`${formatAuthoritativeDate(period.period_start)} - ${formatAuthoritativeDate(period.period_end)}`:(UUID.test(config?.periodId||'')?config.periodId:'Identifier unavailable'),
    periodReturned,
    periodHint:periodReturned?'':'The authenticated API did not return a period code or date range.',
    cashAccountLabel:cash?`${cash.account_code} - ${cash.account_name}`:(config?.cashAccountCode?`${config.cashAccountCode} - Name unavailable`:'Not configured'),
  };
}
