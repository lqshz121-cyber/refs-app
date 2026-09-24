// R07: find every place the migration chain amends an installed function in the catalog instead of
// redefining it in a file.
//
// The idiom, in all the shapes the chain actually uses:
//
//   SELECT pg_get_functiondef('refs_x()'::regprocedure) INTO fn;                 -- 028, 031, 436 ...
//   SELECT pg_get_functiondef(
//     'public.refs_y(uuid,uuid,jsonb)'::regprocedure
//   ) INTO definition;                                                            -- 163, 171, 179 ...
//   function_definition:=pg_get_functiondef('refs_z(uuid,integer)'::regprocedure); -- 161
//   fn:=replace(fn,'old','new');   definition:=replace(definition,'old','new');
//   definition:=replace(definition,'old',categories);                              -- 215: non-literal
//   SELECT pg_get_functiondef(target.signature::regprocedure) INTO definition;    -- 140: dynamic
//
// The original catalog-patch-drift test only understood the first line and `replace(fn,...)`, so
// it policed 5 amendments out of the several dozen the chain carries. This parser returns every
// amendment it can pair with a static target, and separately reports the blocks it could NOT
// resolve, so the test can refuse silently-unpoliced idioms instead of passing vacuously.

const DO_BLOCK=/\bDO\s*\$(\w*)\$([\s\S]*?)\$\1\$/gi;
// 'schema.name(args)'::regprocedure  -- the whole quoted signature, schema optional.
const STATIC_TARGET=/pg_get_functiondef\(\s*'(?:public\.)?([a-z0-9_]+\([^)']*\))'\s*::\s*regprocedure\s*\)/gi;
// The variable the definition lands in: `... INTO var` or `var:=pg_get_functiondef(`.
const INTO_VAR=/pg_get_functiondef\([^;]*?\)\s*INTO\s+([a-z_][a-z0-9_]*)/gi;
const ASSIGN_VAR=/([a-z_][a-z0-9_]*)\s*:=\s*pg_get_functiondef\(/gi;
// A single-quoted SQL literal, '' for an embedded quote, possibly spanning lines.
const LITERAL="'((?:[^']|'')*)'";

export const unquote=s=>s.replace(/''/g,"'");
export const normalizeSignature=sig=>sig.replace(/^public\./,'').replace(/\s+/g,'');

// Split "a , b" at the top-level comma, honouring quoted literals. Returns [first, second] raw.
function splitArgs(text){
  let depth=0,inQuote=false;
  for(let i=0;i<text.length;i+=1){
    const c=text[i];
    if(inQuote){if(c==="'"){if(text[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
    if(c==="'"){inQuote=true;continue;}
    if(c==='(')depth+=1;
    else if(c===')')depth-=1;
    else if(c===','&&depth===0)return [text.slice(0,i).trim(),text.slice(i+1).trim()];
  }
  return null;
}
const literalOf=(raw,constants=new Map())=>{
  const trimmed=raw.trim();
  const m=new RegExp(`^${LITERAL}$`,'s').exec(trimmed);
  if(m)return unquote(m[1]);
  // 178 idiom: the texts are DECLAREd as constants and passed by name.
  if(constants.has(trimmed.toLowerCase()))return constants.get(trimmed.toLowerCase());
  return null;
};
// DECLARE section constants: `name [constant] text := 'literal';`
const DECLARED=/([a-z_][a-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*'((?:[^']|'')*)'\s*;/gi;
// 439 idiom: long SQL fragments DECLAREd with dollar quoting, `name constant text:=$tag$...$tag$;`.
const DECLARED_DOLLAR=/([a-z_][a-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*\$(\w*)\$([\s\S]*?)\$\2\$\s*;/gi;
function declaredConstants(block){
  const out=new Map();
  for(const m of block.matchAll(DECLARED))out.set(m[1].toLowerCase(),unquote(m[2]));
  for(const m of block.matchAll(DECLARED_DOLLAR))out.set(m[1].toLowerCase(),m[3]);
  return out;
}

// Pull every replace(<var>,a,b) out of a block by scanning for "replace(" and balancing parens,
// so nested or multi-line calls are handled without a fragile single regex.
function replaceCalls(block){
  const out=[];const constants=declaredConstants(block);
  const re=/\breplace\(/gi;let m;
  while((m=re.exec(block))){
    let depth=1,inQuote=false,i=m.index+m[0].length;
    for(;i<block.length&&depth>0;i+=1){
      const c=block[i];
      if(inQuote){if(c==="'"){if(block[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
      if(c==="'")inQuote=true;
      else if(c==='(')depth+=1;
      else if(c===')')depth-=1;
    }
    if(depth!==0)break;
    const inner=block.slice(m.index+m[0].length,i-1);
    const first=splitArgs(inner);
    if(!first)continue;
    const [variable,rest]=first;
    const pair=splitArgs(rest);
    if(!pair)continue;
    if(!/^[a-z_][a-z0-9_]*$/i.test(variable))continue;
    out.push({at:m.index,variable,from:literalOf(pair[0],constants),to:literalOf(pair[1],constants),fromRaw:pair[0],toRaw:pair[1]});
  }
  return out;
}

// parseAmendments(sql, migrationName) -> {amendments:[...], unresolved:[...], snapshots:[...]}
//   amendment: {migration, fn (normalized signature), variable, from, to, literal:boolean}
//   unresolved: {migration, reason, excerpt} for blocks that read a definition but could not be
//               paired statically (dynamic signature, or replaces on a variable never assigned).
export function parseAmendments(sql,migration){
  const text=sql.replace(/\r\n/g,'\n');
  const amendments=[],unresolved=[],snapshots=[];
  if(!/pg_get_functiondef/i.test(text))return {amendments,unresolved,snapshots};
  DO_BLOCK.lastIndex=0;
  let block;let sawBlock=false;
  while((block=DO_BLOCK.exec(text))){
    const body=block[2];
    if(!/pg_get_functiondef/i.test(body))continue;
    sawBlock=true;
    // Every static target in this block, in order, with the variable it was read into.
    const targets=[];
    STATIC_TARGET.lastIndex=0;let t;
    while((t=STATIC_TARGET.exec(body))){
      const tail=body.slice(t.index,t.index+400);
      INTO_VAR.lastIndex=0;ASSIGN_VAR.lastIndex=0;
      const into=INTO_VAR.exec(tail);
      const head=body.slice(Math.max(0,t.index-80),t.index+20);
      const assign=/([a-z_][a-z0-9_]*)\s*:=\s*pg_get_functiondef\($/i.exec(head);
      targets.push({at:t.index,fn:normalizeSignature(t[1]),variable:(into?.[1]||assign?.[1]||null)?.toLowerCase()??null});
    }
    const dynamic=(body.match(/pg_get_functiondef\(/gi)||[]).length-targets.length;
    if(dynamic>0)unresolved.push({migration,reason:`${dynamic} pg_get_functiondef call(s) with a non-literal signature`,excerpt:body.slice(0,160).trim()});
    if(targets.length===0)continue;
    for(const call of replaceCalls(body)){
      // Pair with the latest target that was read into this variable before the call; fall back to
      // the latest target of any variable (single-target blocks that reassign under another name).
      const byVar=[...targets].reverse().find(x=>x.at<call.at&&x.variable===call.variable.toLowerCase());
      const target=byVar||[...targets].reverse().find(x=>x.at<call.at)||null;
      if(!target){unresolved.push({migration,reason:`replace(${call.variable},...) before any pg_get_functiondef target`,excerpt:body.slice(call.at,call.at+160)});continue;}
      const literal=call.from!==null&&call.to!==null;
      amendments.push({migration,fn:target.fn,variable:call.variable,from:call.from,to:call.to,literal,
        ...(literal?{}:{fromRaw:call.fromRaw,toRaw:call.toRaw})});
    }
  }
  // Outside a DO block, plain SQL can read a definition (276/286/288 copy it into a backup table)
  // but has no way to EXECUTE it, so it cannot amend the catalog. The one place outside a DO block
  // that could is a dollar-quoted function body; report that as unresolved, everything else as a
  // snapshot. Comments are stripped first: 436 explains the idiom in prose.
  const code=text.replace(/--[^\n]*/g,'');
  const outside=code.replace(DO_BLOCK,'');
  if(/pg_get_functiondef/i.test(outside)){
    const bodies=[...outside.matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)].map(m=>m[2]);
    if(bodies.some(b=>/pg_get_functiondef/i.test(b)))unresolved.push({migration,reason:'pg_get_functiondef inside a non-DO dollar-quoted body',excerpt:outside.slice(0,160).trim()});
    else snapshots.push({migration,reason:'definition read outside a DO block (backup/snapshot, not an amendment)'});
  }
  void sawBlock;
  return {amendments,unresolved,snapshots};
}
