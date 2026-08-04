// NON_PRODUCTION_EXECUTABLE_SPEC: single-process policy harness; never a durable accounting database.
export const NON_PRODUCTION_EXECUTABLE_SPEC=true;

const copy = value => structuredClone(value);

export class MemoryJEDatabase {
  constructor({periods=[], jes=[]}={}) {
    this.state = {
      periods:new Map(periods.map(p=>[`${p.entity_id}|${p.period_code}`,copy(p)])),
      jes:new Map(jes.map(j=>[j.je_id,copy(j)])),
      receipts:new Map(),
      recurring:new Map(),
    };
  }

  readJE(id) { return copy(this.state.jes.get(id)); }
  listJEs() { return [...this.state.jes.values()].map(copy); }
  readPeriod(entityId, periodCode) { return copy(this.state.periods.get(`${entityId}|${periodCode}`)); }
  countJEs() { return this.state.jes.size; }

  transaction(work) {
    const next=copy(this.state);
    const result=work(next);
    if(result?.ok===true)this.state=next;
    return copy(result);
  }
}

export function activeSourceExists(state,{source_system,source_doc_id,exceptId}) {
  if(!source_system||!source_doc_id)return false;
  return [...state.jes.values()].some(j=>j.je_id!==exceptId&&j.source_system===source_system&&j.source_doc_id===source_doc_id&&!['REVERSED','VOID'].includes(j.posting_status));
}

export function idempotencyExists(state,key) {
  return key ? [...state.jes.values()].find(j=>j.idempotency_key===key&&!['REVERSED','VOID'].includes(j.posting_status)) : null;
}
