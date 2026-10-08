import {createHash} from 'node:crypto';
import {KernelError} from './db.mjs';
import {validReceiptRow} from './receipt-register.mjs';

const MAX_BYTES=25*1024*1024;
const fail=(code,message)=>new KernelError(code,message);
// This service accepts identities, never a caller-supplied object URI or version.
// The scoped kernel read is the authorization boundary and runs before storage.
export class ReceiptFileService {
  constructor({kernelFactory,storage}={}) {
    if(typeof kernelFactory!=='function'||typeof storage?.openVersion!=='function')throw new Error('Receipt file dependencies are required');
    this.kernelFactory=kernelFactory;this.storage=storage;
  }
  async read(principal,{entityId,receiptId}) {
    if(!principal?.trusted||typeof principal.tenantId!=='string')throw fail('AUTHORIZATION_DENIED','Receipt access is denied');
    const kernel=await this.kernelFactory(principal);
    const row=await kernel.readReceiptDetail({tenantId:principal.tenantId,entityId,receiptId});
    if(!validReceiptRow(row,{receiptId}))throw fail('RECEIPT_DETAIL_INVALID','Receipt evidence is invalid');
    if(!row.storage_ref.startsWith('s3://')||/^(pending:|test-only:)/i.test(row.storage_version))throw fail('RECEIPT_FILE_UNAVAILABLE','A retained provider object is required');
    const expected=BigInt(row.size_bytes);
    if(expected>BigInt(MAX_BYTES))throw fail('RECEIPT_FILE_TOO_LARGE','Receipt exceeds the download limit');
    const object=await this.storage.openVersion(row.storage_ref,row.storage_version);
    if(object?.sizeBytes!==Number(expected)||typeof object?.stream?.getReader!=='function') {
      try {await object?.stream?.cancel?.();} catch {}
      throw fail('RECEIPT_FILE_IDENTITY_MISMATCH','Receipt object size differs from retained evidence');
    }
    const reader=object.stream.getReader(),chunks=[],hash=createHash('sha256');let bytes=0;
    try {
      for(;;) {
        const {done,value}=await reader.read();if(done)break;
        if(!(value instanceof Uint8Array))throw fail('RECEIPT_FILE_IDENTITY_MISMATCH','Receipt stream is invalid');
        bytes+=value.byteLength;
        if(bytes>Number(expected)||bytes>MAX_BYTES)throw fail('RECEIPT_FILE_IDENTITY_MISMATCH','Receipt object exceeds retained size');
        const chunk=Buffer.from(value);chunks.push(chunk);hash.update(chunk);
      }
      if(bytes!==Number(expected)||`sha256:${hash.digest('hex')}`!==row.content_hash)throw fail('RECEIPT_FILE_IDENTITY_MISMATCH','Receipt object differs from retained evidence');
    } catch(error) {await reader.cancel().catch(()=>{});throw error;}
    finally {reader.releaseLock();}
    // Always download as inert bytes; do not render untrusted HTML/SVG inline.
    const filename=row.attachment_name.replace(/[\x00-\x1f\x7f"\\/]/g,'_');
    return {content:Buffer.concat(chunks,bytes),filename,contentHash:row.content_hash,storageVersion:row.storage_version,receiptId:row.receipt_id,attachmentId:row.attachment_id};
  }
}
