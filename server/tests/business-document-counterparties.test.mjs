import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validBusinessDocumentCounterpartyPage} from '../runtime/business-document-counterparties.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const path=`/api/v1/entities/${entityId}/business-documents/draft-counterparties`;
const page=selection=>({schema_version:'BUSINESS_DOCUMENT_COUNTERPARTIES_V1',entity_id:entityId,document_kind:selection.documentKind,query:selection.query,after_ref:selection.afterRef,limit:selection.limit,rows:[],next_ref:null});

test('counterparty GET derives tenant from authentication, preserves search/cursor and rejects command inputs',async()=>{
  const calls=[],api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({readBusinessDocumentCounterparties:async args=>(calls.push(args),page(args))})});
  const selection={documentKind:'AP_BILL',query:'50%_',afterRef:'V-01',limit:25};
  const response=await api({method:'GET',url:`${path}?kind=AP_BILL&query=50%25_&afterRef=V-01&limit=25`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls,[{tenantId,entityId,...selection}]);assert.deepEqual(response.body,{ok:true,data:page(selection)});
  for(const suffix of ['','?kind=AP_BILL&kind=AR_INVOICE','?kind=UNKNOWN','?kind=AP_BILL&limit=0','?kind=AP_BILL&limit=101','?kind=AP_BILL&limit=1e1','?kind=AP_BILL&limit=01','?kind=AP_BILL&query=%20vendor','?kind=AP_BILL&query=%0A','?kind=AP_BILL&afterRef=','?kind=AP_BILL&tenantId=spoof','?kind=AP_BILL&query='+ 'a'.repeat(129)]){
    assert.equal((await api({method:'GET',url:path+suffix,body:null,headers:{}})).status,400,suffix);
  }
  for(const request of [{body:{}},{headers:{'idempotency-key':'unexpected-key'}},{headers:{'if-match':'"0"'}}]){
    assert.equal((await api({method:'GET',url:path+'?kind=AP_BILL',body:null,headers:{},...request})).status,400);
  }
  assert.equal(calls.length,1,'invalid requests must not reach the kernel');
  assert.equal((await api({method:'GET',url:path+'?kind=AR_INVOICE',body:null,headers:{}})).status,200);
  assert.equal(calls.at(-1).documentKind,'AR_INVOICE');
});

test('counterparty reads fail closed for missing implementations and contradictory returned scopes',async()=>{
  const scope={entityId,documentKind:'AP_BILL',query:'',afterRef:null,limit:1};
  const row={member_ref:'V-1',member_type:'VENDOR',display_name:'Vendor'};
  const good={...page(scope),rows:[row],next_ref:'V-1'};
  assert.equal(validBusinessDocumentCounterpartyPage(good,scope),true);
  for(const bad of [{...good,entity_id:tenantId},{...good,document_kind:'AR_INVOICE'},
    {...good,query:'changed'},{...good,after_ref:'V-0'},{...good,limit:2},
    {...good,next_ref:'V-2'},{...good,rows:[]},{...good,can_create_draft:true},
    {...good,rows:[{...row,member_type:'CUSTOMER'}]},{...good,rows:[row,row]}]){
    const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({readBusinessDocumentCounterparties:async()=>bad})});
    assert.equal((await api({method:'GET',url:path+'?kind=AP_BILL&limit=1',body:null,headers:{}})).status,500);
  }
  const cursorScope={...scope,afterRef:'V-1'};
  assert.equal(validBusinessDocumentCounterpartyPage({...good,after_ref:'V-1'},cursorScope),false,'cursor must advance');
  const absent=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({})});
  assert.equal((await absent({method:'GET',url:path+'?kind=AP_BILL',body:null,headers:{}})).status,503);
});

test('counterparty reader OpenAPI specifies maker permissions, bounded keyset pages and no mutation',async()=>{
  const doc=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const route=doc.paths['/entities/{entityId}/business-documents/draft-counterparties'];
  assert.deepEqual(Object.keys(route),['get']);
  assert.equal(route.get.operationId,'readBusinessDocumentCounterparties');
  assert.match(route.get.description,/AP\.BILL\.CREATE/);assert.match(route.get.description,/AR\.INVOICE\.CREATE/);
  assert.equal(route.get.parameters.find(item=>item.name==='limit').schema.maximum,100);
  assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const,'no-store');
});
