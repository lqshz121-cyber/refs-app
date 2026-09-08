import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(!process.env.REFS_ASSET_BROWSER_OUTPUT)throw new Error('Set REFS_ASSET_BROWSER_OUTPUT to a dedicated evidence directory');
const output=resolve(process.env.REFS_ASSET_BROWSER_OUTPUT);if(existsSync(output))throw new Error('Browser evidence directory already exists; use a fresh directory');
const child=spawn(process.execPath,[fileURLToPath(new URL('./test-postgres-fresh.mjs',import.meta.url)),'--pattern','fixed asset authoritative register derives dated balances'],{stdio:'inherit',env:{...process.env,REFS_FIXED_ASSET_BROWSER_E2E:'1'}});
child.once('error',error=>{console.error(error);process.exitCode=1;});child.once('exit',code=>{if(code!==0){process.exitCode=code??1;return;}try{const result=JSON.parse(readFileSync(resolve(output,'result.json'),'utf8'));if(result.passed!==true||!Array.isArray(result.reads)||result.reads.length<8||result.errors.length)throw new Error('Browser proof did not produce a complete passing receipt');console.log('PASS real PostgreSQL asset browser evidence: '+output);}catch(error){console.error(error);process.exitCode=1;}});
