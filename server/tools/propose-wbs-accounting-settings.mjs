#!/usr/bin/env node
import {buildWbsAccountingSettingsProposal} from '../runtime/wbs-accounting-settings-proposal.mjs';

const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
try{
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const categories=process.env.WBS_CATEGORIES?.split(',').map(value=>value.trim()).filter(Boolean)??null,proposal=buildWbsAccountingSettingsProposal({rows,companyCode:process.env.WBS_COMPANY_CODE?.trim().toUpperCase(),periodStart:process.env.WBS_PERIOD_START,periodEnd:process.env.WBS_PERIOD_END,categories});
  process.stdout.write(`${JSON.stringify(proposal,null,2)}\n`);
}catch(error){process.stderr.write(`${JSON.stringify({status:'WBS_ACCOUNTING_SETTINGS_PROPOSAL_FAILED',code:error.code??'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;}
