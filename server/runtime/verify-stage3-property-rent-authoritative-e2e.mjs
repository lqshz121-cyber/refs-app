// GET-only current-release verifier for one signed Property Rent charge.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA40=/^[0-9a-f]{40}$/i,HASH=/^sha256:[0-9a-f]{64}$/,MONEY4=/^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const expect=(condition,message)=>{if(!condition)throw new Error(`stage3-property-rent-authoritative-e2e: ${message}`);};
const exact=(actual,expected,label)=>expect(actual===expected,`${label} does not match the scenario`);
const money=value=>{expect(typeof value==='string'&&MONEY4.test(value),`${String(value)} is not canonical positive MONEY4`);return BigInt(value.replace('.',''));};
const timestamp=value=>typeof value==='string'&&!Number.isNaN(new Date(value).valueOf());
const sameRelease=(actual,expected)=>typeof actual==='string'&&SHA40.test(actual)&&actual.toLowerCase()===expected;
const origin=(value,name)=>{let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage3-property-rent-authoritative-e2e: ${name} must be an HTTPS origin`);}expect(url.protocol==='https:'&&url.origin===url.toString().replace(/\/$/,''),`${name} must be an HTTPS origin`);return url.origin;};
const token=value=>{expect(typeof value==='string'&&value.trim().length>=16&&!/(replace|example|placeholder|changeme)/i.test(value),'REFS_STAGE3_PROPERTY_RENT_E2E_READ_ACCESS_TOKEN is required');return value.trim();};

export function stage3PropertyRentAuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  const uuids=['entityId','periodId','admissionId','reviewEvidenceId','draftEvidenceId','sourceDocumentId','stagingItemId','businessDocumentId','journalEntryId','mappingSnapshotId','receivableJournalLineId','receivableLedgerLineId','revenueJournalLineId','revenueLedgerLineId'];
  for(const key of uuids)expect(UUID.test(scenario[key]||''),`scenario.${key} must be a UUID`);
  for(const key of ['receiptHash','evidenceHash','mappingSnapshotHash'])expect(HASH.test(scenario[key]||''),`scenario.${key} must be a sha256 hash`);
  for(const key of ['sourceVersion','propertyRef','receivableAccountCode','revenueAccountCode','admittedBy','reviewedBy','draftedBy'])expect(typeof scenario[key]==='string'&&scenario[key].trim()===scenario[key]&&scenario[key].length>0,`scenario.${key} is required`);
  for(const key of ['reviewedAt','draftedAt','postedAt'])expect(timestamp(scenario[key]),`scenario.${key} must be a timestamp`);
  expect(MONEY4.test(scenario.expectedAmount||'')&&money(scenario.expectedAmount)>0n,'scenario.expectedAmount must be positive MONEY4');
  expect(Number.isSafeInteger(scenario.revision)&&scenario.revision>=0,'scenario.revision must be a nonnegative integer');expect(Number.isSafeInteger(scenario.mappingVersion)&&scenario.mappingVersion>=1,'scenario.mappingVersion must be a positive integer');
  expect(scenario.receivableAccountCode!==scenario.revenueAccountCode,'Rent accounts must be distinct');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();expect(SHA40.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:origin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),webOrigin:origin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),releaseSha,accessToken:token(environment.REFS_STAGE3_PROPERTY_RENT_E2E_READ_ACCESS_TOKEN),scenario:Object.freeze({...scenario})});
}

export async function readStage3PropertyRentScenario(pathname=process.env.REFS_STAGE3_PROPERTY_RENT_E2E_SCENARIO_PATH){expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE3_PROPERTY_RENT_E2E_SCENARIO_PATH is required');try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage3-property-rent-authoritative-e2e: scenario cannot be read: ${error.message}`);}}
async function read(fetcher,url,options,label){const response=await fetcher(url,options);expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;}
async function getJson(fetcher,url,accessToken,label){const response=await read(fetcher,url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${accessToken}`}},label),body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);return body.data;}
async function verifyRelease(config,fetcher){const options={method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}},[live,ready,web]=await Promise.all([read(fetcher,`${config.apiBaseUrl}/health/live`,options,'API liveness'),read(fetcher,`${config.apiBaseUrl}/health/ready`,options,'API readiness'),read(fetcher,`${config.webOrigin}/refs-build.js`,options,'web release stamp')]),[liveBody,readyBody,webText]=await Promise.all([live.json(),ready.json(),web.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,config.releaseSha),'API liveness release mismatch');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,config.releaseSha),'API readiness release mismatch');const match=webText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(match,'web build stamp is missing');const stamp=JSON.parse(match[1]);expect(stamp.channel==='AUTHORITATIVE'&&stamp.authoritative===true&&sameRelease(stamp.sha,config.releaseSha),'web release mismatch');return Object.freeze({release:config.releaseSha,apiRelease:liveBody.release,webRelease:stamp.sha});}

const includes=(values,id)=>Array.isArray(values)&&values.includes(id);
const exactJournalLine=(rows,{lineId,ledgerId,account,debit,credit,sourceId})=>Array.isArray(rows)&&rows.some(row=>row?.journal_line_id===lineId&&row?.ledger_line_id===ledgerId&&row?.account_code===account&&row?.debit_amount===debit&&row?.credit_amount===credit&&includes(row?.source_document_ids,sourceId));
const exactGlLine=(rows,{journalId,lineId,ledgerId,account,debit,credit,sourceId})=>Array.isArray(rows)&&rows.filter(row=>row?.journal_entry_id===journalId&&row?.journal_line_id===lineId&&row?.ledger_line_id===ledgerId&&row?.account_code===account&&row?.debit_amount===debit&&row?.credit_amount===credit&&includes(row?.source_document_ids,sourceId)).length===1;

export async function verifyStage3PropertyRentAuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof fetcher==='function','config and fetcher are required');
  const {scenario:s,apiBaseUrl,accessToken}=config,release=await verifyRelease(config,fetcher),base=`${apiBaseUrl}/api/v1/entities/${s.entityId}`,period=`periodId=${encodeURIComponent(s.periodId)}`;
  const [queue,journal,receivableGl,revenueGl,report]=await Promise.all([
    getJson(fetcher,`${base}/wbs/property-rent-pickup?${period}&limit=50`,accessToken,'Property Rent queue'),
    getJson(fetcher,`${base}/journal-entries/${s.journalEntryId}?${period}`,accessToken,'Property Rent journal detail'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(s.receivableAccountCode)}&limit=200&offset=0`,accessToken,'Rent receivable GL'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(s.revenueAccountCode)}&limit=200&offset=0`,accessToken,'Rent revenue GL'),
    getJson(fetcher,`${base}/reports/dimension-profitability?${period}&dimensionType=PROPERTY&dimensionRef=${encodeURIComponent(s.propertyRef)}`,accessToken,'Property operating P&L'),
  ]);
  expect(Array.isArray(queue),'Property Rent queue must be an array');const matches=queue.filter(row=>row?.wbs_property_rent_source_admission_id===s.admissionId);expect(matches.length===1,'exactly one scenario admission is required');const row=matches[0];
  const queueExact={wbs_property_rent_review_evidence_id:s.reviewEvidenceId,wbs_property_rent_draft_evidence_id:s.draftEvidenceId,source_document_id:s.sourceDocumentId,staging_item_id:s.stagingItemId,business_document_id:s.businessDocumentId,journal_entry_id:s.journalEntryId,period_id:s.periodId,mapping_snapshot_id:s.mappingSnapshotId,mapping_snapshot_hash:s.mappingSnapshotHash,mapping_version:s.mappingVersion,source_version:s.sourceVersion,receipt_hash:s.receiptHash,evidence_hash:s.evidenceHash,property_ref:s.propertyRef,gross_amount:s.expectedAmount,workflow_status:'POSTED',revision:s.revision,admitted_by:s.admittedBy,reviewed_by:s.reviewedBy,drafted_by:s.draftedBy,reviewed_at:s.reviewedAt,drafted_at:s.draftedAt,posted_at:s.postedAt};
  for(const [key,value] of Object.entries(queueExact))exact(key==='mapping_version'?Number(row?.[key]):row?.[key],value,`queue ${key}`);money(row.gross_amount);
  expect(journal?.journal_entry_id===s.journalEntryId&&journal?.period_id===s.periodId&&journal?.status==='POSTED'&&journal?.journal_type==='AUTO','journal is not exact AUTO POSTED period evidence');expect(Array.isArray(journal.lines)&&journal.lines.length===2,'Property Rent journal must have exactly two lines');
  const receivable={journalId:s.journalEntryId,lineId:s.receivableJournalLineId,ledgerId:s.receivableLedgerLineId,account:s.receivableAccountCode,debit:s.expectedAmount,credit:'0.0000',sourceId:s.sourceDocumentId},revenue={journalId:s.journalEntryId,lineId:s.revenueJournalLineId,ledgerId:s.revenueLedgerLineId,account:s.revenueAccountCode,debit:'0.0000',credit:s.expectedAmount,sourceId:s.sourceDocumentId};
  for(const leg of [receivable,revenue]){money(leg.debit);money(leg.credit);expect(exactJournalLine(journal.lines,leg),'journal is missing an exact source-bound Rent leg');}
  expect(exactGlLine(receivableGl,receivable),'GL is missing the exact Rent receivable leg');expect(exactGlLine(revenueGl,revenue),'GL is missing the exact Rent revenue leg');
  expect(Array.isArray(report),'Property P&L must be an array');const reportRows=report.filter(item=>item?.dimension_type==='PROPERTY'&&item?.dimension_ref===s.propertyRef&&item?.account_code===s.revenueAccountCode);expect(reportRows.length===1,'Property P&L must contain exactly one scenario revenue row');const reportRow=reportRows[0];expect(reportRow.statement_type==='PROPERTY_PNL'&&reportRow.classification_basis==='POSTED_LEDGER_DIMENSION_EXACT'&&reportRow.period_credit===s.expectedAmount&&money(reportRow.period_debit)===0n&&money(reportRow.display_balance)===money(s.expectedAmount),'Property P&L revenue MONEY4 is invalid');expect(includes(reportRow.journal_entry_ids,s.journalEntryId)&&includes(reportRow.journal_line_ids,s.revenueJournalLineId)&&includes(reportRow.ledger_line_ids,s.revenueLedgerLineId)&&includes(reportRow.source_document_ids,s.sourceDocumentId),'Property P&L lineage is not exact');
  return Object.freeze({ok:true,mode:'READ_ONLY_CURRENT_RELEASE_PROPERTY_RENT_EVIDENCE',release,checks:['same-release-stamps','period-scoped-signed-rent-row','immutable-review-draft-audit','posted-two-leg-auto-journal','exact-two-leg-gl','property-pnl-lineage','money4','get-only'],admissionId:s.admissionId,journalEntryId:s.journalEntryId,propertyRef:s.propertyRef});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{console.log(JSON.stringify(await verifyStage3PropertyRentAuthoritativeE2e({config:stage3PropertyRentAuthoritativeE2eConfig(process.env,await readStage3PropertyRentScenario())})));}catch(error){console.error(error.message);process.exitCode=1;}}
