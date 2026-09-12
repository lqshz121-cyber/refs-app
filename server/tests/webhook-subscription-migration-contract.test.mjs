import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
const up=await readFile(new URL('../db/migrations/387_webhook_subscription_authoritative.sql',import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/387_webhook_subscription_authoritative.sql',import.meta.url),'utf8');
test('387 retains tenant-scoped webhook configuration and read-only delivery history without credentials',()=>{
 const entry=MIGRATION_MANIFEST.find(item=>item.name==='387_webhook_subscription_authoritative.sql');
 if(entry)assert.deepEqual(entry,{name:'387_webhook_subscription_authoritative.sql',up:createHash('sha256').update(up.replace(/\r\n/g,'\n')).digest('hex'),down:createHash('sha256').update(down.replace(/\r\n/g,'\n')).digest('hex')});
 for(const token of ['webhook_subscription','webhook_subscription_history','webhook_delivery_history','ENABLE ROW LEVEL SECURITY','refs_assert_scope','idempotency_receipt','audit_event','outbox_event','signing_key_reference','signing_key_fingerprint','PENDING_APPROVAL','SUSPENDED','localhost','internal','reject_mutation','Refusing to remove retained webhook subscription or delivery evidence'])assert.match(up+'\n'+down,new RegExp(token));
 assert.doesNotMatch(up,/http_request|dblink|pg_net|curl|http_post/i);
 assert.match(up,/refs_webhook_subscription_payload/);assert.doesNotMatch(up.match(/refs_webhook_subscription_payload[\s\S]{0,2500}/)?.[0]||'',/signing_key_reference/);
});
