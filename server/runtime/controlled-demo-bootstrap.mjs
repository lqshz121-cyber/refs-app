import {KernelError} from './db.mjs';

// Historical controlled-demo records remain immutable audit history. The
// authoritative product must never create synthetic accounting tenants.
const prohibited=()=>{
  throw new KernelError('CONTROLLED_DEMO_PROVISIONING_PROHIBITED','Controlled DEMO provisioning is prohibited in the authoritative product');
};

export function controlledDemoProvisionConfig(){ return prohibited(); }
export async function provisionControlledDemoTenant(){ return prohibited(); }
