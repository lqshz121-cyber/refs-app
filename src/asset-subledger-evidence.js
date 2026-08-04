const ASSET_META = Object.freeze({
  '161000':{label:'Land',status:'IN_SERVICE_BASIS_REVIEW',depreciation:'LAND_NOT_DEPRECIATED'},
  '162000':{label:'Land improvements',status:'IN_SERVICE_BASIS_REVIEW',depreciation:'NO_LOCAL_SCHEDULE'},
  '163000':{label:'Buildings',status:'IN_SERVICE_BASIS_REVIEW',depreciation:'NO_LOCAL_SCHEDULE'},
  '164100':{label:'CWIP - Land',status:'IN_CONSTRUCTION',depreciation:'CWIP_NOT_DEPRECIATED'},
  '164200':{label:'Construction in progress',status:'IN_CONSTRUCTION',depreciation:'CWIP_NOT_DEPRECIATED'},
  '164400':{label:'CWIP - Land improvements',status:'IN_CONSTRUCTION',depreciation:'CWIP_NOT_DEPRECIATED'},
  '164500':{label:'Capitalized interest',status:'IN_CONSTRUCTION',depreciation:'CWIP_NOT_DEPRECIATED'},
  '165901':{label:'Investment homes',status:'IN_SERVICE_BASIS_REVIEW',depreciation:'NO_LOCAL_SCHEDULE'},
});
const amount = line => Number(line.debit_amount || 0) - Number(line.credit_amount || 0);
const keyFor = (code, line) => [code, line.property_id || '', line.project_id || '', line.loan_id || ''].join('|');

// Local aggregate asset subledger. It does not establish a tax basis,
// depreciation schedule, transfer to service, disposal, or reversal chain.
export function localAssetSubledger(journals = [], { entityId = null, toPeriod = '' } = {}) {
  const rows = new Map();
  journals.filter(journal => journal.posting_status === 'POSTED'
    && (!entityId || journal.entity_id === entityId)
    && (!toPeriod || journal.period_code <= toPeriod))
    .forEach(journal => (journal.lines || []).forEach(line => {
      const meta = ASSET_META[line.account_code];
      if (!meta) return;
      const key = keyFor(line.account_code, line);
      const current = rows.get(key) || {key,account_code:line.account_code,property_id:line.property_id || null,project_id:line.project_id || null,loan_id:line.loan_id || null,cost:0,journal_numbers:[],source_systems:[]};
      current.cost += amount(line);
      if (!current.journal_numbers.includes(journal.je_number)) current.journal_numbers.push(journal.je_number);
      if (!current.source_systems.includes(journal.source_system || 'LOCAL_JE')) current.source_systems.push(journal.source_system || 'LOCAL_JE');
      rows.set(key,current);
    }));
  return [...rows.values()].filter(row => Math.abs(row.cost) >= 0.005).map(row => ({
    ...row,
    cost:+row.cost.toFixed(2),
    label:ASSET_META[row.account_code].label,
    status:ASSET_META[row.account_code].status,
    depreciation_state:ASSET_META[row.account_code].depreciation,
  })).sort((left,right) => left.account_code.localeCompare(right.account_code) || left.key.localeCompare(right.key));
}

export function localAssetSubledgerControl(rows = []) {
  const total = rows.reduce((sum,row) => sum + Number(row.cost || 0), 0);
  const cwip = rows.filter(row => row.status === 'IN_CONSTRUCTION').reduce((sum,row) => sum + Number(row.cost || 0), 0);
  const inService = total - cwip;
  return {total:+total.toFixed(2),cwip:+cwip.toFixed(2),inService:+inService.toFixed(2),state:'LOCAL_POSTED_ASSET_EVIDENCE'};
}
