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

  async reserveAttachment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_attachment_reserve_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.name,args.mediaType,args.sizeBytes,args.contentHash,args.storageRef,args.storageVersion]
      ),'ATTACHMENT_RESERVE_HASH_FAILED','Attachment reserve hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_reserve_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.name,args.mediaType,args.sizeBytes,args.contentHash,args.storageRef,args.storageVersion,args.idempotencyKey,requestHash]
      ),'ATTACHMENT_RESERVE_FAILED','Attachment reservation did not return a result').result;
    });
  }

  async finalizeAttachment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_attachment_finalize_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.attachmentId,args.storageRef,args.observedSizeBytes,args.observedContentHash,args.observedMediaType,args.storageVersion,args.scanClean,args.scanRef]
      ),'ATTACHMENT_FINALIZE_HASH_FAILED','Attachment finalize hash was not produced').request_hash;
      return requireRow(await client.query(
        'SELECT refs_finalize_attachment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.attachmentId,args.storageRef,args.observedSizeBytes,args.observedContentHash,args.observedMediaType,args.storageVersion,args.scanClean,args.scanRef,args.idempotencyKey,requestHash]
      ),'ATTACHMENT_FINALIZE_FAILED','Attachment finalization did not return a result').result;
    });
  }

  async requestAttachmentFinalize({tenantId,entityId,attachmentId,idempotencyKey}){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_attachment_finalize_request_hash($1,$2,$3) AS request_hash',[tenantId,entityId,attachmentId]),'ATTACHMENT_FINALIZE_REQUEST_HASH_FAILED','Attachment finalize request hash was not produced').request_hash;
      return requireRow(await client.query('SELECT refs_request_attachment_finalize($1,$2,$3,$4,$5) AS result',[tenantId,entityId,attachmentId,idempotencyKey,requestHash]),'ATTACHMENT_NOT_FOUND','Attachment was not found').result;
    });
  }

  async claimExpiredAttachments({tenantId,entityId,limit=25}){return this.inSession(async client=>(await client.query('SELECT refs_claim_expired_attachments($1,$2,$3) AS items',[tenantId,entityId,limit])).rows[0].items);}
  async completeAttachmentCleanup({tenantId,entityId,attachmentId,claimToken,deleted,errorCode=null,errorCategory=null}){return this.inSession(async client=>(await client.query('SELECT refs_complete_attachment_cleanup($1,$2,$3,$4,$5,$6,$7) AS result',[tenantId,entityId,attachmentId,claimToken,deleted,errorCode,errorCategory])).rows[0].result);}

  async createAutoJournal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_auto_journal_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.stagingItemId,args.periodId,args.expectedStagingVersion,args.journalNumber,args.description??null,JSON.stringify(args.lines)]
      ),'AUTO_JOURNAL_CREATE_HASH_FAILED','Automatic journal hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_auto_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.stagingItemId,args.periodId,args.expectedStagingVersion,args.journalNumber,args.description??null,JSON.stringify(args.lines),args.idempotencyKey,requestHash]
      ),'AUTO_JOURNAL_CREATE_FAILED','Automatic journal creation did not return a result');
      return row.result;
    });
  }

  async createJournalAdjustment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_create_journal_adjustment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS request_hash',
        [args.action,args.tenantId,args.entityId,args.originalJournalEntryId,args.periodId,args.journalNumber,args.journalDate,args.description??null,args.reason,args.lines?JSON.stringify(args.lines):null,args.attachmentIds??[]]
      ),'JOURNAL_ADJUSTMENT_HASH_FAILED','Journal adjustment hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_journal_adjustment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
        [args.action,args.tenantId,args.entityId,args.originalJournalEntryId,args.periodId,args.journalNumber,args.journalDate,args.description??null,args.reason,args.lines?JSON.stringify(args.lines):null,args.attachmentIds??[],args.idempotencyKey,requestHash]
      ),'JOURNAL_ADJUSTMENT_FAILED','Journal adjustment creation did not return a result');
      return row.result;
    });
  }

  async createApBillVoid(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_bill_void_hash($1,$2,$3,$4,$5,$6,$7,$8) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.expectedVersion,args.journalNumber,args.journalDate,args.reason]
      ),'AP_BILL_VOID_HASH_FAILED','AP bill void hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_bill_void($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.expectedVersion,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]
      ),'AP_BILL_VOID_FAILED','AP bill void Draft creation did not return a result');
      return row.result;
    });
  }

  async createApVendorCredit(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_vendor_credit_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.creditNumber,args.creditDate,args.vendorRef,args.vendorName,args.amount,JSON.stringify(args.lines),args.reason]
      ),'AP_VENDOR_CREDIT_HASH_FAILED','AP vendor credit hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_vendor_credit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.periodId,args.creditNumber,args.creditDate,args.vendorRef,args.vendorName,args.amount,JSON.stringify(args.lines),args.reason,args.idempotencyKey,requestHash]
      ),'AP_VENDOR_CREDIT_FAILED','AP vendor credit Draft creation did not return a result');
      return row.result;
    });
  }

  async applyApVendorCredit(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_vendor_credit_allocation_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason]
      ),'AP_VENDOR_CREDIT_ALLOCATION_HASH_FAILED','AP vendor credit allocation hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_apply_ap_vendor_credit($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AP_VENDOR_CREDIT_ALLOCATION_FAILED','AP vendor credit allocation did not return a result');
      return row.result;
    });
  }

  async createApPayment(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ap_payment_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.paymentNumber,args.paymentDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason]
      ),'AP_PAYMENT_HASH_FAILED','AP payment hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ap_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.paymentNumber,args.paymentDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AP_PAYMENT_FAILED','AP payment Draft creation did not return a result');
      return row.result;
    });
  }

  async createArReceipt(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_receipt_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.receiptNumber,args.receiptDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason]
      ),'AR_RECEIPT_HASH_FAILED','AR receipt hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ar_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
        [args.tenantId,args.entityId,args.businessDocumentId,args.periodId,args.receiptNumber,args.receiptDate,args.cashAccountCode,args.bankMemberRef??null,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_RECEIPT_FAILED','AR receipt Draft creation did not return a result');
      return row.result;
    });
  }

  async createArReceiptReversal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_ar_receipt_reversal_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason]),'AR_RECEIPT_REVERSAL_HASH_FAILED','AR receipt reversal hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ar_receipt_reversal($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]),'AR_RECEIPT_REVERSAL_FAILED','AR receipt reversal Draft creation did not return a result');
      return row.result;
    });
  }

  async getArAging({tenantId,entityId,asOfDate}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ar_aging($1,$2,$3::date)',[tenantId,entityId,asOfDate]
    )).rows);
  }

  async listBusinessDocuments({tenantId,entityId,documentKind}){
    if(!['AP_BILL','AR_INVOICE'].includes(documentKind))throw new KernelError('BUSINESS_DOCUMENT_KIND_INVALID','Unsupported business document kind');
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_list_business_documents($1,$2,$3)',[tenantId,entityId,documentKind]
    )).rows);
  }

  async getApAging({tenantId,entityId,asOfDate}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ap_aging($1,$2,$3::date)',[tenantId,entityId,asOfDate]
    )).rows);
  }

  async getApControlTotal({tenantId,entityId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ap_control_total($1,$2)',[tenantId,entityId]
    )).rows);
  }

  async getArControlTotal({tenantId,entityId}){
    return this.inSession(async client=>(await client.query(
      'SELECT * FROM refs_ar_control_total($1,$2)',[tenantId,entityId]
    )).rows);
  }

  async createArCreditMemo(args){
    return this.inSession(async client=>{
      const lines=typeof args.lines==='string'?args.lines:JSON.stringify(args.lines);
      const requestHash=requireRow(await client.query('SELECT refs_ar_credit_memo_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS request_hash',[args.tenantId,args.entityId,args.periodId,args.memoNumber,args.memoDate,args.customerRef,args.customerName,args.amount,lines,args.reason]),'AR_CREDIT_MEMO_HASH_FAILED','AR credit memo hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ar_credit_memo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',[args.tenantId,args.entityId,args.periodId,args.memoNumber,args.memoDate,args.customerRef,args.customerName,args.amount,lines,args.reason,args.idempotencyKey,requestHash]),'AR_CREDIT_MEMO_FAILED','AR credit memo Draft creation did not return a result');
      return row.result;
    });
  }

  async applyArCreditMemo(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_credit_memo_allocation_hash($1,$2,$3,$4,$5,$6) AS request_hash',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason]
      ),'AR_CREDIT_MEMO_ALLOCATION_HASH_FAILED','AR credit memo allocation hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_apply_ar_credit_memo($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [args.tenantId,args.entityId,args.businessAdjustmentId,args.businessDocumentId,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_CREDIT_MEMO_ALLOCATION_FAILED','AR credit memo allocation did not return a result');
      return row.result;
    });
  }

  async createArRefund(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query(
        'SELECT refs_ar_refund_hash($1,$2,$3,$4,$5,$6,$7,$8,$9) AS request_hash',
        [args.tenantId,args.entityId,args.periodId,args.sourceAdjustmentId,args.refundNumber,args.refundDate,args.cashAccountCode,args.amount,args.reason]
      ),'AR_REFUND_HASH_FAILED','AR refund hash was not produced').request_hash;
      const row=requireRow(await client.query(
        'SELECT refs_create_ar_refund($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [args.tenantId,args.entityId,args.periodId,args.sourceAdjustmentId,args.refundNumber,args.refundDate,args.cashAccountCode,args.amount,args.reason,args.idempotencyKey,requestHash]
      ),'AR_REFUND_FAILED','AR refund Draft creation did not return a result');
      return row.result;
    });
  }

  async createApPaymentReversal(args){
    return this.inSession(async client=>{
      const requestHash=requireRow(await client.query('SELECT refs_ap_payment_reversal_hash($1,$2,$3,$4,$5,$6,$7) AS request_hash',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason]),'AP_PAYMENT_REVERSAL_HASH_FAILED','AP payment reversal hash was not produced').request_hash;
      const row=requireRow(await client.query('SELECT refs_create_ap_payment_reversal($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[args.tenantId,args.entityId,args.sourceOccurrenceId,args.periodId,args.journalNumber,args.journalDate,args.reason,args.idempotencyKey,requestHash]),'AP_PAYMENT_REVERSAL_FAILED','AP payment reversal Draft creation did not return a result');
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
