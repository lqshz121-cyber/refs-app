#!/usr/bin/env node
// Staging-only: record the human Settings decision for every WBS company x 2026 H1 period whose
// WBS-sourced Payable Debit settings proposal is exception-free (status READY_FOR_HUMAN_REVIEW).
//
// The proposal itself is computed by refs_read_wbs_h1_accounting_settings_proposal from the staged
// WBS settings (wbs_h1_accounting_setting_stage) and the company's account_master; this tool never
// edits a rule, never guesses an account and never approves a proposal that carries
// MAPPING_MISSING / ACCOUNT_NOT_READY / MAPPING_AMBIGUOUS exceptions -- the kernel refuses that
// (23514) and the row is reported instead. Exception rows are the WBS-side backlog.
//
//   REFS_WBS_H1_SETTINGS_DRY_RUN=1 node tools/decide-wbs-h1-accounting-settings.mjs      (plan only)
//   node tools/decide-wbs-h1-accounting-settings.mjs                                       (approve)
//   REFS_WBS_H1_SETTINGS_COMPANY=OPML ...                                                  (one company)
//
// Env: DATABASE_URL, MIGRATION_DATABASE_URL, CONTEXT_ISSUER_DATABASE_URL, REFS_WBS_TEST_IMPORT_TENANT_ID,
// REFS_WBS_TEST_IMPORT_SETTINGS_CONTROLLER_ACTOR_ID (holder of the frozen WBS_H1_SETTINGS_CONTROLLER
// bundle on each company entity -- see reconcile-wbs-h1-company-actor-grants.mjs),
// optional REFS_WBS_H1_SETTINGS_REASON (8..2000 chars) and REFS_WBS_H1_SETTINGS_PERIOD (YYYY-MM).
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const MONTHS=Object.freeze(Array.from({length:6},(_,index)=>`2026-${String(index+1).padStart(2,'0')}`));
const DEFAULT_REASON='D-R08-3: Owner-delegated staging approval of the exception-free WBS-sourced Payable Debit settings proposal; rules and accounts come from WBS unchanged.';
const EXCEPTIONS=Object.freeze(['MAPPING_MISSING','ACCOUNT_NOT_READY','MAPPING_AMBIGUOUS']);

export const settingsDecisionIdempotencyKey=(companyCode,periodCode,proposalHash)=>`wbs-h1-settings:${createHash('sha256').update(`${companyCode}|${periodCode}|${proposalHash}`,'utf8').digest('hex').slice(0,40)}`;

// Pure classification of one proposal + existing decision, so the plan is testable without a DB.
export function classifyWbsH1SettingsScope({proposal,decision}){
  if(!proposal||typeof proposal!=='object')return {outcome:'PROPOSAL_UNAVAILABLE'};
  if(decision&&decision.outcome)return {outcome:`ALREADY_${decision.outcome}`,proposal_hash:proposal.proposal_hash};
  const exceptionCount=Number(proposal.exception_count||0),readyCount=Number(proposal.ready_rule_count||0);
  const rules=Array.isArray(proposal.rules)?proposal.rules:[];
  const exceptions=Object.fromEntries(EXCEPTIONS.map(code=>[code,rules.filter(rule=>rule.decision===code).length]));
  if(proposal.status==='READY_FOR_HUMAN_REVIEW'&&exceptionCount===0&&readyCount>=1)return {outcome:'APPROVABLE',proposal_hash:proposal.proposal_hash,ready_rule_count:readyCount};
  if(readyCount===0&&exceptionCount===0)return {outcome:'NO_RULES',proposal_hash:proposal.proposal_hash,blocked_rule_count:Number(proposal.blocked_rule_count||0)};
  return {outcome:'EXCEPTION',proposal_hash:proposal.proposal_hash,ready_rule_count:readyCount,exception_count:exceptionCount,exceptions,
    missing_details:rules.filter(rule=>rule.decision==='MAPPING_MISSING').map(rule=>rule.detail).slice(0,20),
    not_ready_accounts:[...new Set(rules.filter(rule=>rule.decision==='ACCOUNT_NOT_READY').map(rule=>rule.account_code))].slice(0,20)};
}

