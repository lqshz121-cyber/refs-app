import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function runDatabaseDictionaryTests({spawn=spawnSync}={}){
  const result=spawn(process.execPath,['--test','tests/database-dictionary.test.mjs'],{cwd:new URL('..',import.meta.url),stdio:'inherit',shell:false});
  if(result.error)throw result.error;
  return result.status??1;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href)process.exitCode=runDatabaseDictionaryTests();
