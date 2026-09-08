import {readFixedAssetBrowserRepositoryState} from './fixed-asset-browser-receipt.mjs';
import {verifyFixedAssetAcquisitionBrowserReceipt} from './fixed-asset-acquisition-browser-receipt.mjs';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(!process.env.REFS_ASSET_ACQUISITION_BROWSER_OUTPUT)throw new Error('Set REFS_ASSET_ACQUISITION_BROWSER_OUTPUT to a dedicated evidence directory');
const output=resolve(process.env.REFS_ASSET_ACQUISITION_BROWSER_OUTPUT);if(existsSync(output))throw new Error('Acquisition browser evidence directory already exists; use a fresh directory');
const root=fileURLToPath(new URL('../../',import.meta.url)),repository=readFixedAssetBrowserRepositoryState(root);if(!repository.clean)throw new Error('Commit acquisition browser proof changes before exact verification');
const expectedSha=repository.sha,pattern='fixed asset acquisition browser creates one source-bound Draft then independent roles post exact reports';
const child=spawn(process.execPath,[fileURLToPath(new URL('./test-postgres-fresh.mjs',import.meta.url)),'--pattern',pattern],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit',env:{...process.env,REFS_FIXED_ASSET_ACQUISITION_BROWSER_E2E:'1'}});
child.once('error',error=>{console.error(error);process.exitCode=1;});child.once('exit',async code=>{if(code!==0){process.exitCode=code??1;return;}try{await verifyFixedAssetAcquisitionBrowserReceipt(output,expectedSha);console.log('PASS real PostgreSQL acquisition browser evidence: '+output);}catch(error){console.error(error);process.exitCode=1;}});
