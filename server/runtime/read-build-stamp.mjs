// Parse only the static build formats produced by build.mjs and the deployment
// adapter. Never evaluate downloaded JavaScript, even in a sandbox.
export function readBuildStamp(source) {
  const text=String(source).replace(/^\s*\/\/[^\n]*$/gm,'').trim();
  const match=text.match(/^window\.__BUILD\s*=\s*(\{[^\n;]+\})\s*;?\s*(?:window\.__BUILD\s*=\s*Object\.assign\(window\.__BUILD\|\|\{\},\{channel:("[A-Z_]+"),authoritative:(true|false)\}\);\s*)?$/);
  if(!match)throw new Error('Unsupported or ambiguous static build stamp');
  const stamp=JSON.parse(match[1]);
  if(!stamp||Array.isArray(stamp)||typeof stamp!=='object')throw new Error('Invalid build metadata');
  if(match[2]) {
    const channel=JSON.parse(match[2]),authoritative=match[3]==='true';
    if((Object.hasOwn(stamp,'channel')&&stamp.channel!==channel)||(Object.hasOwn(stamp,'authoritative')&&stamp.authoritative!==authoritative))throw new Error('Conflicting build channel stamps');
    return Object.freeze({...stamp,channel,authoritative});
  }
  return Object.freeze(stamp);
}
