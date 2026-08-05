import assert from 'node:assert/strict';
import {nextAuthoritativeWorkflowAction} from '../src/authoritative-workflow.js';

assert.deepEqual(
  ['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED',''].map(nextAuthoritativeWorkflowAction),
  ['SUBMIT','REVIEW','APPROVE','POST',null,null],
);
assert.equal(nextAuthoritativeWorkflowAction('pending_approval'),'APPROVE');
console.log('authoritative-workflow: all assertions passed');
