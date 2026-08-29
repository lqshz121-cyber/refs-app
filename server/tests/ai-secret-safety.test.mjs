import test from 'node:test';
import assert from 'node:assert/strict';
import {containsAiSecret,redactAiSecretText,safeAiEvidenceTree} from '../runtime/ai-secret-safety.mjs';

test('shared AI secret safety rejects and redacts named, opaque, cloud, chat, and private-key credentials',()=>{
  const secrets=['Authorization: Bearer abcdefghijklmnop','token=sk-live-EXAMPLESECRET123','AKIAABCDEFGHIJKLMNOP','ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456','AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456789',['xoxb','1234567890','abcdefghijklmnop'].join('-'),'-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'];
  for(const value of secrets){assert.equal(containsAiSecret(value),true,value);assert.equal(safeAiEvidenceTree({memo:value}),false,value);assert.doesNotMatch(redactAiSecretText(value),/abc123|AKIA|ghp_|AIza|xoxb-|sk-live/i,value);}
  assert.equal(safeAiEvidenceTree({memo:'Controller review requires source evidence.'}),true);
});

test('redaction occurs before output truncation so a boundary-spanning credential cannot leak',async()=>{
  const {redactAiFacts}=await import('../runtime/litellm-gateway.mjs');
  const value=`${'x'.repeat(11970)} Authorization: Bearer abcdefghijklmnop`;
  const redacted=redactAiFacts({memo:value}).memo;
  assert.ok(redacted.length<=12012);assert.doesNotMatch(redacted,/abcdefghijklmnop/);assert.match(redacted,/\[REDACTED\]/);
});
