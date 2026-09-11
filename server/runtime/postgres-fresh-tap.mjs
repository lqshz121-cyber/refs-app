const TAP_SUMMARY_KEYS=['tests','pass','fail','cancelled','skipped','todo'];

export function readTapSummary(output){
  const text=String(output);
  const starts=[...text.matchAll(/^# tests \d+$/gm)];
  if(starts.length===0)return null;
  const summaryBlock=text.slice(starts.at(-1).index);
  const summary={};
  for(const key of TAP_SUMMARY_KEYS){
    const match=summaryBlock.match(new RegExp(`^# ${key} (\\d+)$`,'m'));
    if(!match)return null;
    summary[key]=Number(match[1]);
  }
  return summary;
}

export function verifyFreshPostgresTap(output,{expectedPatternPassCount=null}={}){
  const tap=readTapSummary(output);
  if(tap===null)throw new Error('Fresh PostgreSQL gate received no complete TAP summary');
  if(expectedPatternPassCount===null){
    if(tap.tests<1||tap.pass!==tap.tests||tap.fail!==0||tap.cancelled!==0||tap.skipped!==0||tap.todo!==0){
      throw new Error(`Full fresh PostgreSQL gate requires one or more passing, non-skipped tests; received ${JSON.stringify(tap)}`);
    }
    return {mode:'FULL',tap};
  }
  if(!Number.isInteger(expectedPatternPassCount)||expectedPatternPassCount<1)throw new Error('Pattern fresh PostgreSQL gate requires a positive declared match count');
  if(tap.tests<1||tap.pass!==expectedPatternPassCount||tap.fail!==0||tap.cancelled!==0||tap.todo!==0||tap.tests!==tap.pass+tap.skipped){
    throw new Error(`Pattern fresh PostgreSQL gate requires every declared match to pass and permits skips only for unmatched tests; expected ${expectedPatternPassCount}, received ${JSON.stringify(tap)}`);
  }
  return {mode:'PATTERN',tap};
}

export function formatFreshPostgresVerification({mode,tap}){
  return `Fresh PostgreSQL gate verified mode=${mode} tests=${tap.tests} pass=${tap.pass} fail=${tap.fail} cancelled=${tap.cancelled} skipped=${tap.skipped} todo=${tap.todo}`;
}

export function readFreshPostgresVerification(output){
  const pattern=/^Fresh PostgreSQL gate verified mode=(FULL|PATTERN) tests=(\d+) pass=(\d+) fail=(\d+) cancelled=(\d+) skipped=(\d+) todo=(\d+)$/gm;
  const matches=[...String(output).matchAll(pattern)];
  if(matches.length===0)return null;
  const match=matches.at(-1);
  return {
    mode:match[1],
    tap:{tests:Number(match[2]),pass:Number(match[3]),fail:Number(match[4]),cancelled:Number(match[5]),skipped:Number(match[6]),todo:Number(match[7])}
  };
}
