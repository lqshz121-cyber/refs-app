import {fileURLToPath} from 'node:url';
import {FIXTURES,runFixtureSuite} from './run-postgres-fixture-suite.mjs';

export const POSTGRES_FIXTURE_IMAGES=Object.freeze([
  'postgres:15-alpine',
  'postgres:16-alpine',
  'postgres:18-alpine'
]);

export function selectImages(args=[]){
  if(args.length===0)return POSTGRES_FIXTURE_IMAGES;
  if(args.length!==2||args[0]!=='--image'||!POSTGRES_FIXTURE_IMAGES.includes(args[1])){
    throw new Error(`Usage: node runtime/run-postgres-fixture-matrix.mjs [--image <${POSTGRES_FIXTURE_IMAGES.join('|')}>]`);
  }
  return [args[1]];
}

export async function runFixtureMatrix({images=POSTGRES_FIXTURE_IMAGES,env=process.env}={}){
  const results=[];
  for(const image of images){
    const summary=await runFixtureSuite({fixtures:FIXTURES,env:{...env,POSTGRES_IMAGE:image}});
    results.push(Object.freeze({image,summary}));
  }
  return Object.freeze({
    schema:'REFS_POSTGRES_FIXTURE_MATRIX_V1',
    images:results,
    pass:results.length>0&&results.every(result=>result.summary.pass)
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const summary=await runFixtureMatrix({images:selectImages(process.argv.slice(2))});
  console.log(JSON.stringify(summary));
  if(!summary.pass)process.exitCode=1;
}
