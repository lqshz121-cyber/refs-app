import {writeFileSync} from 'node:fs';
import {renderRuntimeConfig} from './runtime-config-lib.mjs';

const rendered=renderRuntimeConfig(process.env);if(rendered)writeFileSync('dist/refs-runtime-config.js',rendered,{encoding:'utf8'});
