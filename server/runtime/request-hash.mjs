import {createHash} from 'node:crypto';

function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function canonicalRequestHash(value){
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export {canonical as canonicalRequestBody};
