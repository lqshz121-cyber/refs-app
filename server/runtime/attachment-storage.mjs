import {createHash,createHmac,randomUUID} from 'node:crypto';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value,encoding)=>createHmac('sha256',key).update(value).digest(encoding);
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const canonicalQuery=params=>[...params.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv)).map(([key,value])=>`${encode(key)}=${encode(value)}`).join('&');
const timestamp=date=>date.toISOString().replace(/[:-]|\.\d{3}/g,'');
const dateStamp=date=>timestamp(date).slice(0,8);
const safeSegment=value=>{if(typeof value!=='string'||!/^[0-9a-zA-Z._-]+$/.test(value))throw new Error('Unsafe object key segment');return value;};

export class S3AttachmentStorage{
  constructor({endpoint,bucket,region,accessKeyId,secretAccessKey,sessionToken=null,prefix='refs-attachments',fetcher=globalThis.fetch,clock=()=>new Date(),uploadTtlSeconds=900,requireVersionId=true}={}){
    let parsed;try{parsed=new URL(endpoint);}catch{throw new Error('S3 endpoint must be a valid URL');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('S3 endpoint must be a credential-free HTTPS URL');
    if(!bucket||!region||!accessKeyId||!secretAccessKey||typeof fetcher!=='function')throw new Error('S3 storage configuration is incomplete');
    this.endpoint=parsed;this.bucket=safeSegment(bucket);this.region=region;this.accessKeyId=accessKeyId;this.secretAccessKey=secretAccessKey;this.sessionToken=sessionToken;this.prefix=prefix.split('/').map(safeSegment).join('/');this.fetcher=fetcher;this.clock=clock;this.uploadTtlSeconds=uploadTtlSeconds;this.requireVersionId=requireVersionId;
  }
  deriveKey(date){const dateKey=hmac(`AWS4${this.secretAccessKey}`,date);const regionKey=hmac(dateKey,this.region);const serviceKey=hmac(regionKey,'s3');return hmac(serviceKey,'aws4_request');}
  objectUrl(key){const url=new URL(this.endpoint);url.pathname=`${url.pathname.replace(/\/$/,'')}/${encode(this.bucket)}/${key.split('/').map(encode).join('/')}`;return url;}
  storageRef(key){return `s3://${this.bucket}/${key}`;}
  parseRef(storageRef){const match=new RegExp(`^s3://${this.bucket}/(.+)$`).exec(storageRef||'');if(!match)throw new Error('Storage reference is outside configured bucket');const key=match[1];if(!key.startsWith(`${this.prefix}/`)||key.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Storage reference is outside configured prefix');return key;}
  presignPut(key,{mediaType,contentHash}){
    const now=this.clock(),amzDate=timestamp(now),date=dateStamp(now),scope=`${date}/${this.region}/s3/aws4_request`,url=this.objectUrl(key);
    url.searchParams.set('X-Amz-Algorithm','AWS4-HMAC-SHA256');url.searchParams.set('X-Amz-Credential',`${this.accessKeyId}/${scope}`);url.searchParams.set('X-Amz-Date',amzDate);url.searchParams.set('X-Amz-Expires',String(this.uploadTtlSeconds));url.searchParams.set('X-Amz-SignedHeaders','content-type;host;x-amz-meta-sha256');if(this.sessionToken)url.searchParams.set('X-Amz-Security-Token',this.sessionToken);
    const headers=`content-type:${mediaType.trim().toLowerCase()}\nhost:${url.host}\nx-amz-meta-sha256:${contentHash.toLowerCase()}\n`;
    const canonical=`PUT\n${url.pathname}\n${canonicalQuery(url.searchParams)}\n${headers}\ncontent-type;host;x-amz-meta-sha256\nUNSIGNED-PAYLOAD`;
    const stringToSign=`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;url.searchParams.set('X-Amz-Signature',hmac(this.deriveKey(date),stringToSign,'hex'));
    return url.toString();
  }
  signedHeaders(method,url){
    const now=this.clock(),amzDate=timestamp(now),date=dateStamp(now),scope=`${date}/${this.region}/s3/aws4_request`;const headers={'x-amz-date':amzDate,'x-amz-content-sha256':sha256('')};if(this.sessionToken)headers['x-amz-security-token']=this.sessionToken;
    const names=['host',...Object.keys(headers)].sort(),values={host:url.host,...headers};const canonicalHeaders=names.map(name=>`${name}:${values[name]}\n`).join('');
    const canonical=`${method}\n${url.pathname}\n${canonicalQuery(url.searchParams)}\n${canonicalHeaders}\n${names.join(';')}\n${headers['x-amz-content-sha256']}`;
    const signature=hmac(this.deriveKey(date),`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`,'hex');
    return {...headers,authorization:`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`};
  }
  async reserveUpload({tenantId,entityId,mediaType,contentHash}){
    const key=`${this.prefix}/${safeSegment(tenantId)}/${safeSegment(entityId)}/${randomUUID()}`;const reservationId=randomUUID();
    return {storageRef:this.storageRef(key),storageVersion:`pending:${reservationId}`,uploadUrl:this.presignPut(key,{mediaType,contentHash}),requiredHeaders:{'content-type':mediaType.toLowerCase(),'x-amz-meta-sha256':contentHash.toLowerCase()},expiresAt:new Date(this.clock().getTime()+this.uploadTtlSeconds*1000).toISOString()};
  }
  async inspect(storageRef){
    const url=this.objectUrl(this.parseRef(storageRef));const response=await this.fetcher(url,{method:'HEAD',headers:this.signedHeaders('HEAD',url),redirect:'error'});if(!response.ok)throw new Error(`Object HEAD failed with ${response.status}`);
    const size=Number(response.headers.get('content-length')),mediaType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),contentHash=response.headers.get('x-amz-meta-sha256')?.toLowerCase(),versionId=response.headers.get('x-amz-version-id');
    if(!Number.isSafeInteger(size)||size<=0||!mediaType||!/^sha256:[0-9a-f]{64}$/.test(contentHash||'')||(this.requireVersionId&&!versionId))throw new Error('Object metadata is incomplete');
    return {sizeBytes:size,mediaType,contentHash,storageVersion:versionId||`etag:${response.headers.get('etag')?.replaceAll('"','')}`};
  }
  async deleteReservation(storageRef){const url=this.objectUrl(this.parseRef(storageRef));const response=await this.fetcher(url,{method:'DELETE',headers:this.signedHeaders('DELETE',url),redirect:'error'});if(!response.ok&&response.status!==404)throw new Error(`Object cleanup failed with ${response.status}`);}
}

export class HttpVirusScanner{
  constructor({endpoint,bearerToken,fetcher=globalThis.fetch,timeoutMs=30000}={}){let url;try{url=new URL(endpoint);}catch{throw new Error('Scanner endpoint must be a valid URL');}if(url.protocol!=='https:'||!bearerToken||typeof fetcher!=='function')throw new Error('Scanner requires HTTPS endpoint and credential');this.endpoint=url;this.bearerToken=bearerToken;this.fetcher=fetcher;this.timeoutMs=timeoutMs;}
  async scan({storageRef,storageVersion}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${this.bearerToken}`,'content-type':'application/json'},body:JSON.stringify({storage_ref:storageRef,storage_version:storageVersion})});if(!response.ok)throw new Error(`Scanner failed with ${response.status}`);const result=await response.json();if(typeof result.clean!=='boolean'||typeof result.scan_ref!=='string'||!result.scan_ref)throw new Error('Scanner response is invalid');return {clean:result.clean,scanRef:result.scan_ref};}finally{clearTimeout(timer);}}
}

