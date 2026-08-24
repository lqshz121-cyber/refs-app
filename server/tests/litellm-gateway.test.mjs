import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiteLlmGateway,LiteLlmGatewayError,redactAiFacts} from '../runtime/litellm-gateway.mjs';

test('LiteLLM gateway redacts secrets and emits a server-only structured request',async()=>{
  let request;const clock=(()=>{let value=100;return ()=>value+=5;})();const gateway=createLiteLlmGateway({baseUrl:'https://igateway.wbm3.com',apiKey:'sk-virtual-key-12345',model:'gpt-4.1-mini',clock,fetcher:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({id:'chatcmpl-trace-1',choices:[{message:{content:'{"risk_level":"HIGH","reason":"Review retained source evidence."}'}}]})};}});
  const output=await gateway.analyzeJson({traceId:'refs-test-trace',traceName:'ai-audit-explanation',actorId:'oidc|controller',facts:{entity_id:'entity-1',amount:'100.00',memo:'Authorization: Bearer hidden-value-123456',api_key:'do-not-send',nested:{authorization:'secret'}},systemInstruction:'Explain only the retained facts. Never create, approve, or post accounting entries.',jsonSchema:{name:'accounting_analysis',schema:{type:'object',additionalProperties:false,properties:{risk_level:{type:'string'},reason:{type:'string'}},required:['risk_level','reason']}}});
  assert.equal(request.url,'https://igateway.wbm3.com/v1/chat/completions');assert.equal(request.options.headers.authorization,'Bearer sk-virtual-key-12345');const body=JSON.parse(request.options.body),sentFacts=JSON.parse(body.messages[1].content).facts;assert.equal(body.temperature,0);assert.equal(body.metadata.trace_id,'refs-test-trace');assert.equal(sentFacts.api_key,'[REDACTED]');assert.equal(sentFacts.nested.authorization,'[REDACTED]');assert.equal(sentFacts.memo,'[REDACTED]');assert.equal(output.providerRequestId,'chatcmpl-trace-1');assert.deepEqual(output.result,{risk_level:'HIGH',reason:'Review retained source evidence.'});assert.equal(output.model,'gpt-4.1-mini');assert.equal(output.elapsedMs,5);
});

test('LiteLLM gateway fails closed for unsafe config, unstructured responses, and invalid facts',async()=>{
  assert.throws(()=>createLiteLlmGateway({baseUrl:'http://gateway.example',apiKey:'sk-virtual-key-12345'}),LiteLlmGatewayError);assert.equal(redactAiFacts({token:'x'}).token,'[REDACTED]');
  const gateway=createLiteLlmGateway({baseUrl:'https://gateway.example/v1',apiKey:'sk-virtual-key-12345',fetcher:async()=>({ok:true,json:async()=>({id:'x',choices:[{message:{content:'not json'}}]})})});
  await assert.rejects(()=>gateway.analyzeJson({actorId:'actor',facts:{source:'retained'},systemInstruction:'Explain only.',jsonSchema:{name:'answer',schema:{type:'object'}}}),error=>error.code==='LITELLM_PROTOCOL_INVALID');
  await assert.rejects(()=>gateway.analyzeJson({actorId:'actor',facts:{rows:Array(101).fill(1)},systemInstruction:'Explain only.',jsonSchema:{name:'answer',schema:{type:'object'}}}),error=>error.code==='AI_FACTS_ARRAY_LIMIT');
});

test('LiteLLM gateway rejects an oversized serialized prompt before network',async()=>{
  let calls=0;const gateway=createLiteLlmGateway({baseUrl:'https://gateway.example',apiKey:'virtual-key-123456',fetcher:async()=>{calls++;}}),facts=Object.fromEntries(Array.from({length:90},(_,index)=>[`field_${index}`,'x'.repeat(12000)]));
  await assert.rejects(()=>gateway.analyzeJson({actorId:'actor',facts,systemInstruction:'Explain only retained facts.',jsonSchema:{name:'answer',schema:{type:'object'}}}),error=>error.code==='AI_FACTS_SIZE_LIMIT');assert.equal(calls,0);
});

test('LiteLLM gateway rejects credential-bearing trace, actor, or instruction metadata before network',async()=>{
  const base={traceId:'trace',traceName:'analysis',actorId:'actor',facts:{source:'retained'},systemInstruction:'Explain retained facts.',jsonSchema:{name:'answer',schema:{type:'object'}}};let calls=0;const gateway=createLiteLlmGateway({baseUrl:'https://gateway.example',apiKey:'virtual-key-123456',fetcher:async()=>{calls++;}});
  for(const change of [{traceId:'token=secret-value-123456'},{actorId:'Authorization: Bearer secret-value-123456'},{systemInstruction:'Use sk-secretvalue123456'}])await assert.rejects(()=>gateway.analyzeJson({...base,...change}),error=>error.code==='AI_ANALYSIS_METADATA_INVALID');assert.equal(calls,0);
});
