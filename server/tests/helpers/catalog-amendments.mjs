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
//   FOR target IN SELECT * FROM (VALUES ('refs_a(uuid)','..'),('refs_b()','..')) AS v(signature,p) LOOP
//     SELECT pg_get_functiondef(target.signature::regprocedure) INTO definition;  -- 140, 313: loop
//   'a' || E'\\n' || 'b'  and  replace(replace(def,a,b),c,d)                          -- 051/141, 181
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
// E'...' escape strings (051, 141): only the escapes the chain uses.
const unescapeE=s=>unquote(s).replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\\\\/g,'\\');
// One text term: 'lit', E'lit', $tag$lit$tag$, or a DECLAREd constant name (178). null if not static.
const termOf=(raw,constants)=>{
  const t=raw.trim();
  let m;
  if((m=/^E'((?:[^']|'')*)'$/is.exec(t)))return unescapeE(m[1]);
  if((m=new RegExp(`^${LITERAL}$`,'s').exec(t)))return unquote(m[1]);
  if((m=/^\$([a-z_]*)\$([\s\S]*)\$\1\$$/i.exec(t)))return m[2];
  if(constants.has(t.toLowerCase()))return constants.get(t.toLowerCase());
  return null;
};
// Split "a || b || c" at top-level || (outside quotes, dollar quotes and parens).
function splitConcat(text){
  const out=[];let depth=0,inQuote=false,dollar=null,start=0;
  for(let i=0;i<text.length;i+=1){
    const c=text[i];
    if(dollar){if(text.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
    if(inQuote){if(c==="'"){if(text[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
    if(c==="'"){inQuote=true;continue;}
    if(c==='$'){const d=/^\$[a-z_]*\$/i.exec(text.slice(i));if(d){dollar=d[0];i+=d[0].length-1;continue;}}
    if(c==='(')depth+=1;else if(c===')')depth-=1;
    else if(c==='|'&&text[i+1]==='|'&&depth===0){out.push(text.slice(start,i));start=i+2;i+=1;}
  }
  out.push(text.slice(start));
  return out;
}
// 051/141 idiom: a text built from static pieces joined with ||, including E'\n'.
const literalOf=(raw,constants=new Map())=>{
  const parts=splitConcat(raw).map(p=>termOf(p,constants));
  if(parts.length===0||parts.some(p=>p===null))return null;
  return parts.join('');
};
// DECLARE section constants: `name [constant] text := <static text expression>;` -- a plain
// literal (178), a dollar-quoted fragment (182, 439), an E'' string (141), or a || chain of those.
const DECLARED=/([a-z_][a-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*/gi;
function declaredConstants(block){
  const out=new Map();
  let m;DECLARED.lastIndex=0;
  while((m=DECLARED.exec(block))){
    // Take the expression up to the terminating ';' outside quotes/dollar-quotes.
    let i=m.index+m[0].length,inQuote=false,dollar=null;
    for(;i<block.length;i+=1){
      const c=block[i];
      if(dollar){if(block.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
      if(inQuote){if(c==="'"){if(block[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
      if(c==="'"){inQuote=true;continue;}
      if(c==='$'){const d=/^\$[a-z_]*\$/i.exec(block.slice(i));if(d){dollar=d[0];i+=d[0].length-1;continue;}}
      if(c===';')break;
    }
    const value=literalOf(block.slice(m.index+m[0].length,i),out);
    if(value!==null)out.set(m[1].toLowerCase(),value);
  }
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
    let [variable,rest]=first;
    const pair=splitArgs(rest);
    if(!pair)continue;
    // 181 idiom: EXECUTE replace(replace(definition,a,b),c,d) -- the outer call's subject is the
    // inner call; unwrap to the variable the chain started from.
    while(/^replace\(/i.test(variable)){
      const inner=splitArgs(variable.slice(variable.indexOf('(')+1,-1));
      if(!inner)break;
      variable=inner[0];
    }
    if(!/^[a-z_][a-z0-9_]*$/i.test(variable))continue;
    out.push({at:m.index,variable,from:literalOf(pair[0],constants),to:literalOf(pair[1],constants),fromRaw:pair[0],toRaw:pair[1]});
  }
  return out;
}

// Loop idiom (140, 313): `pg_get_functiondef(<row>.<col>::regprocedure)` where <col> is a column
// of a `(VALUES (...),(...)) AS <alias>(<cols>)` list in the same block. Every literal in that
// column is a static target; they all share the call position so each replace() pairs with all,
// unless an `IF <row>.<col>='<signature>' THEN ... END IF;` guard narrows it to one.
const LOOP_TARGET=/pg_get_functiondef\(\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*::\s*regprocedure\s*\)/gi;
function splitTopLevel(text){
  const out=[];let depth=0,inQuote=false,start=0;
  for(let i=0;i<text.length;i+=1){
    const c=text[i];
    if(inQuote){if(c==="'"){if(text[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
    if(c==="'")inQuote=true;
    else if(c==='(')depth+=1;
    else if(c===')')depth-=1;
    else if(c===','&&depth===0){out.push(text.slice(start,i));start=i+1;}
  }
  out.push(text.slice(start));
  return out.map(s=>s.trim());
}
function valuesListTargets(block,column){
  const re=/\(\s*VALUES\b/gi;let m;const out=[];
  while((m=re.exec(block))){
    let depth=1,inQuote=false,i=m.index+m[0].length;
    for(;i<block.length&&depth>0;i+=1){
      const c=block[i];
      if(inQuote){if(c==="'"){if(block[i+1]==="'"){i+=1;continue;}inQuote=false;}continue;}
      if(c==="'")inQuote=true;else if(c==='(')depth+=1;else if(c===')')depth-=1;
    }
    if(depth!==0)break;
    const inner=block.slice(m.index+m[0].length,i-1);
    const alias=/^\s*AS\s+[a-z_][a-z0-9_]*\s*\(([^)]*)\)/i.exec(block.slice(i));
    if(!alias)continue;
    const cols=alias[1].split(',').map(s=>s.trim().toLowerCase());
    const idx=cols.indexOf(column.toLowerCase());
    if(idx<0)continue;
    for(const tuple of splitTopLevel(inner)){
      const t=/^\(([\s\S]*)\)$/.exec(tuple.trim());
      if(!t)continue;
      const cell=splitTopLevel(t[1])[idx];
      const lit=cell?literalOf(cell):null;
      if(lit&&/^[a-z0-9_.]+\([^)]*\)$/i.test(lit))out.push(normalizeSignature(lit));
    }
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
    let loopCalls=0;
    LOOP_TARGET.lastIndex=0;let l;
    while((l=LOOP_TARGET.exec(body))){
      loopCalls+=1;
      const fns=valuesListTargets(body,l[2]);
      if(fns.length===0){unresolved.push({migration,reason:`pg_get_functiondef(${l[1]}.${l[2]}) has no VALUES list of literal signatures`,excerpt:body.slice(l.index,l.index+160)});continue;}
      const tail=body.slice(l.index,l.index+400);
      INTO_VAR.lastIndex=0;
      const into=INTO_VAR.exec(tail);
      for(const fn of fns)targets.push({at:l.index,fn,variable:into?.[1]?.toLowerCase()??null,loop:true});
    }
    const staticCalls=targets.filter(x=>!x.loop).length;
    const dynamic=(body.match(/pg_get_functiondef\(/gi)||[]).length-staticCalls-loopCalls;
    if(dynamic>0)unresolved.push({migration,reason:`${dynamic} pg_get_functiondef call(s) with a non-literal signature`,excerpt:body.slice(0,160).trim()});
    targets.sort((a,b)=>a.at-b.at);
    if(targets.length===0)continue;
    for(const call of replaceCalls(body)){
      // Pair with the latest target that was read into this variable before the call; fall back to
      // the latest target of any variable (single-target blocks that reassign under another name).
      const byVar=[...targets].reverse().find(x=>x.at<call.at&&x.variable===call.variable.toLowerCase());
      const target=byVar||[...targets].reverse().find(x=>x.at<call.at)||null;
      if(!target){unresolved.push({migration,reason:`replace(${call.variable},...) before any pg_get_functiondef target`,excerpt:body.slice(call.at,call.at+160)});continue;}
      const literal=call.from!==null&&call.to!==null;
      let group=target.loop?targets.filter(x=>x.at===target.at):[target];
      if(target.loop){
        const guard=[...body.matchAll(/\bIF\s+[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*=\s*'([^']+)'\s+THEN\b([\s\S]*?)\bEND\s+IF\s*;/gi)]
          .find(g=>g.index<call.at&&call.at<g.index+g[0].length);
        if(guard)group=group.filter(x=>x.fn===normalizeSignature(guard[1]));
      }
      for(const t of group)amendments.push({migration,fn:t.fn,variable:call.variable,from:call.from,to:call.to,literal,
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
