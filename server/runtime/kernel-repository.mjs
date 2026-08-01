import {KernelError,requireRow,withSerializableRetry} from './db.mjs';
import {canonicalRequestHash} from './request-hash.mjs';

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
    return withSerializableRetry(this.pool,async client=>{
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
    requestHash=canonicalRequestHash({tenantId,entityId,journalEntryId,expectedRevision,description});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_update_draft_description($1,$2,$3,$4,$5,$6,$7) AS result',
        [tenantId,entityId,journalEntryId,expectedRevision,description,idempotencyKey,requestHash]
      ),'EDIT_FAILED','Draft edit did not return a result');
      return row.result;
    });
  }

  async createManualJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_manual_journal_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds]
      ),'JOURNAL_CREATE_HASH_FAILED','Manual journal hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_manual_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [args.tenantId,args.entityId,args.periodId,args.journalNumber,args.journalDate,args.currency,args.description??null,JSON.stringify(args.lines),args.attachmentIds,args.idempotencyKey,requestHash]
      ),'JOURNAL_CREATE_FAILED','Manual journal creation did not return a result');
      return row.result;
    });
  }

  async transitionJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_journal_transition_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.journalEntryId,args.action,args.expectedRevision,args.reason??null]
      ),'JOURNAL_TRANSITION_HASH_FAILED','Journal transition hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_transition_journal($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.journalEntryId,args.action,args.expectedRevision,args.reason??null,args.idempotencyKey,requestHash]
      ),'JOURNAL_TRANSITION_FAILED','Journal transition did not return a result');
      return row.result;
    });
  }

  async postJournal(args){
    const requestHash=canonicalRequestHash({tenantId:args.tenantId,entityId:args.entityId,periodId:args.periodId,journalEntryId:args.journalEntryId,expectedRevision:args.expectedRevision});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_post_journal($1,$2,$3,$4,$5,$6,$7,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.journalEntryId,args.expectedRevision,args.idempotencyKey,requestHash]
      ),'POST_FAILED','Posting did not return a result');
      return row.result;
    });
  }

  async closePeriod(args){
    const requestHash=canonicalRequestHash({tenantId:args.tenantId,entityId:args.entityId,periodId:args.periodId,expectedVersion:args.expectedVersion});
    return this.inSession(async client=>{
      const row=requireRow(await client.query(
        'SELECT refs_close_period($1,$2,$3,$4,$5,$6,refs_current_actor()) AS result',
        [args.tenantId,args.entityId,args.periodId,args.expectedVersion,args.idempotencyKey,requestHash]
      ),'PERIOD_CLOSE_FAILED','Period close did not return a result');
      return row.result;
    });
  }

  async retireConfigSnapshot(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_config_retire_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',
        [args.kind,args.tenantId,args.entityId,args.snapshotId,args.expectedRevision,args.cutoff,args.reason]
      ),'CONFIG_RETIRE_HASH_FAILED','Configuration retirement hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_retire_config_snapshot($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [args.kind,args.tenantId,args.entityId,args.snapshotId,args.expectedRevision,args.cutoff,args.reason,args.idempotencyKey,requestHash]
      ),'CONFIG_RETIRE_FAILED','Configuration retirement did not return a result');
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
