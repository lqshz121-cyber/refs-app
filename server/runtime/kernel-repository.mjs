import {KernelError,requireRow,withTransaction} from './db.mjs';

function assertTrustedSession(session){
  if(!session||session.trusted!==true||typeof session.contextToken!=='string'||session.contextToken.length<32)throw new KernelError('TRUSTED_SESSION_REQUIRED','Kernel session requires an opaque DB-issued context token from authenticated middleware');
  return session;
}

export class PostgresAccountingKernel{
  constructor(pool,{sessionProvider,runtimeLoginAllowlist=['refs_runtime']}={}){
    if(typeof sessionProvider!=='function')throw new KernelError('SESSION_PROVIDER_REQUIRED','A trusted session provider is required');
    this.pool=pool;this.sessionProvider=sessionProvider;this.runtimeLoginAllowlist=new Set(runtimeLoginAllowlist);
  }

  async inSession(work){
    const session=assertTrustedSession(await this.sessionProvider());
    return withTransaction(this.pool,async client=>{
      const identity=requireRow(await client.query(`SELECT session_user,current_user,
        COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname=session_user),false) AS is_superuser`),'DB_IDENTITY_MISSING','Database identity is unavailable');
      if(!this.runtimeLoginAllowlist.has(identity.session_user)||identity.current_user!==identity.session_user||identity.is_superuser){
        throw new KernelError('DB_RUNTIME_IDENTITY_DENIED','Runtime connection must use an approved non-superuser login');
      }
      await client.query('SET LOCAL ROLE refs_app');
      await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);
      return work(client,session);
    });
  }

  async updateDraftDescription({tenantId,entityId,journalEntryId,expectedRevision,description,idempotencyKey,requestHash}){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_update_draft_description($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,journalEntryId,expectedRevision,description,idempotencyKey,requestHash]
      ),'EDIT_FAILED','Draft edit did not return a result');
      return row.result;
    });
  }

  async postJournal(args){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_post_journal($1,$2,$3,$4,$5,$6,$7,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.journalEntryId,args.expectedRevision,args.idempotencyKey,args.requestHash]
      ),'POST_FAILED','Posting did not return a result');
      return row.result;
    });
  }

  async closePeriod(args){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_close_period($1,$2,$3,$4,$5,$6,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.expectedVersion,args.idempotencyKey,args.requestHash]
      ),'PERIOD_CLOSE_FAILED','Period close did not return a result');
      return row.result;
    });
  }

  async commandAutoReconciliation(args){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_auto_recon_command($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.matchGroupId,args.command,args.expectedVersion,args.reason||null,args.idempotencyKey,args.requestHash]
      ),'AUTO_RECON_COMMAND_FAILED','AutoReconciliation command did not return a result');
      return row.result;
    });
  }

  async completeAutoReconciliationSync(args){
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_auto_recon_sync_callback($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [args.tenantId,args.entityId,args.matchGroupId,args.outboxEventId,args.attempt,args.success,args.responseHash,args.callbackKey,args.errorCode||null]
      ),'AUTO_RECON_SYNC_CALLBACK_FAILED','AutoReconciliation sync callback did not return a result');
      return row.result;
    });
  }

  async claimOutbox({tenantId,limit=100}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_claim_outbox($1,refs_current_actor(),$2)',[tenantId,limit]
    )).rows);
  }

  async completeOutbox({tenantId,eventId,success,error=null}){
    return this.inSession(client=>client.query(
      'SELECT refs_complete_outbox($1,$2,refs_current_actor(),$3,$4)',[tenantId,eventId,success,error]
    ));
  }
}