export async function decideWbsH1AccountingSettingsForScopes({scopes,kernel,reason,dryRun=false,onProgress=()=>{}}){
  if(!Array.isArray(scopes)||typeof kernel?.readWbsH1AccountingSettingsProposal!=='function'||typeof kernel?.readWbsH1AccountingSettingsDecision!=='function'||typeof kernel?.decideWbsH1AccountingSettings!=='function')throw new Error('WBS H1 settings decision runner configuration is invalid');
  if(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>2000)throw new Error('Settings decision reason must be 8..2000 characters');
  const summary={status:dryRun?'WBS_H1_SETTINGS_DECISION_PLAN':'WBS_H1_SETTINGS_DECISIONS_COMPLETE',dry_run:dryRun,scope_count:scopes.length,counts:{},approved_now:0,failed:0,exception_companies:[],failures:[]};
  const bump=key=>{summary.counts[key]=(summary.counts[key]||0)+1;};
  // Exceptions are folded per company (the WBS-side backlog is per company, not per month).
  const exceptionByCompany=new Map();
  const noteException=(scope,classified)=>{
    let item=exceptionByCompany.get(scope.company_code);
    if(!item){item={company_code:scope.company_code,periods:[],exceptions:{MAPPING_MISSING:0,ACCOUNT_NOT_READY:0,MAPPING_AMBIGUOUS:0},missing_details:new Set(),not_ready_accounts:new Set()};exceptionByCompany.set(scope.company_code,item);summary.exception_companies.push(item);}
    item.periods.push(scope.period_code);
    for(const code of EXCEPTIONS)item.exceptions[code]=Math.max(item.exceptions[code],classified.exceptions[code]);
    for(const detail of classified.missing_details)item.missing_details.add(detail);
    for(const account of classified.not_ready_accounts)item.not_ready_accounts.add(account);
  };
  for(const scope of scopes){
    const base={company_code:scope.company_code,entity_id:scope.entity_id,period_code:scope.period_code,period_id:scope.period_id};
    try{
      const proposal=await kernel.readWbsH1AccountingSettingsProposal({tenantId:scope.tenant_id,entityId:scope.entity_id,periodId:scope.period_id});
      const decision=proposal?.proposal_hash?await kernel.readWbsH1AccountingSettingsDecision({tenantId:scope.tenant_id,entityId:scope.entity_id,periodId:scope.period_id,proposalHash:proposal.proposal_hash}):null;
      const classified=classifyWbsH1SettingsScope({proposal,decision});
      bump(classified.outcome);
      if(classified.outcome==='EXCEPTION')noteException(scope,classified);
      if(classified.outcome==='APPROVABLE'&&!dryRun){
        const result=await kernel.decideWbsH1AccountingSettings({tenantId:scope.tenant_id,entityId:scope.entity_id,periodId:scope.period_id,expectedProposalHash:proposal.proposal_hash,outcome:'APPROVED',reason,idempotencyKey:settingsDecisionIdempotencyKey(scope.company_code,scope.period_code,proposal.proposal_hash)});
        if(result?.outcome!=='APPROVED')throw new Error('Settings decision did not return an APPROVED receipt');
        if(result.idempotent!==true)summary.approved_now++;
        onProgress({status:'WBS_H1_SETTINGS_APPROVED',...base,decision_id:result.decision_id,approved_rule_count:result.approved_rule_count,idempotent:result.idempotent===true});
      }else onProgress({status:`WBS_H1_SETTINGS_${classified.outcome}`,...base,...(classified.outcome==='EXCEPTION'?{exceptions:classified.exceptions}:{})});
    }catch(error){
      summary.failed++;bump('FAILED');
      summary.failures.push({...base,code:error?.code||'UNEXPECTED',message:error?.message||'unknown'});
      onProgress({status:'WBS_H1_SETTINGS_FAILED',...base,code:error?.code||'UNEXPECTED'});
    }
  }
  if(summary.failed)summary.status=dryRun?'WBS_H1_SETTINGS_DECISION_PLAN_PARTIAL':'WBS_H1_SETTINGS_DECISIONS_PARTIAL';
  summary.exception_companies=summary.exception_companies.map(item=>({...item,missing_details:[...item.missing_details].sort().slice(0,50),not_ready_accounts:[...item.not_ready_accounts].sort().slice(0,50)}));
  return Object.freeze(summary);
}

async function main(){
  for(const key of ['REFS_WBS_TEST_IMPORT_TENANT_ID','REFS_WBS_TEST_IMPORT_SETTINGS_CONTROLLER_ACTOR_ID'])if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,actorId=process.env.REFS_WBS_TEST_IMPORT_SETTINGS_CONTROLLER_ACTOR_ID;
  if(!UUID.test(tenantId))throw new Error('REFS_WBS_TEST_IMPORT_TENANT_ID must be a UUID');
  const companyCode=process.env.REFS_WBS_H1_SETTINGS_COMPANY?.trim().toUpperCase()||null;
  if(companyCode!==null&&!COMPANY.test(companyCode))throw new Error('REFS_WBS_H1_SETTINGS_COMPANY is invalid');
  const periodCode=process.env.REFS_WBS_H1_SETTINGS_PERIOD?.trim()||null;
  if(periodCode!==null&&!MONTHS.includes(periodCode))throw new Error('REFS_WBS_H1_SETTINGS_PERIOD must be one 2026 H1 period');
  const reason=(process.env.REFS_WBS_H1_SETTINGS_REASON||DEFAULT_REASON).trim(),dryRun=process.env.REFS_WBS_H1_SETTINGS_DRY_RUN==='1';
  const config=runtimeConfig(process.env);
  const [runtimePool,issuerPool,scopePool]=await Promise.all([
    createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-settings-runtime',max:2}),
    createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-settings-issuer',max:1}),
    createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-settings-scope',max:1})
  ]);
  try{
    const scopes=(await scopePool.query(`SELECT e.tenant_id::text,e.entity_id::text,e.entity_code AS company_code,p.period_id::text,p.period_code
      FROM entity e JOIN accounting_period p ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id AND p.ledger_code='PRIMARY'
      WHERE e.tenant_id=$1 AND e.active AND e.source_system='WBS' AND e.source_entity_id=e.entity_code
        AND p.period_code=ANY($2::text[]) AND ($3::text IS NULL OR e.entity_code=$3)
      ORDER BY e.entity_code,p.period_code`,[tenantId,periodCode?[periodCode]:MONTHS,companyCode])).rows;
    if(!scopes.length)throw new Error('No WBS company period scope matched');
    const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId})});
    const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId})});
    const summary=await decideWbsH1AccountingSettingsForScopes({scopes,kernel,reason,dryRun,onProgress:row=>{if(row.status!=='WBS_H1_SETTINGS_ALREADY_APPROVED')process.stdout.write(`${JSON.stringify(row)}\n`);}});
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if(summary.failed)process.exitCode=1;
  }finally{await Promise.allSettled([runtimePool.end(),issuerPool.end(),scopePool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_SETTINGS_DECISIONS_FAILED',code:error?.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
