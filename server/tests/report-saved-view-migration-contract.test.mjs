import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';
const up=await readFile(new URL('../db/migrations/386_report_saved_views_authoritative.sql',import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/386_report_saved_views_authoritative.sql',import.meta.url),'utf8');
test('saved report views retain tenant/entity evidence with owner-private and shared access, CAS, audit and keyset pagination',()=>{
 for(const token of ['report_saved_view','report_saved_view_history','ENABLE ROW LEVEL SECURITY','visibility=\'PRIVATE\' AND v.owner_actor_id IS DISTINCT FROM actor','visibility=\'ENTITY_SHARED\' OR owner_actor_id=actor','FOR UPDATE','idempotency_receipt','audit_event','outbox_event','(updated_at,report_saved_view_id)<','next_cursor','REPORT.SAVED_VIEW.SHARE','REPORT.SAVED_VIEW.UPDATE','REPORT.SAVED_VIEW.VIEW'])assert.ok(up.includes(token),token);
 for(const token of ['Refusing to remove retained saved report view evidence','LOCK TABLE','DROP TABLE report_saved_view_history','DROP TABLE report_saved_view'])assert.ok(down.includes(token),token);
});
