import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {renderBuildChannelStamp,renderRuntimeConfigOrLock} from './runtime-config-lib.mjs';

// The adapter and the release-channel stamp are written together from one
// environment so the published assets cannot disagree about what this build is.
mkdirSync('dist',{recursive:true});
writeFileSync('dist/refs-runtime-config.js',renderRuntimeConfigOrLock(process.env),{encoding:'utf8'});

if(!existsSync('dist/refs-build.js'))throw new Error('dist/refs-build.js is missing; run the bundle build before writing the runtime configuration');
const build=readFileSync('dist/refs-build.js','utf8');
if(!/window\.__BUILD=/.test(build))throw new Error('dist/refs-build.js does not declare window.__BUILD');
writeFileSync('dist/refs-build.js',`${build.replace(/\n*$/,'\n')}${renderBuildChannelStamp(process.env)}`,{encoding:'utf8'});
