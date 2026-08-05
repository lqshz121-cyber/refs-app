import {mkdirSync,writeFileSync} from 'node:fs';
import {renderRuntimeConfigOrLock} from './runtime-config-lib.mjs';

mkdirSync('dist',{recursive:true});
writeFileSync('dist/refs-runtime-config.js',renderRuntimeConfigOrLock(process.env),{encoding:'utf8'});
