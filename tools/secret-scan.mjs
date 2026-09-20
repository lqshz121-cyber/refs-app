#!/usr/bin/env node
// P13 — scan added lines for credentials and sensitive real-world data before a patch leaves the machine.
//
// Scope is deliberately the *diff*, not the tree: the repository already contains fixture database
// passwords and sample hashes that are safe and permanent, and a whole-tree scan drowns in them.
// What matters at review time is what a change is about to introduce.
//
// Exit codes: 0 clean, 2 findings, 3 could not run (no git range, no diff).
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf(name);return i>=0&&args[i+1]?args[i+1]:fallback;};
const range=opt('--range',null);
const fileArg=opt('--file',null);
const json=args.includes('--json');

// Each rule is deliberately narrow: a broad "high entropy string" rule produces noise that gets
// ignored, which is worse than no rule at all.
export const RULES=Object.freeze([
  {id:'AWS_ACCESS_KEY_ID',re:/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,why:'AWS access key id'},
  {id:'AWS_SECRET',re:/aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i,why:'AWS secret access key'},
  {id:'PRIVATE_KEY',re:/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,why:'private key block'},
  {id:'GITHUB_TOKEN',re:/\bgh[pousr]_[A-Za-z0-9]{36,}\b/,why:'GitHub token'},
  {id:'SLACK_TOKEN',re:/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,why:'Slack token'},
  {id:'JWT',re:/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,why:'JWT / signed token'},
  {id:'BEARER',re:/\b[Aa]uthorization\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._~+/-]{20,}/,why:'hard-coded bearer credential'},
  {id:'SET_COOKIE',re:/\bSet-Cookie\s*:\s*\S+=\S{16,}/i,why:'captured cookie'},
  {id:'RENDER_DEPLOY_HOOK',re:/https:\/\/api\.render\.com\/deploy\/srv-[A-Za-z0-9-]+\?key=/,why:'Render deploy hook URL (grants deploys)'},
  {id:'POSTGRES_URL_WITH_PASSWORD',re:/postgres(?:ql)?:\/\/[^\s:@'"]+:[^\s:@'"]+@(?!127\.0\.0\.1|localhost)/,why:'database URL with an embedded password for a non-local host'},
  {id:'GENERIC_SECRET_ASSIGNMENT',re:/\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][A-Za-z0-9!@#$%^&*_+=/.-]{20,}['"]/i,why:'credential-shaped literal'}
]);

// Lines that are allowed to look like secrets. Kept explicit and short so that widening it is a
// visible decision, not a habit.
export const ALLOW=Object.freeze([
  /refs_(?:runtime|migrator|context_issuer|grant_sync)_test_/,        // fixture database roles, local only
  /sha256:[0-9a-f]{64}/,                                              // evidence hashes are not secrets
  /process\.env\./,                                                   // reading a secret is not carrying one
  /fromDatabase|fromService|sync:\s*false|generateValue/,             // Render blueprint secret *references*
  /['"](?:x|y|test|example|placeholder|redacted|\*{3,})['"]/i,
  // A per-line, reviewed exemption. Test fixtures have to carry credential-shaped literals -- this
  // scanner's own positive samples are the clearest case -- and the alternative, allowlisting a
  // host pattern or a whole path, silently blinds the scanner to real secrets in the same place.
  // The marker has to sit on the offending line, so it shows up in the diff next to what it excuses.
  /\/\/\s*secret-scan:\s*allow\b/
]);

export function scanLines(lines){
  const findings=[];
  for(const {path,lineNo,text} of lines){
    if(ALLOW.some(a=>a.test(text)))continue;
    for(const rule of RULES)if(rule.re.test(text))
      findings.push({path,line:lineNo,rule:rule.id,why:rule.why,excerpt:text.trim().slice(0,80)});
  }
  return findings;
}

function addedLinesFromDiff(diff){
  const out=[];let path=null,lineNo=0;
  for(const raw of diff.split('\n')){
    if(raw.startsWith('+++ b/')){path=raw.slice(6);continue;}
    if(raw.startsWith('@@')){const m=/\+(\d+)/.exec(raw);lineNo=m?Number(m[1]):0;continue;}
    if(raw.startsWith('+')&&!raw.startsWith('+++')){out.push({path,lineNo,text:raw.slice(1)});lineNo+=1;continue;}
    if(!raw.startsWith('-'))lineNo+=1;
  }
  return out;
}

if(import.meta.url===`file://${process.argv[1]}`){
  let lines;
  try{
    if(fileArg)lines=readFileSync(fileArg,'utf8').split('\n').map((text,i)=>({path:fileArg,lineNo:i+1,text}));
    else if(range)lines=addedLinesFromDiff(execFileSync('git',['diff','--unified=0',range],{encoding:'utf8',maxBuffer:256*1024*1024}));
    else{console.error('secret-scan: pass --range <git range> or --file <path>');process.exit(3);}
  }catch(error){console.error(`secret-scan: could not read input: ${error.message}`);process.exit(3);}
  const findings=scanLines(lines);
  if(json)console.log(JSON.stringify({scanned_lines:lines.length,findings},null,2));
  else{
    console.log(`secret-scan: ${lines.length} added lines scanned, ${findings.length} finding(s)`);
    for(const f of findings)console.log(`  ${f.path}:${f.line}  ${f.rule} — ${f.why}\n    ${f.excerpt}`);
  }
  process.exit(findings.length?2:0);
}
