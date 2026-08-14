import {KernelError} from './db.mjs';

/*
 * This module deliberately remains as a fail-closed compatibility boundary.
 * Historical controlled-demo migrations are immutable audit history, but the
 * authoritative product must never create synthetic accounting tenants.
 */
export function controlledDemoProvisionConfig(){
  throw new KernelError('CONTROLLED_DEMO_PROVISIONING_PROHIBITED','Controlled DEMO provisioning is prohibited in the authoritative product');
}

export async function provisionControlledDemoTenant(){
  throw new KernelError('CONTROLLED_DEMO_PROVISIONING_PROHIBITED','Controlled DEMO provisioning is prohibited in the authoritative product');
}
