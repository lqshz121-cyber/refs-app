import assert from 'node:assert/strict';

// Database DDL can wait for filesystem synchronization on local Docker volumes.
// Borrow one connection so its DDL timeout never changes another pool user.
export async function dropIamRaceDatabase(pool,name,primaryError){
  assert.match(name,/^refs_iam_race_[0-9a-f]{16}_test$/,'only the generated IAM race database may be removed');
  let client,priorTimeout,discardError;const errors=[];
  try{
    client=await pool.connect();
    priorTimeout=(await client.query("SELECT current_setting('statement_timeout') AS timeout")).rows[0].timeout;
    await client.query("SELECT set_config('statement_timeout',$1,false)",['600000']);
    await client.query(`DROP DATABASE "${name}"`);
  }catch(error){errors.push(error);}
  finally{
    if(client){
      if(priorTimeout!==undefined){try{await client.query("SELECT set_config('statement_timeout',$1,false)",[priorTimeout]);}catch(error){errors.push(error);discardError=error;}}
      client.release(discardError);
    }
  }
  if(errors.length){if(primaryError!==undefined)errors.unshift(primaryError);throw errors.length===1?errors[0]:new AggregateError(errors,'IAM race fixture and database cleanup did not both complete');}
}
