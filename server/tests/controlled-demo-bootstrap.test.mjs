import test from 'node:test';
import assert from 'node:assert/strict';
import {controlledDemoProvisionConfig,provisionControlledDemoTenant} from '../runtime/controlled-demo-bootstrap.mjs';

test('synthetic DEMO provisioning is permanently prohibited',async()=>{
  for(const mode of ['DISABLED','ENABLED','AUTO','']){
    assert.throws(()=>controlledDemoProvisionConfig({REFS_CONTROLLED_DEMO_MODE:mode}),error=>error.code==='CONTROLLED_DEMO_PROVISIONING_PROHIBITED');
    await assert.rejects(()=>provisionControlledDemoTenant({REFS_CONTROLLED_DEMO_MODE:mode}),error=>error.code==='CONTROLLED_DEMO_PROVISIONING_PROHIBITED');
  }
});
