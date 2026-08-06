// Paired intercompany unit transfer.
//
// Both journals are built from one amount in one call. If either side cannot be
// built, neither is returned, so a transfer can never leave a one-sided Due
// to/from behind. The two sides use the symmetric account pair - 125000 Due from
// Related Party on the transferring entity, 291000 Due to/from on the receiving
// entity - and each line names the other entity as its subsidiary member, so a
// consolidation nets 125000 + 291000 to zero.
//
// The receiving entity records the unit at the group's carrying cost, not at the
// transfer price. The difference is the transferring entity's gain, and it is
// pushed down as the equal and opposite entry on the same account, so no
// intercompany profit stays capitalised in inventory once the group is
// consolidated. On separate-company books this is the eliminating entry, and it
// is visible as such: both lines carry the pair id.
export const IC_DUE_FROM_ACCOUNT = '125000';
export const IC_DUE_TO_ACCOUNT = '291000';
export const UNIT_COST_ACCOUNT = '164400';
export const IC_TRANSFER_GAIN_ACCOUNT = '787001';

const round2 = n => Math.round(Number(n || 0) * 100) / 100;

export function buildUnitTransferPair({ from, to, unit, carrying, price, pairId } = {}) {
  if (!from || !to || from.entity_id == null || to.entity_id == null) {
    return { ok:false, code:'UT_ENTITY_REQUIRED', message:'A transferring entity and a receiving entity are both required.' };
  }
  if (Number(from.entity_id) === Number(to.entity_id)) {
    return { ok:false, code:'UT_SAME_ENTITY', message:'A unit cannot be transferred to the entity that already owns it.' };
  }
  if (!unit) return { ok:false, code:'UT_UNIT_REQUIRED', message:'Select the unit being transferred.' };
  const cost = round2(carrying);
  if (!(cost > 0)) return { ok:false, code:'UT_NO_CARRYING_COST', message:'The selected unit has no carrying cost to transfer.' };
  const consideration = round2(price == null || price === '' ? cost : price);
  if (!(consideration >= 0)) return { ok:false, code:'UT_PRICE_INVALID', message:'The transfer price cannot be negative.' };
  const gain = round2(consideration - cost);
  const pair = pairId || `UT-${Date.now().toString().slice(-6)}`;

  const outLines = [
    { account_code:IC_DUE_FROM_ACCOUNT, debit_amount:consideration, credit_amount:0, member:to.entity_name, description:'Due from_' + to.entity_name, unit_code:unit },
    { account_code:UNIT_COST_ACCOUNT, debit_amount:0, credit_amount:cost, unit_code:unit, description:`Carrying cost released on transfer [${pair}]` },
  ];
  const inLines = [
    { account_code:UNIT_COST_ACCOUNT, debit_amount:cost, credit_amount:0, unit_code:unit, description:`Unit recorded at group carrying cost [${pair}]` },
  ];
  if (gain > 0.005) {
    outLines.push({ account_code:IC_TRANSFER_GAIN_ACCOUNT, debit_amount:0, credit_amount:gain, unit_code:unit, description:`Gain on intercompany transfer [${pair}]` });
    inLines.push({ account_code:IC_TRANSFER_GAIN_ACCOUNT, debit_amount:gain, credit_amount:0, unit_code:unit, description:`Intercompany profit eliminated against group cost [${pair}]` });
  } else if (gain < -0.005) {
    outLines.push({ account_code:IC_TRANSFER_GAIN_ACCOUNT, debit_amount:-gain, credit_amount:0, unit_code:unit, description:`Loss on intercompany transfer [${pair}]` });
    inLines.push({ account_code:IC_TRANSFER_GAIN_ACCOUNT, debit_amount:0, credit_amount:-gain, unit_code:unit, description:`Intercompany loss eliminated against group cost [${pair}]` });
  }
  inLines.push({ account_code:IC_DUE_TO_ACCOUNT, debit_amount:0, credit_amount:consideration, member:from.entity_name, description:'Due to/from_' + from.entity_name, unit_code:unit });

  const totals = lines => lines.reduce((t,l) => ({
    debit: Math.round(t.debit*100 + Math.round((l.debit_amount||0)*100))/100,
    credit: Math.round(t.credit*100 + Math.round((l.credit_amount||0)*100))/100,
  }), {debit:0, credit:0});
  for (const [side, lines] of [['out', outLines], ['in', inLines]]) {
    const t = totals(lines);
    if (Math.abs(t.debit - t.credit) >= 0.005) {
      return { ok:false, code:'UT_PAIR_UNBALANCED', message:`The ${side} side of pair ${pair} does not balance: debit ${t.debit}, credit ${t.credit}.` };
    }
  }
  const dueFrom = outLines.find(l => l.account_code === IC_DUE_FROM_ACCOUNT).debit_amount;
  const dueTo = inLines.find(l => l.account_code === IC_DUE_TO_ACCOUNT).credit_amount;
  if (Math.abs(dueFrom - dueTo) >= 0.005) {
    return { ok:false, code:'UT_PAIR_NOT_MIRRORED', message:`Pair ${pair} would not eliminate: Due from ${dueFrom} against Due to ${dueTo}.` };
  }

  return {
    ok: true,
    pair_id: pair,
    carrying: cost,
    price: consideration,
    gain,
    out: {
      entity_id: from.entity_id, source_system:'INTERNAL', payee: to.entity_name, je_type:'AUTO',
      rule_code:'R-UT-OUT-01', ic_pair_id: pair,
      description: `Unit Transfer OUT ${unit} to ${to.entity_code} [${pair}]`, lines: outLines,
    },
    in: {
      entity_id: to.entity_id, source_system:'INTERNAL', payee: from.entity_name, je_type:'AUTO',
      rule_code:'R-UT-IN-01', ic_pair_id: pair,
      description: `Unit Transfer IN ${unit} from ${from.entity_code} at group carrying cost [${pair}]`, lines: inLines,
    },
  };
}
