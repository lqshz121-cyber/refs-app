// Presentation only: these rows were already read and validated by the API client.
// Filtering and paging never create evidence or change command eligibility.
export const RECONCILIATION_WORKSHEET_PAGE_SIZE=50;
const FILTERS=new Set(['ALL','MATCHED','UNMATCHED','CLEARED','NOT_CLEARED']);
const searchable=row=>[row.external_bank_line_id,row.bank_source_id,row.journal_entry_id,row.transaction_date,row.amount,row.currency,row.match_status,row.clearance_state].filter(value=>value!==null&&value!==undefined).join(' ').toLocaleLowerCase();

export function reconciliationWorksheetPage(rows,{query='',status='ALL',page=1}={}){
  if(!Array.isArray(rows)||typeof query!=='string'||!FILTERS.has(status))throw new TypeError('Invalid worksheet presentation selection');
  const needle=query.trim().toLocaleLowerCase();
  const matches=rows.filter(row=>{
    if(status==='MATCHED'&&row.match_status!=='ACTIVE')return false;
    if(status==='UNMATCHED'&&row.match_status==='ACTIVE')return false;
    if(status==='CLEARED'&&row.clearance_state!=='CLEARED')return false;
    if(status==='NOT_CLEARED'&&row.clearance_state==='CLEARED')return false;
    return !needle||searchable(row).includes(needle);
  });
  const pageCount=Math.max(1,Math.ceil(matches.length/RECONCILIATION_WORKSHEET_PAGE_SIZE));
  const selectedPage=Math.min(pageCount,Math.max(1,Number.isSafeInteger(page)?page:1));
  const offset=(selectedPage-1)*RECONCILIATION_WORKSHEET_PAGE_SIZE;
  return {rows:matches.slice(offset,offset+RECONCILIATION_WORKSHEET_PAGE_SIZE),totalRowCount:rows.length,matchingCount:matches.length,page:selectedPage,pageCount,start:matches.length?offset+1:0,end:Math.min(offset+RECONCILIATION_WORKSHEET_PAGE_SIZE,matches.length),hasPrevious:selectedPage>1,hasNext:selectedPage<pageCount};
}
