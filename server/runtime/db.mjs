import {runtimeConfig} from './config.mjs';

export class KernelError extends Error{
  constructor(code,message,details={}){super(message);this.name='KernelError';this.code=code;this.details=details;}
}

export async function createPool(options={}){
  let pg;
  try{pg=await import('pg');}
  catch(error){throw new KernelError('PG_DRIVER_UNAVAILABLE','Install server dependencies before starting the PostgreSQL kernel',{cause:error.message});}
  const config=runtimeConfig();
  const Pool=pg.default?.Pool||pg.Pool;
  return new Pool({
    connectionString:options.databaseUrl||config.databaseUrl,
    max:options.max||10,
    application_name:options.applicationName||'refs-accounting-kernel',
    statement_timeout:options.statementTimeoutMs||config.statementTimeoutMs,
    lock_timeout:options.lockTimeoutMs||config.lockTimeoutMs
  });
}

export async function withTransaction(pool,work,{isolation='SERIALIZABLE'}={}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    const value=await work(client);
    await client.query('COMMIT');
    return value;
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{client.release();}
}

export function requireRow(result,code,message){
  if(result.rowCount!==1)throw new KernelError(code,message);
  return result.rows[0];
}
