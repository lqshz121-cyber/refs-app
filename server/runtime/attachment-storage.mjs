import {createHash,createHmac,randomUUID} from 'node:crypto';import {request as httpsRequest} from 'node:https';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value,encoding)=>createHmac('sha256',key).update(value).digest(encoding);
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const canonicalQuery=params=>[...params.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv)).map(([key,value])=>`${encode(key)}=${encode(value)}`).join('&');
const timestamp=date=>date.toISOString().replace(/[:-]|\.\d{3}/g,'');
const dateStamp=date=>timestamp(date).slice(0,8);
const safeSegment=value=>{if(typeof value!=='string'||!/^[0-9a-zA-Z._-]+$/.test(value))throw new Error('Unsafe object key segment');return value;};
const xmlText=(xml,tag)=>new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml)?.[1]?.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'")||null;
const storageFailure=(code,category,status=null)=>Object.assign(new Error(code),{code,category,status});
export const classifyCleanupFailure=error=>{const status=Number(error?.status);if(error?.code==='STORAGE_RETENTION'||[403,409,423].includes(status))return {errorCode:'ATTACHMENT_RETENTION_ACTIVE',errorCategory:'RETENTION'};if(error?.code==='STORAGE_PARTIAL_DELETE')return {errorCode:'ATTACHMENT_VERSION_DELETE_PARTIAL',errorCategory:'STORAGE'};return {errorCode:'ATTACHMENT_STORAGE_UNAVAILABLE',errorCategory:'STORAGE'};};
const tlsJsonFetch=(url,init,{ca,serverName})=>new Promise((resolve,reject)=>{const req=httpsRequest(url,{method:init.method,headers:init.headers,ca,servername:serverName,rejectUnauthorized:true},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.once('error',reject);if(init.signal){const abort=()=>req.destroy(init.signal.reason||new Error('Scanner request aborted'));if(init.signal.aborted)return abort();init.signal.addEventListener('abort',abort,{once:true});}if(init.body)req.write(init.body);req.end();});

export class S3AttachmentStorage{
  constructor({endpoint,bucket,region,accessKeyId,secretAccessKey,sessionToken=null,prefix='refs-attachments',fetcher=globalThis.fetch,clock=()=>new Date(),uploadTtlSeconds=900,requireVersionId=true,allowInsecureLoopbackForTests=false,allowInsecureHttpForTests=false}={}){
    let parsed;try{parsed=new URL(endpoint);}catch{throw new Error('S3 endpoint must be a valid URL');}
    const loopbackHost=['127.0.0.1','localhost','::1'].includes(parsed.hostname);
    const testLoopback=(allowInsecureLoopbackForTests||allowInsecureHttpForTests)&&loopbackHost&&parsed.protocol==='http:';
    if((parsed.protocol!=='https:'&&!testLoopback)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('S3 endpoint must be a credential-free HTTPS URL');
    if(!bucket||!region||!accessKeyId||!secretAccessKey||typeof fetcher!=='function')throw new Error('S3 storage configuration is incomplete');
    this.endpoint=parsed;this.bucket=safeSegment(bucket);this.region=region;this.accessKeyId=accessKeyId;this.secretAccessKey=secretAccessKey;this.sessionToken=sessionToken;this.prefix=prefix.split('/').map(safeSegment).join('/');this.fetcher=fetcher;this.clock=clock;this.uploadTtlSeconds=uploadTtlSeconds;this.requireVersionId=requireVersionId;
  }
  deriveKey(date){const dateKey=hmac(`AWS4${this.secretAccessKey}`,date);const regionKey=hmac(dateKey,this.region);const serviceKey=hmac(regionKey,'s3');return hmac(serviceKey,'aws4_request');}
  objectUrl(key){const url=new URL(this.endpoint);url.pathname=`${url.pathname.replace(/\/$/,'')}/${encode(this.bucket)}/${key.split('/').map(encode).join('/')}`;return url;}
  bucketUrl(){const url=new URL(this.endpoint);url.pathname=`${url.pathname.replace(/\/$/,'')}/${encode(this.bucket)}`;return url;}
  storageRef(key){return `s3://${this.bucket}/${key}`;}
  parseRef(storageRef){const match=new RegExp(`^s3://${this.bucket}/(.+)$`).exec(storageRef||'');if(!match)throw new Error('Storage reference is outside configured bucket');const key=match[1];if(!key.startsWith(`${this.prefix}/`)||key.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Storage reference is outside configured prefix');return key;}
  presignPut(key,{mediaType,contentHash,expiresInSeconds=this.uploadTtlSeconds,issuedAt=this.clock()}){
    if(!Number.isInteger(expiresInSeconds)||expiresInSeconds<1||expiresInSeconds>this.uploadTtlSeconds)throw new Error('Upload URL lifetime is invalid');
    const now=issuedAt,amzDate=timestamp(now),date=dateStamp(now),scope=`${date}/${this.region}/s3/aws4_request`,url=this.objectUrl(key);
    url.searchParams.set('X-Amz-Algorithm','AWS4-HMAC-SHA256');url.searchParams.set('X-Amz-Credential',`${this.accessKeyId}/${scope}`);url.searchParams.set('X-Amz-Date',amzDate);url.searchParams.set('X-Amz-Expires',String(expiresInSeconds));url.searchParams.set('X-Amz-SignedHeaders','content-type;host;x-amz-meta-sha256');if(this.sessionToken)url.searchParams.set('X-Amz-Security-Token',this.sessionToken);
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
  async reserveUpload({tenantId,entityId,mediaType,contentHash,idempotencyKey=null}){
    const deterministic=idempotencyKey?sha256(`${tenantId}\u0000${entityId}\u0000${idempotencyKey}`):null;
    const objectId=deterministic?`${deterministic.slice(0,8)}-${deterministic.slice(8,12)}-4${deterministic.slice(13,16)}-8${deterministic.slice(17,20)}-${deterministic.slice(20,32)}`:randomUUID();
    const key=`${this.prefix}/${safeSegment(tenantId)}/${safeSegment(entityId)}/${objectId}`;const reservationId=objectId;
    return {storageRef:this.storageRef(key),storageVersion:`pending:${reservationId}`,uploadUrl:this.presignPut(key,{mediaType,contentHash}),requiredHeaders:{'content-type':mediaType.toLowerCase(),'x-amz-meta-sha256':contentHash.toLowerCase()},expiresAt:new Date(this.clock().getTime()+this.uploadTtlSeconds*1000).toISOString()};
  }
  async resumeUpload({tenantId,entityId,storageRef,mediaType,contentHash,uploadExpiresAt}){
    const key=this.parseRef(storageRef),prefix=`${this.prefix}/`,parts=key.startsWith(prefix)?key.slice(prefix.length).split('/'):[];
    if(parts.length!==3||parts[0].toLowerCase()!==safeSegment(tenantId).toLowerCase()||parts[1].toLowerCase()!==safeSegment(entityId).toLowerCase()||!parts[2])throw storageFailure('ATTACHMENT_RESERVATION_SCOPE_INVALID','STORAGE');
    const issuedAt=this.clock(),expiresInSeconds=Math.min(this.uploadTtlSeconds,Math.floor((Date.parse(uploadExpiresAt)-issuedAt.getTime())/1000));
    if(!Number.isInteger(expiresInSeconds)||expiresInSeconds<1)throw storageFailure('ATTACHMENT_RESERVATION_CLOSED','STATE');
    return {uploadUrl:this.presignPut(key,{mediaType,contentHash,expiresInSeconds,issuedAt}),requiredHeaders:{'content-type':mediaType,'x-amz-meta-sha256':contentHash},expiresAt:uploadExpiresAt};
  }
  async probe(){const url=this.bucketUrl();url.searchParams.set('location','');const response=await this.fetcher(url,{method:'GET',headers:this.signedHeaders('GET',url),redirect:'error'});if(!response.ok)throw storageFailure('STORAGE_READINESS_FAILED','STORAGE',response.status);return true;}
  async inspect(storageRef,{versionId=null}={}){
    const url=this.objectUrl(this.parseRef(storageRef));if(versionId)url.searchParams.set('versionId',versionId);const response=await this.fetcher(url,{method:'HEAD',headers:this.signedHeaders('HEAD',url),redirect:'error'});if(!response.ok)throw new Error(`Object HEAD failed with ${response.status}`);
    const size=Number(response.headers.get('content-length')),mediaType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),contentHash=response.headers.get('x-amz-meta-sha256')?.toLowerCase(),observedVersionId=response.headers.get('x-amz-version-id');
    if(!Number.isSafeInteger(size)||size<=0||!mediaType||!/^sha256:[0-9a-f]{64}$/.test(contentHash||'')||(this.requireVersionId&&!observedVersionId))throw new Error('Object metadata is incomplete');
    return {sizeBytes:size,mediaType,contentHash,storageVersion:observedVersionId||`etag:${response.headers.get('etag')?.replaceAll('"','')}`};
  }
  async readVersion(storageRef,versionId){if(typeof versionId!=='string'||!versionId||versionId.startsWith('pending:'))throw new Error('A finalized object version is required');const url=this.objectUrl(this.parseRef(storageRef));url.searchParams.set('versionId',versionId);const response=await this.fetcher(url,{method:'GET',headers:this.signedHeaders('GET',url),redirect:'error'});if(!response.ok)throw new Error(`Object version GET failed with ${response.status}`);return new Uint8Array(await response.arrayBuffer());}
  async openVersion(storageRef,versionId){if(typeof versionId!=='string'||!versionId||versionId.startsWith('pending:'))throw new Error('A finalized object version is required');const url=this.objectUrl(this.parseRef(storageRef));url.searchParams.set('versionId',versionId);const response=await this.fetcher(url,{method:'GET',headers:this.signedHeaders('GET',url),redirect:'error'});if(!response.ok)throw storageFailure('STORAGE_VERSION_READ','STORAGE',response.status);const sizeBytes=Number(response.headers.get('content-length'));if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||!response.body)throw storageFailure('STORAGE_VERSION_METADATA','STORAGE');return {stream:response.body,sizeBytes};}
  async listVersions(storageRef){const key=this.parseRef(storageRef),items=[];let keyMarker=null,versionMarker=null;for(let page=0;page<100;page++){const url=new URL(this.endpoint);url.pathname=`${url.pathname.replace(/\/$/,'')}/${encode(this.bucket)}`;url.searchParams.set('versions','');url.searchParams.set('prefix',key);if(keyMarker)url.searchParams.set('key-marker',keyMarker);if(versionMarker)url.searchParams.set('version-id-marker',versionMarker);const response=await this.fetcher(url,{method:'GET',headers:this.signedHeaders('GET',url),redirect:'error'});if(!response.ok)throw storageFailure('STORAGE_VERSION_LIST','STORAGE',response.status);const xml=await response.text();for(const kind of ['Version','DeleteMarker'])for(const match of xml.matchAll(new RegExp(`<${kind}>([\\s\\S]*?)<\\/${kind}>`,'g'))){const foundKey=xmlText(match[1],'Key'),versionId=xmlText(match[1],'VersionId');if(foundKey===key&&versionId)items.push({key,versionId,deleteMarker:kind==='DeleteMarker'});}if(xmlText(xml,'IsTruncated')!=='true')return items;keyMarker=xmlText(xml,'NextKeyMarker');versionMarker=xmlText(xml,'NextVersionIdMarker');if(!keyMarker)throw storageFailure('STORAGE_VERSION_PAGINATION','STORAGE');}throw storageFailure('STORAGE_VERSION_PAGE_LIMIT','STORAGE');}
  async deleteVersion(storageRef,versionId){const url=this.objectUrl(this.parseRef(storageRef));url.searchParams.set('versionId',versionId);const response=await this.fetcher(url,{method:'DELETE',headers:this.signedHeaders('DELETE',url),redirect:'error'});if(!response.ok&&response.status!==404)throw storageFailure([403,409,423].includes(response.status)?'STORAGE_RETENTION':'STORAGE_VERSION_DELETE','STORAGE',response.status);}
  async purgeAllVersions(storageRef){const versions=await this.listVersions(storageRef),failures=[];for(const item of versions)try{await this.deleteVersion(storageRef,item.versionId);}catch(error){failures.push(error);}const retained=await this.listVersions(storageRef);if(retained.length||failures.length){if(failures.some(error=>error.code==='STORAGE_RETENTION'))throw storageFailure('STORAGE_RETENTION','RETENTION',failures.find(error=>error.status)?.status);throw storageFailure('STORAGE_PARTIAL_DELETE','STORAGE');}return {deletedVersions:versions.length,verifiedEmpty:true};}
  async deleteReservation(storageRef){const url=this.objectUrl(this.parseRef(storageRef));const response=await this.fetcher(url,{method:'DELETE',headers:this.signedHeaders('DELETE',url),redirect:'error'});if(!response.ok&&response.status!==404)throw storageFailure([403,409,423].includes(response.status)?'STORAGE_RETENTION':'STORAGE_RESERVATION_DELETE','STORAGE',response.status);}
}

const WBS_EVIDENCE_ARTIFACTS=Object.freeze({
  'receipt.json':'application/json',
  'request.raw':'application/octet-stream',
  'response.raw':'application/octet-stream',
  'package.json':'application/json'
});
const EVIDENCE_HASH=/^sha256:[0-9a-f]{64}$/;
const EVIDENCE_DOMAIN=/^(PAYABLES|INSURANCE)$/;

// Server-side immutable evidence storage. Unlike attachment reservations this
// never returns a browser upload URL: the already verified exact bytes are PUT
// with S3 versioning and Object Lock COMPLIANCE metadata in one server call.
export class S3ImmutableEvidenceStorage extends S3AttachmentStorage{
  constructor({retentionDays,...options}={}){
    super({...options,prefix:options.prefix||'refs-wbs-final1',requireVersionId:true});
    if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw new Error('WBS evidence retention days must be between 1 and 3650');
    this.retentionDays=retentionDays;
  }
  signedPayloadHeaders(method,url,body,additionalHeaders={}){
    const payloadHash=sha256(body),now=this.clock(),amzDate=timestamp(now),date=dateStamp(now),scope=`${date}/${this.region}/s3/aws4_request`;
    const headers=Object.fromEntries(Object.entries({...additionalHeaders,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash,...(this.sessionToken?{'x-amz-security-token':this.sessionToken}:{})}).map(([name,value])=>[name.toLowerCase(),String(value).trim().replace(/\s+/g,' ')]));
    const values={host:url.host,...headers},names=Object.keys(values).sort(),canonicalHeaders=names.map(name=>`${name}:${values[name]}\n`).join('');
    const canonical=`${method}\n${url.pathname}\n${canonicalQuery(url.searchParams)}\n${canonicalHeaders}\n${names.join(';')}\n${payloadHash}`;
    const signature=hmac(this.deriveKey(date),`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`,'hex');
    return {...headers,authorization:`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`};
  }
  evidenceKey({tenantId,entityId,admissionId,immutableVersion,domain,artifact,contentHash}){
    if(!EVIDENCE_DOMAIN.test(domain||'')||!Object.hasOwn(WBS_EVIDENCE_ARTIFACTS,artifact)||!EVIDENCE_HASH.test(contentHash||''))throw new Error('WBS evidence identity is invalid');
    return `${this.prefix}/${safeSegment(tenantId)}/${safeSegment(entityId)}/${safeSegment(domain)}/${safeSegment(admissionId)}/${safeSegment(immutableVersion)}/${safeSegment(artifact)}-${contentHash.slice(7)}`;
  }
  async inspectImmutableVersion(storageRef,storageVersion,{contentHash,sizeBytes,mediaType}={}){
    const url=this.objectUrl(this.parseRef(storageRef));url.searchParams.set('versionId',storageVersion);
    const response=await this.fetcher(url,{method:'HEAD',headers:this.signedHeaders('HEAD',url),redirect:'error'});
    if(!response.ok)throw storageFailure('WBS_EVIDENCE_STORAGE_HEAD_FAILED','STORAGE',response.status);
    const observedVersion=response.headers.get('x-amz-version-id'),observedHash=response.headers.get('x-amz-meta-sha256'),observedSize=Number(response.headers.get('content-length')),observedType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),retentionMode=response.headers.get('x-amz-object-lock-mode'),retainUntil=response.headers.get('x-amz-object-lock-retain-until-date');
    if(observedVersion!==storageVersion||observedHash!==contentHash||observedSize!==sizeBytes||observedType!==mediaType||retentionMode!=='COMPLIANCE'||!retainUntil||Date.parse(retainUntil)<=this.clock().getTime())throw storageFailure('WBS_EVIDENCE_STORAGE_METADATA_INVALID','STORAGE');
    return {storageVersion:observedVersion,contentHash:observedHash,sizeBytes:observedSize,mediaType:observedType,retentionMode,retainUntil};
  }
  async putImmutableVersion({tenantId,entityId,admissionId,immutableVersion,domain,artifact,bytes,expectedHash,receiptHash,retentionUntil=null}={}){
    const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]),contentHash=`sha256:${sha256(body)}`;
    if(body.length<1||body.length>32*1024*1024||contentHash!==expectedHash||!EVIDENCE_HASH.test(receiptHash||''))throw new Error('WBS evidence bytes or hash are invalid');
    const key=this.evidenceKey({tenantId,entityId,admissionId,immutableVersion,domain,artifact,contentHash}),storageRef=this.storageRef(key),url=this.objectUrl(key),mediaType=WBS_EVIDENCE_ARTIFACTS[artifact];
    const maximumRetention=this.clock().getTime()+this.retentionDays*86400000,requestedRetention=retentionUntil==null?maximumRetention:Date.parse(retentionUntil);
    if(!Number.isFinite(requestedRetention)||requestedRetention<=this.clock().getTime()||requestedRetention>maximumRetention+1000)throw new Error('WBS evidence retention timestamp is invalid');
    const retainUntil=new Date(requestedRetention).toISOString();
    const headers={
      'content-type':mediaType,'content-length':String(body.length),'content-md5':createHash('md5').update(body).digest('base64'),
      'x-amz-meta-sha256':contentHash,'x-amz-meta-tenant-id':tenantId,'x-amz-meta-entity-id':entityId,
      'x-amz-meta-immutable-version':immutableVersion,'x-amz-meta-domain':domain,'x-amz-meta-artifact':artifact,
      'x-amz-meta-receipt-hash':receiptHash,'x-amz-meta-schema-version':'WBS_FINAL1_RETAINED_RAW_V1',
      'x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':retainUntil,'if-none-match':'*'
    };
    const response=await this.fetcher(url,{method:'PUT',headers:this.signedPayloadHeaders('PUT',url,body,headers),body,redirect:'error'});
    if(response.status===412){
      const observed=await this.inspect(storageRef);
      if(observed.contentHash!==contentHash||observed.sizeBytes!==body.length||observed.mediaType!==mediaType)throw storageFailure('WBS_EVIDENCE_REPLAY_CONFLICT','STORAGE',412);
      const locked=await this.inspectImmutableVersion(storageRef,observed.storageVersion,{contentHash,sizeBytes:body.length,mediaType});
      return {artifact,storageRef,...locked,idempotent:true};
    }
    if(!response.ok)throw storageFailure('WBS_EVIDENCE_STORAGE_WRITE_FAILED','STORAGE',response.status);
    const storageVersion=response.headers.get('x-amz-version-id'),etag=response.headers.get('etag')?.replaceAll('"','')||null;
    if(!storageVersion)throw storageFailure('WBS_EVIDENCE_STORAGE_VERSION_MISSING','STORAGE');
    const locked=await this.inspectImmutableVersion(storageRef,storageVersion,{contentHash,sizeBytes:body.length,mediaType});
    return {artifact,storageRef,...locked,etag,idempotent:false};
  }
  async putOrphanLifecycleMarker({tenantId,entityId,admissionId,immutableVersion,domain,receiptHash,retentionUntil,failureStage,reasonCode,artifacts}={}){
    if(!EVIDENCE_DOMAIN.test(domain||'')||!EVIDENCE_HASH.test(receiptHash||'')||!['STORAGE_OR_SCAN','DATABASE_COMPLETION'].includes(failureStage)||!/^[A-Z][A-Z0-9_]{2,127}$/.test(reasonCode||'')||!artifacts||typeof artifacts!=='object'||Array.isArray(artifacts)||Object.keys(artifacts).length<1||Object.keys(artifacts).length>4)throw new Error('WBS orphan lifecycle marker identity is invalid');
    const body=Buffer.from(JSON.stringify({schema_version:'WBS_FINAL1_ORPHAN_RETAINED_V1',tenant_id:tenantId,entity_id:entityId,admission_id:admissionId,immutable_version:immutableVersion,domain,failure_stage:failureStage,reason_code:reasonCode,artifacts})),contentHash=`sha256:${sha256(body)}`,requiredRetention=Date.parse(retentionUntil);
    if(!Number.isFinite(requiredRetention)||requiredRetention<=this.clock().getTime())throw new Error('WBS orphan lifecycle marker retention is invalid');
    const markerId=contentHash.slice(7),key=`${this.prefix}/${safeSegment(tenantId)}/${safeSegment(entityId)}/${safeSegment(domain)}/${safeSegment(admissionId)}/${safeSegment(immutableVersion)}/_ops/orphan-${safeSegment(failureStage)}-${markerId}.json`,storageRef=this.storageRef(key),url=this.objectUrl(key),retainUntil=new Date(requiredRetention).toISOString(),headers={'content-type':'application/json','content-length':String(body.length),'content-md5':createHash('md5').update(body).digest('base64'),'x-amz-meta-sha256':contentHash,'x-amz-meta-tenant-id':tenantId,'x-amz-meta-entity-id':entityId,'x-amz-meta-admission-id':admissionId,'x-amz-meta-immutable-version':immutableVersion,'x-amz-meta-domain':domain,'x-amz-meta-receipt-hash':receiptHash,'x-amz-meta-failure-stage':failureStage,'x-amz-meta-reason-code':reasonCode,'x-amz-meta-schema-version':'WBS_FINAL1_ORPHAN_RETAINED_V1','x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':retainUntil,'if-none-match':'*'};
    const put=await this.fetcher(url,{method:'PUT',headers:this.signedPayloadHeaders('PUT',url,body,headers),body,redirect:'error'});
    let storageVersion=put.headers.get('x-amz-version-id'),idempotent=false;if(put.status===412){const observed=await this.inspect(storageRef);storageVersion=observed.storageVersion;idempotent=true;}else if(!put.ok)throw storageFailure('WBS_ORPHAN_MARKER_WRITE_FAILED','STORAGE',put.status);
    if(!storageVersion)throw storageFailure('WBS_ORPHAN_MARKER_VERSION_MISSING','STORAGE');
    const headUrl=this.objectUrl(key);headUrl.searchParams.set('versionId',storageVersion);const head=await this.fetcher(headUrl,{method:'HEAD',headers:this.signedHeaders('HEAD',headUrl),redirect:'error'});
    const expected={'x-amz-version-id':storageVersion,'x-amz-meta-sha256':contentHash,'content-length':String(body.length),'content-type':'application/json','x-amz-meta-tenant-id':tenantId,'x-amz-meta-entity-id':entityId,'x-amz-meta-admission-id':admissionId,'x-amz-meta-immutable-version':immutableVersion,'x-amz-meta-domain':domain,'x-amz-meta-receipt-hash':receiptHash,'x-amz-meta-failure-stage':failureStage,'x-amz-meta-reason-code':reasonCode,'x-amz-meta-schema-version':'WBS_FINAL1_ORPHAN_RETAINED_V1','x-amz-object-lock-mode':'COMPLIANCE'};
    const observedRetention=Date.parse(head.headers.get('x-amz-object-lock-retain-until-date'));
    if(!head.ok||Object.entries(expected).some(([name,value])=>head.headers.get(name)?.split(';')[0]!==value)||!Number.isFinite(observedRetention)||observedRetention<requiredRetention)throw storageFailure('WBS_ORPHAN_MARKER_METADATA_INVALID','STORAGE');
    return Object.freeze({status:'WBS_FINAL1_ORPHAN_MARKER_RETAINED',storageRef,storageVersion,contentHash,retainUntil:head.headers.get('x-amz-object-lock-retain-until-date'),idempotent});
  }
  async readVerifiedVersion({storageRef,storageVersion,expectedHash,maxBytes=32*1024*1024}={}){
    if(typeof storageVersion!=='string'||!storageVersion||!EVIDENCE_HASH.test(expectedHash||'')||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Exact WBS evidence read identity is required');
    const url=this.objectUrl(this.parseRef(storageRef));url.searchParams.set('versionId',storageVersion);
    const response=await this.fetcher(url,{method:'GET',headers:this.signedHeaders('GET',url),redirect:'error'});
    if(!response.ok)throw storageFailure('WBS_EVIDENCE_STORAGE_READ_FAILED','STORAGE',response.status);
    if(response.headers.get('x-amz-version-id')!==storageVersion||response.headers.get('x-amz-meta-sha256')!==expectedHash||!response.body)throw storageFailure('WBS_EVIDENCE_STORAGE_METADATA_INVALID','STORAGE');
    const declared=Number(response.headers.get('content-length'));if(!Number.isSafeInteger(declared)||declared<1||declared>maxBytes)throw storageFailure('WBS_EVIDENCE_STORAGE_SIZE_INVALID','STORAGE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.byteLength;if(size>maxBytes)throw storageFailure('WBS_EVIDENCE_STORAGE_SIZE_INVALID','STORAGE');chunks.push(Buffer.from(chunk));}
    const body=Buffer.concat(chunks);if(body.length!==declared||`sha256:${sha256(body)}`!==expectedHash)throw storageFailure('WBS_EVIDENCE_STORAGE_HASH_MISMATCH','STORAGE');
    return new Uint8Array(body);
  }
  async probeImmutable(){
    const versioning=this.bucketUrl();versioning.searchParams.set('versioning','');
    const versioningResponse=await this.fetcher(versioning,{method:'GET',headers:this.signedHeaders('GET',versioning),redirect:'error'});
    if(!versioningResponse.ok||!/<Status>Enabled<\/Status>/.test(await versioningResponse.text()))throw storageFailure('WBS_EVIDENCE_VERSIONING_REQUIRED','STORAGE',versioningResponse.status);
    const lock=this.bucketUrl();lock.searchParams.set('object-lock','');
    const lockResponse=await this.fetcher(lock,{method:'GET',headers:this.signedHeaders('GET',lock),redirect:'error'});
    if(!lockResponse.ok||!/<ObjectLockEnabled>Enabled<\/ObjectLockEnabled>/.test(await lockResponse.text()))throw storageFailure('WBS_EVIDENCE_OBJECT_LOCK_REQUIRED','STORAGE',lockResponse.status);
    return true;
  }
}

export class HttpVirusScanner{
  constructor({endpoint,bearerToken,fetcher=null,ca=null,serverName=null,timeoutMs=30000,maxAttempts=3,retryBaseMs=100,sleeper=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){let url;try{url=new URL(endpoint);}catch{throw new Error('Scanner endpoint must be a valid URL');}if(url.protocol!=='https:'||!bearerToken||(!fetcher&&!ca)||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw new Error('Scanner requires HTTPS endpoint, credential, trusted CA, and safe retry policy');if(ca&&!serverName)throw new Error('Scanner serverName is required with a private CA');this.endpoint=url;this.bearerToken=bearerToken;this.fetcher=fetcher||(async(url,init)=>tlsJsonFetch(url,init,{ca,serverName}));this.timeoutMs=timeoutMs;this.maxAttempts=maxAttempts;this.retryBaseMs=retryBaseMs;this.sleeper=sleeper;}
  async probe(){const url=new URL(this.endpoint);url.pathname='/health';url.search='';const response=await this.fetcher(url,{method:'GET',redirect:'error',headers:{accept:'application/json'}});if(!response.ok)throw Object.assign(new Error('Scanner readiness failed'),{code:'SCANNER_READINESS_FAILED',status:response.status});const body=await response.json();if(body?.ok!==true)throw Object.assign(new Error('Scanner readiness response is invalid'),{code:'SCANNER_READINESS_INVALID'});return true;}
  async scan(evidence){const attachment=typeof evidence?.attachmentId==='string'&&evidence.attachmentId.length>0,final1=typeof evidence?.admissionId==='string'&&evidence.admissionId.length>0&&typeof evidence?.artifact==='string'&&['receipt.json','request.raw','response.raw','package.json'].includes(evidence.artifact);if(!evidence?.tenantId||!evidence?.entityId||attachment===final1||!evidence?.storageRef||!evidence?.storageVersion||String(evidence.storageVersion).startsWith('pending:')||!Number.isSafeInteger(evidence.sizeBytes)||!evidence.contentHash||!evidence.mediaType)throw new Error('Scanner requires one exact attachment or Final-1 identity, evidence metadata, and finalized object version');let last;for(let attempt=1;attempt<=this.maxAttempts;attempt++){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Object.assign(new Error('Scanner request timeout'),{code:'SCANNER_TIMEOUT',retryable:true})),this.timeoutMs);try{const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${this.bearerToken}`,'content-type':'application/json','accept':'application/json'},body:JSON.stringify({tenant_id:evidence.tenantId,entity_id:evidence.entityId,...(attachment?{attachment_id:evidence.attachmentId}:{admission_id:evidence.admissionId,artifact:evidence.artifact}),storage_ref:evidence.storageRef,storage_version:evidence.storageVersion,size_bytes:evidence.sizeBytes,content_hash:evidence.contentHash,media_type:evidence.mediaType})});if(!response.ok)throw Object.assign(new Error(`Scanner failed with ${response.status}`),{status:response.status,retryable:response.status>=500||response.status===429});const result=await response.json();if(typeof result.clean!=='boolean'||typeof result.scan_ref!=='string'||!result.scan_ref)throw Object.assign(new Error('Scanner response is invalid'),{code:'SCANNER_RESPONSE_INVALID',retryable:false});return {clean:result.clean,scanRef:result.scan_ref};}catch(error){last=error;const retryable=error?.retryable===true||(error?.status>=500||error?.status===429);if(attempt>=this.maxAttempts||!retryable)throw error;await this.sleeper(this.retryBaseMs*2**(attempt-1));}finally{clearTimeout(timer);}}throw last;}
}

export class AttachmentEvidenceService{
  constructor({storage,scanner,uploaderKernelFactory,scannerKernelFactory}={}){if(!storage||!scanner||typeof uploaderKernelFactory!=='function'||typeof scannerKernelFactory!=='function')throw new Error('Attachment service dependencies are required');this.storage=storage;this.scanner=scanner;this.uploaderKernelFactory=uploaderKernelFactory;this.scannerKernelFactory=scannerKernelFactory;}
  async reserve(principal,args){
    const kernel=await this.uploaderKernelFactory(principal);
    if(typeof kernel.findAttachmentReservation!=='function')throw storageFailure('ATTACHMENT_RESERVATION_LOOKUP_UNAVAILABLE','STATE');
    const existing=await kernel.findAttachmentReservation(args);
    if(existing){
      const receipt={attachment_id:existing.attachment_id,entity_id:existing.entity_id,status:existing.status,name:existing.name,media_type:existing.media_type,size_bytes:existing.size_bytes,content_hash:existing.content_hash,idempotent:true};
      if(existing.status==='VERIFIED_CLEAN')return receipt;
      if(existing.status!=='PENDING'||existing.cleanup_status!=='NONE')throw storageFailure('ATTACHMENT_RESERVATION_CLOSED','STATE');
      const upload=await this.storage.resumeUpload({tenantId:args.tenantId,entityId:args.entityId,storageRef:existing.storage_ref,mediaType:existing.media_type,contentHash:existing.content_hash,uploadExpiresAt:existing.upload_expires_at});
      return {...receipt,upload_url:upload.uploadUrl,required_headers:upload.requiredHeaders,upload_expires_at:upload.expiresAt};
    }
    const reservation=await this.storage.reserveUpload(args);
    const record=await kernel.reserveAttachment({...args,storageRef:reservation.storageRef,storageVersion:reservation.storageVersion});
    // Presigning does not create an object. A failed retry must never delete
    // evidence uploaded after an earlier successful use of the same key.
    return {...record,upload_url:reservation.uploadUrl,required_headers:reservation.requiredHeaders,upload_expires_at:reservation.expiresAt};
  }
  async reserveWbsPayable(principal,args){const reservation=await this.storage.reserveUpload(args);try{const kernel=await this.uploaderKernelFactory(principal);const record=await kernel.reserveWbsPayableAttachment({...args,storageRef:reservation.storageRef,storageVersion:reservation.storageVersion});return {...record,upload_url:reservation.uploadUrl,required_headers:reservation.requiredHeaders,upload_expires_at:reservation.expiresAt};}catch(error){
    // A row-bound retry intentionally resolves to the same object key. Reserve
    // only creates a presigned contract; deleting here could erase a valid
    // object from an earlier successful replay when a later cross-row or
    // changed-payload attempt is correctly rejected by PostgreSQL.
    throw error;
  }}
  async finalize(principal,args){const uploaderKernel=await this.uploaderKernelFactory(principal);const record=await uploaderKernel.requestAttachmentFinalize(args);if(record.finalization_status!=='PENDING')return {attachment_id:record.attachment_id,entity_id:record.entity_id,status:record.finalization_status,idempotent:true};const observed=await this.storage.inspect(record.storage_ref);const scan=await this.scanner.scan({tenantId:record.tenant_id||args.tenantId,entityId:record.entity_id||args.entityId,attachmentId:record.attachment_id||args.attachmentId,storageRef:record.storage_ref,storageVersion:observed.storageVersion,sizeBytes:observed.sizeBytes,contentHash:observed.contentHash,mediaType:observed.mediaType});const kernel=await this.scannerKernelFactory(principal);return kernel.finalizeAttachment({...args,storageRef:record.storage_ref,observedSizeBytes:observed.sizeBytes,observedContentHash:observed.contentHash,observedMediaType:observed.mediaType,storageVersion:observed.storageVersion,scanClean:scan.clean,scanRef:scan.scanRef});}
}

export class AttachmentCleanupService{
  constructor({storage,kernelFactory}={}){if(!storage||typeof kernelFactory!=='function')throw new Error('Attachment cleanup dependencies are required');this.storage=storage;this.kernelFactory=kernelFactory;}
  async runOnce(principal,{tenantId,entityId,limit=25}){const kernel=await this.kernelFactory(principal,{tenantId,entityId}),items=await kernel.claimExpiredAttachments({tenantId,entityId,limit}),results=[];for(const item of items){try{await this.storage.purgeAllVersions(item.storage_ref);results.push(await kernel.completeAttachmentCleanup({tenantId,entityId,attachmentId:item.attachment_id,claimToken:item.claim_token,deleted:true}));}catch(error){const safe=classifyCleanupFailure(error);results.push(await kernel.completeAttachmentCleanup({tenantId,entityId,attachmentId:item.attachment_id,claimToken:item.claim_token,deleted:false,...safe}));}}return results;}
}
