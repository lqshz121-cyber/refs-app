import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createConnection} from 'node:net';
import {S3AttachmentStorage} from '../runtime/attachment-storage.mjs';

const endpoint=process.env.REFS_MINIO_ENDPOINT,clamavPort=Number(process.env.REFS_CLAMAV_PORT);
if(!endpoint||!clamavPort)throw new Error('Container attachment test environment is required');
const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function clam(command){return new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:clamavPort}),chunks=[];socket.setTimeout(30000);socket.on('connect',()=>command(socket));socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>resolve(Buffer.concat(chunks).toString().replaceAll('\0','').trim()));socket.on('timeout',()=>socket.destroy(new Error('ClamAV timeout')));socket.on('error',reject);});}
const ping=()=>clam(socket=>socket.end('zPING\0'));
const scan=bytes=>clam(socket=>{socket.write('zINSTREAM\0');const size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);socket.write(size);socket.write(bytes);socket.end(Buffer.alloc(4));});

test('real MinIO preserves immutable versions and production SigV4 metadata',async()=>{
  const storage=new S3AttachmentStorage({endpoint,bucket:'refs-evidence',region:'us-east-1',accessKeyId:process.env.MINIO_ROOT_USER,secretAccessKey:process.env.MINIO_ROOT_PASSWORD,allowInsecureLoopbackForTests:true});
  const first=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),firstHash=hash(first),reservation=await storage.reserveUpload({tenantId:'00000000-0000-4000-8000-000000000001',entityId:'00000000-0000-4000-8000-000000000002',mediaType:'application/pdf',contentHash:firstHash});
  let response=await fetch(reservation.uploadUrl,{method:'PUT',headers:reservation.requiredHeaders,body:first});assert.equal(response.ok,true);
  const observedV1=await storage.inspect(reservation.storageRef);assert.equal(observedV1.contentHash,firstHash);assert.ok(observedV1.storageVersion);
  const second=Buffer.from('refs changed attachment v2'),secondHash=hash(second),key=storage.parseRef(reservation.storageRef),secondUrl=storage.presignPut(key,{mediaType:'application/pdf',contentHash:secondHash});
  response=await fetch(secondUrl,{method:'PUT',headers:{'content-type':'application/pdf','x-amz-meta-sha256':secondHash},body:second});assert.equal(response.ok,true);
  const observedV2=await storage.inspect(reservation.storageRef);assert.notEqual(observedV2.storageVersion,observedV1.storageVersion);assert.equal(observedV2.contentHash,secondHash);
  const retained=await storage.inspect(reservation.storageRef,{versionId:observedV1.storageVersion});assert.equal(retained.storageVersion,observedV1.storageVersion);assert.equal(retained.contentHash,firstHash);
  assert.match(await scan(Buffer.from(await storage.readVersion(reservation.storageRef,observedV1.storageVersion))),/FOUND$/);
  assert.match(await scan(Buffer.from(await storage.readVersion(reservation.storageRef,observedV2.storageVersion))),/OK$/);
});

test('real ClamAV accepts clean bytes and detects the EICAR test signature',async()=>{
  assert.equal(await ping(),'PONG');assert.match(await scan(Buffer.from('ordinary accounting evidence')),/OK$/);
  const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');assert.match(await scan(eicar),/FOUND$/);
});
