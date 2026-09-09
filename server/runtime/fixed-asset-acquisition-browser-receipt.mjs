import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactSource=(ids,sourceId)=>Array.isArray(ids)&&ids.length===1&&ids[0]===sourceId;

export async function verifyFixedAssetAcquisitionBrowserReceipt(output,expectedSha){
 const result=JSON.parse(await readFile(resolve(output,'result.json'),'utf8'));
 assert.equal(result.kind,'OWNED_POSTGRES_ACQUISITION_BROWSER_E2E');assert.equal(result.passed,true);assert.equal(result.sha,expectedSha);assert.equal(result.worktreeClean,true);
 assert.match(result.browserBundleSha256||'',/^[a-f0-9]{64}$/);assert.ok(result.playwrightModule);assert.ok(result.chromiumVersion);assert.match(result.scope||'',/not production OIDC/);
 assert.notEqual(result.ui_period_id,result.journal_period_id);assert.equal(result.business?.period_id,result.journal_period_id);assert.equal(result.business?.status,'POSTED');assert.equal(result.business?.ledger_line_count,2);
 const business=result.business,sourceId=business?.source_document_id;assert.match(sourceId||'',UUID);assert.match(business?.journal_entry_id||'',UUID);
 const gl=[...(business?.gl_lines||[])].sort((a,b)=>String(a.account_code).localeCompare(String(b.account_code)));assert.equal(gl.length,2);
 assert.deepEqual(gl.map(row=>[row.account_code,row.debit_amount,row.credit_amount]),[['150100','25000.0000','0.0000'],['291001','0.0000','25000.0000']]);for(const row of gl){assert.match(row.ledger_line_id||'',UUID);assert.ok(exactSource(row.source_document_ids,sourceId));}
 const trial=[...(business?.trial_balance||[])].sort((a,b)=>String(a.account_code).localeCompare(String(b.account_code)));assert.equal(trial.length,2);
 assert.deepEqual(trial.map(row=>[row.account_code,row.period_debit,row.period_credit,row.display_balance]),[['150100','25000.0000','0.0000','25000.0000'],['291001','0.0000','25000.0000','-25000.0000']]);for(const row of trial)assert.ok(exactSource(row.source_document_ids,sourceId));
 assert.equal(business.asset_status,'ACTIVE');assert.equal(business.posted_cost_balance,'25000.0000');assert.equal(business.maker_later_workflow_denied,true);assert.deepEqual(business.identity_denials,[401,401]);assert.equal(business.acquisition_posting_count,1);
 assert.deepEqual(result.actor_access?.permissions?.slice().sort(),['FIXED_ASSET.ACQUISITION.DRAFT','FIXED_ASSET.REGISTER.VIEW','GL.JE.CREATE','GL.JE.VIEW']);assert.equal(result.actor_access?.session_refresh_required,false);
 assert.deepEqual(result.reader_access?.permissions?.slice().sort(),['FIXED_ASSET.REGISTER.VIEW','GL.JE.VIEW','GL.REPORT.VIEW']);assert.equal(result.reader_access?.session_refresh_required,false);
 assert.equal(result.writes?.length,1);assert.equal(result.writes[0].method,'POST');assert.equal(result.writes[0].status,201);assert.equal(result.writes[0].identity,'MAKER');assert.match(result.writes[0].path,/\/acquisitions$/);
 assert.ok(Array.isArray(result.reads)&&result.reads.length>=5&&result.reads.every(read=>read.method==='GET'&&read.status===200));
 for(const expected of ['/access/self','/fixed-assets/register?','/acquisition-options','/journal-entries/'])assert.ok(result.reads.some(read=>read.path.includes(expected)),'Missing real API read: '+expected);
 for(const expected of ['/source-documents/','/general-ledger/entries?','/financial-statements?'])assert.ok(result.reads.some(read=>read.identity==='READER'&&read.path.includes(expected)),'Missing reader lineage API read: '+expected);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.http_errors,[]);
 for(const check of ['real-register-list-and-detail','real-options-and-source-date','single-real-post-under-double-click','cross-period-fresh-journal-read','mobile-no-horizontal-overflow','draft-refresh-resumes-same-journal-without-post','posted-refresh-shows-cost-and-activity','late-real-source-response-ignored-after-period-switch','opened-real-source-drill-closes-on-period-switch','real-source-journal-gl-report-lineage','lineage-no-horizontal-overflow'])assert.ok(result.checks?.includes(check),'Missing browser check: '+check);
 assert.equal(result.screenshots?.length,3);
 for(const [name,width,height] of [['draft-desktop.png',1280,900],['draft-mobile.png',390,844],['lineage-desktop.png',1280,900]]){
  const item=result.screenshots.find(image=>image.name===name);assert.ok(item,'Missing screenshot: '+name);assert.deepEqual(item.viewport,{width,height});assert.match(item.sha256||'',/^[a-f0-9]{64}$/);
  const bytes=await readFile(resolve(output,name));assert.ok(bytes.length>=24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),width);assert.ok(bytes.readUInt32BE(20)>=height);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Screenshot changed: '+name);
 }
 return result;
}
