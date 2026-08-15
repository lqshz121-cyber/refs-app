// Read-only current-release Stage 3 Insurance-to-Prepaid production verifier.
// It proves one signed, reviewed monthly amortization through POSTED JE, GL and rollforward.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA=/^[0-9a-f]{40}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ACCOUNT=/^[A-Za-z0-9._-]{1,64}$/;
const ACTOR=/^[^\u0000-\u001f\u007f]{1,200}$/;
const expect=(condition,message)=>{if(!condition)throw new Error(`stage3-insurance-prepaid-authoritative-e2e: ${message}`);};
const money4=value=>typeof value==='string'&&MONEY4.test(value);
const moneyUnits=value=>BigInt(value.replace('.',''));
const contains=(value,expected)=>value===expected||Array.isArray(value)&&value.some(item=>contains(item,expected))||value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected));
const sameRelease=(actual,expected)=>typeof actual==='string'&&GIT_SHA.test(actual)&&actual.toLowerCase()===expected;
const origin=(value,name)=>{let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage3-insurance-prepaid-authoritative-e2e: ${name} must be an HTTPS origin`);}expect(url.protocol==='https:'&&url.origin===url.toString().replace(/\/$/,''),`${name} must be an HTTPS origin`);return url.origin;};
const accessToken=value=>{expect(typeof value==='string'&&value.trim().length>=16&&!/(replace|example|placeholder|changeme)/i.test(value),'REFS_STAGE3_INSURANCE_PREPAID_E2E_READ_ACCESS_TOKEN is required');return value.trim();};

const UUID_KEYS=['entityId','periodId','scheduleId','scheduleLineId','signedAdmissionId','sourceDocumentId','coverageEvidenceId','settingSnapshotId','mappingSnapshotId','capitalizationJournalEntryId','capitalizationJournalLineId','capitalizationLedgerLineId','reviewId','draftEvidenceId','derivedSourceDocumentId','journalEntryId','expenseJournalLineId','prepaidJournalLineId','expenseLedgerLineId','prepaidLedgerLineId'];
const HASH_KEYS=['sourcePayloadHash','coverageHash','proposalHash','settingSnapshotHash','mappingSnapshotHash','reviewEvidenceHash','draftEvidenceHash'];
const MONEY_KEYS=['expectedAmount','expectedOpeningBalance','expectedPeriodAdditions','expectedPeriodAmortization','expectedClosingBalance'];
export function stage3InsurancePrepaidAuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of [...UUID_KEYS,...HASH_KEYS,...MONEY_KEYS,'sourceDocumentVersion','mappingVersion','journalRevision','prepaidAccountCode','expenseAccountCode','independentReviewerActorId','draftMakerActorId'])expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of UUID_KEYS)expect(UUID.test(scenario[key]||''),`scenario.${key} must be a UUID`);
  for(const key of HASH_KEYS)expect(SHA256.test(scenario[key]||''),`scenario.${key} must be a sha256 digest`);
  for(const key of MONEY_KEYS)expect(money4(scenario[key]),`scenario.${key} must be fixed four-decimal text`);
  expect(moneyUnits(scenario.expectedAmount)>0n,'scenario.expectedAmount must be positive');
  expect(moneyUnits(scenario.expectedOpeningBalance)+moneyUnits(scenario.expectedPeriodAdditions)-moneyUnits(scenario.expectedPeriodAmortization)===moneyUnits(scenario.expectedClosingBalance),'scenario prepaid rollforward must balance in fixed MONEY4 units');
  for(const key of ['sourceDocumentVersion','mappingVersion','journalRevision'])expect(Number.isSafeInteger(scenario[key])&&scenario[key]>=0,`scenario.${key} must be a non-negative safe integer`);
  expect(scenario.mappingVersion>=1,'scenario.mappingVersion must be positive');expect(scenario.journalRevision>=4,'scenario.journalRevision must retain the standard Submit/Review/Approve/Post revisions');
  for(const key of ['prepaidAccountCode','expenseAccountCode'])expect(ACCOUNT.test(scenario[key]||''),`scenario.${key} is invalid`);
  expect(scenario.prepaidAccountCode!==scenario.expenseAccountCode,'prepaid and expense account codes must differ');
  for(const key of ['independentReviewerActorId','draftMakerActorId'])expect(ACTOR.test(scenario[key]||''),`scenario.${key} is invalid`);
  expect(scenario.independentReviewerActorId!==scenario.draftMakerActorId,'independent reviewer and Draft maker must differ');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();expect(GIT_SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:origin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),webOrigin:origin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),releaseSha,accessToken:accessToken(environment.REFS_STAGE3_INSURANCE_PREPAID_E2E_READ_ACCESS_TOKEN),scenario:Object.freeze({...scenario})});
}

export async function readStage3InsurancePrepaidScenario(pathname=process.env.REFS_STAGE3_INSURANCE_PREPAID_E2E_SCENARIO_PATH){expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE3_INSURANCE_PREPAID_E2E_SCENARIO_PATH is required');try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage3-insurance-prepaid-authoritative-e2e: scenario cannot be read: ${error.message}`);}}
async function read(fetcher,url,options,label){const response=await fetcher(url,options);expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;}
async function getJson(fetcher,url,token,label){const response=await read(fetcher,url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}},label),body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);return body.data;}
async function release(config,fetcher){const options={method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}},[live,ready,build]=await Promise.all([read(fetcher,`${config.apiBaseUrl}/health/live`,options,'API liveness'),read(fetcher,`${config.apiBaseUrl}/health/ready`,options,'API readiness'),read(fetcher,`${config.webOrigin}/refs-build.js`,options,'authoritative web build stamp')]),[liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,config.releaseSha),'API liveness release does not match REFS_RELEASE_SHA');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,config.releaseSha),'API readiness release does not match REFS_RELEASE_SHA');const match=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(match,'authoritative web build stamp is missing metadata');const stamp=JSON.parse(match[1]);expect(stamp?.channel==='AUTHORITATIVE'&&stamp?.authoritative===true&&sameRelease(stamp.sha,config.releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');return Object.freeze({release:config.releaseSha,apiLiveRelease:liveBody.release,apiReadyRelease:readyBody.release,webRelease:stamp.sha});}

const exactEvidence=(rows,s)=>Array.isArray(rows)?rows.filter(row=>row?.ai_amortization_schedule_id===s.scheduleId&&row?.ai_amortization_schedule_line_id===s.scheduleLineId):[];
const exactLine=(rows,{accountCode,journalLineId,ledgerLineId,debit,credit},s)=>Array.isArray(rows)&&rows.filter(row=>row?.account_code===accountCode&&row?.journal_entry_id===s.journalEntryId&&row?.journal_line_id===journalLineId&&row?.ledger_line_id===ledgerLineId&&row?.debit_amount===debit&&row?.credit_amount===credit&&money4(row?.debit_amount)&&money4(row?.credit_amount)&&contains(row?.source_document_ids,s.sourceDocumentId)).length===1;
const exactJournalLine=(rows,{accountCode,journalLineId,ledgerLineId,debit,credit},s)=>Array.isArray(rows)&&rows.filter(row=>row?.account_code===accountCode&&row?.journal_line_id===journalLineId&&row?.ledger_line_id===ledgerLineId&&row?.debit_amount===debit&&row?.credit_amount===credit&&money4(row?.debit_amount)&&money4(row?.credit_amount)&&contains(row?.source_document_ids,s.sourceDocumentId)).length===1;
const exactRollforward=(rows,s)=>Array.isArray(rows)?rows.filter(row=>row?.period_id===s.periodId&&row?.account_code===s.prepaidAccountCode):[];

export async function verifyStage3InsurancePrepaidAuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof fetcher==='function','config and fetcher are required');const {apiBaseUrl,accessToken:token,scenario:s}=config,stamps=await release(config,fetcher),base=`${apiBaseUrl}/api/v1/entities/${s.entityId}`,period=`periodId=${encodeURIComponent(s.periodId)}`;
  const [evidenceRows,journal,expenseGl,prepaidGl,rollforwardRows]=await Promise.all([
    getJson(fetcher,`${base}/prepaid/amortization?${period}&limit=100`,token,'insurance amortization evidence'),
    getJson(fetcher,`${base}/journal-entries/${s.journalEntryId}?${period}`,token,'posted amortization journal'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(s.expenseAccountCode)}&limit=200&offset=0`,token,'expense general ledger leg'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(s.prepaidAccountCode)}&limit=200&offset=0`,token,'prepaid general ledger leg'),
    getJson(fetcher,`${base}/reports/prepaid-rollforward?${period}`,token,'prepaid rollforward'),
  ]);
  const matchingEvidence=exactEvidence(evidenceRows,s);expect(matchingEvidence.length===1,'insurance amortization response does not contain exactly one schedule line');const row=matchingEvidence[0];
  const exact={wbs_provider_signed_payable_admission_id:s.signedAdmissionId,source_document_id:s.sourceDocumentId,source_document_version:s.sourceDocumentVersion,source_payload_hash:s.sourcePayloadHash,ai_amortization_coverage_evidence_id:s.coverageEvidenceId,coverage_hash:s.coverageHash,proposal_hash:s.proposalHash,amortization_setting_snapshot_id:s.settingSnapshotId,amortization_setting_snapshot_hash:s.settingSnapshotHash,prepaid_mapping_snapshot_id:s.mappingSnapshotId,prepaid_mapping_snapshot_hash:s.mappingSnapshotHash,capitalization_journal_entry_id:s.capitalizationJournalEntryId,capitalization_journal_line_id:s.capitalizationJournalLineId,capitalization_ledger_line_id:s.capitalizationLedgerLineId,insurance_prepaid_amortization_review_id:s.reviewId,review_evidence_hash:s.reviewEvidenceHash,insurance_prepaid_amortization_draft_evidence_id:s.draftEvidenceId,draft_evidence_hash:s.draftEvidenceHash,derived_source_document_id:s.derivedSourceDocumentId,journal_entry_id:s.journalEntryId,journal_revision:s.journalRevision,period_id:s.periodId,amount:s.expectedAmount,prepaid_account_code:s.prepaidAccountCode,expense_account_code:s.expenseAccountCode,reviewed_by:s.independentReviewerActorId,draft_created_by:s.draftMakerActorId};
  expect(Object.entries(exact).every(([key,value])=>row?.[key]===value),'insurance amortization row does not retain the exact signed/reviewed/Draft lineage');
  expect(row?.readiness_status==='DRAFT_CREATED'&&row?.journal_status==='POSTED'&&Array.isArray(row?.blocked_reasons)&&row.blocked_reasons.length===0,'insurance amortization row is not an unblocked POSTED occurrence');
  expect(money4(row?.amount)&&row?.can_independently_review===false&&row?.can_create_draft===false&&row?.can_submit===false&&row?.can_approve===false&&row?.can_post===false,'insurance amortization row has invalid MONEY4 or action capabilities');
  expect(TIMESTAMP.test(row?.reviewed_at||'')&&TIMESTAMP.test(row?.draft_created_at||'')&&Date.parse(row.reviewed_at)<=Date.parse(row.draft_created_at),'independent Review and Draft actor/time evidence is invalid');
  expect(journal?.journal_entry_id===s.journalEntryId&&journal?.period_id===s.periodId&&journal?.journal_type==='AUTO'&&journal?.status==='POSTED'&&journal?.revision===s.journalRevision,'journal detail is not the exact standard-POSTED AUTO journal');
  const expense={accountCode:s.expenseAccountCode,journalLineId:s.expenseJournalLineId,ledgerLineId:s.expenseLedgerLineId,debit:s.expectedAmount,credit:'0.0000'},prepaid={accountCode:s.prepaidAccountCode,journalLineId:s.prepaidJournalLineId,ledgerLineId:s.prepaidLedgerLineId,debit:'0.0000',credit:s.expectedAmount};
  expect(Array.isArray(journal?.lines)&&journal.lines.length===2&&exactJournalLine(journal.lines,expense,s),'POSTED journal is missing the exact expense debit leg');expect(exactJournalLine(journal?.lines,prepaid,s),'POSTED journal is missing the exact prepaid credit leg');expect(exactLine(expenseGl,expense,s),'general ledger is missing the exact expense debit leg');expect(exactLine(prepaidGl,prepaid,s),'general ledger is missing the exact prepaid credit leg');
  const matchingRollforward=exactRollforward(rollforwardRows,s);expect(matchingRollforward.length===1,'prepaid rollforward does not contain exactly one target account row');const rollforward=matchingRollforward[0];expect(rollforward?.mapping_status==='MAPPED_PREPAID_ACCOUNT'&&rollforward?.mapping_snapshot_id===s.mappingSnapshotId&&Number(rollforward?.mapping_version)===s.mappingVersion&&rollforward?.mapping_snapshot_hash===s.mappingSnapshotHash,'prepaid rollforward is not bound to the exact approved mapping');
  for(const [field,value] of [['opening_balance',s.expectedOpeningBalance],['period_additions',s.expectedPeriodAdditions],['period_amortization',s.expectedPeriodAmortization],['closing_balance',s.expectedClosingBalance]])expect(rollforward?.[field]===value&&money4(rollforward?.[field]),`prepaid rollforward ${field} is not the expected MONEY4 value`);
  expect(moneyUnits(s.expectedOpeningBalance)+moneyUnits(s.expectedPeriodAdditions)-moneyUnits(s.expectedPeriodAmortization)===moneyUnits(s.expectedClosingBalance),'prepaid rollforward scenario does not balance in fixed MONEY4 units');
  for(const [field,ids] of [['journal_entry_ids',[s.capitalizationJournalEntryId,s.journalEntryId]],['journal_line_ids',[s.capitalizationJournalLineId,s.prepaidJournalLineId]],['ledger_line_ids',[s.capitalizationLedgerLineId,s.prepaidLedgerLineId]],['source_document_ids',[s.sourceDocumentId,s.derivedSourceDocumentId]]])expect(Array.isArray(rollforward?.[field])&&ids.every(id=>rollforward[field].includes(id)),`prepaid rollforward ${field} does not retain exact lineage`);
  return Object.freeze({ok:true,mode:'READ_ONLY_SIGNED_INSURANCE_PREPAID_EVIDENCE',release:stamps,checks:['same-release-stamps','signed-source-version-hash','coverage-proposal-setting-mapping','independent-review-draft-sod','posted-auto-journal','expense-gl-leg','prepaid-gl-leg','prepaid-rollforward','money4','exact-identifiers'],sourceDocumentId:s.sourceDocumentId,journalEntryId:s.journalEntryId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{console.log(JSON.stringify(await verifyStage3InsurancePrepaidAuthoritativeE2e({config:stage3InsurancePrepaidAuthoritativeE2eConfig(process.env,await readStage3InsurancePrepaidScenario())})));}catch(error){console.error(error.message);process.exitCode=1;}}