export class AttachmentEvidenceService{
  constructor({storage,scanner,uploaderKernelFactory,scannerKernelFactory}={}){if(!storage||!scanner||typeof uploaderKernelFactory!=='function'||typeof scannerKernelFactory!=='function')throw new Error('Attachment service dependencies are required');this.storage=storage;this.scanner=scanner;this.uploaderKernelFactory=uploaderKernelFactory;this.scannerKernelFactory=scannerKernelFactory;}
  async reserve(principal,args){const reservation=await this.storage.reserveUpload(args);try{const kernel=await this.uploaderKernelFactory(principal);const record=await kernel.reserveAttachment({...args,storageRef:reservation.storageRef,storageVersion:reservation.storageVersion});return {...record,upload_url:reservation.uploadUrl,required_headers:reservation.requiredHeaders,upload_expires_at:reservation.expiresAt};}catch(error){await this.storage.deleteReservation(reservation.storageRef).catch(()=>{});throw error;}}
  async finalize(principal,args){const observed=await this.storage.inspect(args.storageRef);const scan=await this.scanner.scan({storageRef:args.storageRef,storageVersion:observed.storageVersion});const kernel=await this.scannerKernelFactory(principal);return kernel.finalizeAttachment({...args,observedSizeBytes:observed.sizeBytes,observedContentHash:observed.contentHash,observedMediaType:observed.mediaType,storageVersion:observed.storageVersion,scanClean:scan.clean,scanRef:scan.scanRef});}
}
