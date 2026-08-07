// Consolidation group model.
//
// Which entities roll up into which parent, and on what ownership basis. This
// is DATA, not inference. Nothing here reads an entity name, an entity code or
// an entity_type at runtime to decide where an entity belongs: every one of the
// 119 members is written out below with its group, its immediate parent, its
// ownership in basis points and its consolidation method. An entity that is not
// in this table is not in the group, and the consolidation says so rather than
// guessing.
//
// Why a table and not a rule. A rule that derives the group from entity_type
// cannot express the two things a consolidation actually turns on - who owns
// how much of what, and from when - and it silently re-scopes the group the
// moment somebody edits a type. The group is an accounting decision and it is
// recorded as one.
//
// STRUCTURE
//
//   WBG        Wan Bridge Group - consolidated (ultimate parent: entity 1)
//     +- WBG-LAND   Land companies                  (parent: entity 2  WBLD)
//     +- WBG-DEV    Development / project companies (parent: entity 3  WBDE)
//     +- WBG-VERT   Home building (vertical)        (parent: entity 4  WBHO)
//     +- WBG-CORP   Corporate                       (parent: entity 15 WBAI)
//     +- WBG-FUND   Investment funds                (parent: entity 32 FDF4)
//     +- WBG-SVC    Service companies               (parent: entity 33 WBPM)
//
// The six segment parents are themselves members of WBG and report to entity 1.
// Entity 1 is the ultimate parent and has no parent.
//
// OWNERSHIP AND METHOD
//
//   ownership_bp   integer basis points of the immediate parent's holding.
//                  10000 = 100.00%. Never a float, never a percentage string.
//   method         FULL      line-by-line consolidation, 100% of the member's
//                            balances enter the consolidated column and 100% of
//                            its intercompany balances eliminate.
//                  EQUITY    not consolidated line by line; carried at the
//                            investment account. Its intercompany balances with
//                            the group do NOT eliminate, because only one side
//                            of the pair is inside the reporting boundary.
//                  EXCLUDED  outside the boundary entirely.
//
// Every member here is FULL at 10000 bp. That is not a placeholder: the seeded
// books carry no non-controlling capital - every equity account in the ledger is
// a group contribution - so there is no minority interest to measure and 100%
// is the ownership the data actually supports. EQUITY and EXCLUDED are honoured
// by the engine and proved by the measurement script (excluding a member makes
// the consolidated intercompany residual non-zero), but no member uses them
// today. Non-controlling interest measurement is NOT implemented; see
// docs/CONSOLIDATION.md "Residual risk".

import { ENTITIES } from './data.js';

// The elimination ledger's own entity. It is deliberately NOT in ENTITIES:
// it has no bank account, no period master, no chart of accounts of its own and
// nothing may ever be posted to it by a user. It exists so that an elimination
// is a journal on a ledger rather than a subtraction in a report.
export const ELIMINATION_ENTITY = Object.freeze({
  entity_id: 900,
  entity_code: 'ELIM',
  entity_name: 'Consolidation Eliminations',
  entity_type: 'Elimination',
  consolidation_only: true,
});

export const CONSOLIDATION_GROUPS = [
  {group_code:'WBG',      group_name:'Wan Bridge Group - consolidated',  parent_group:null,  parent_entity_id:1,  reporting_currency:'USD'},
  {group_code:'WBG-LAND', group_name:'Land companies',                   parent_group:'WBG', parent_entity_id:2,  reporting_currency:'USD'},
  {group_code:'WBG-DEV',  group_name:'Development and project companies',parent_group:'WBG', parent_entity_id:3,  reporting_currency:'USD'},
  {group_code:'WBG-VERT', group_name:'Home building (vertical)',         parent_group:'WBG', parent_entity_id:4,  reporting_currency:'USD'},
  {group_code:'WBG-CORP', group_name:'Corporate',                        parent_group:'WBG', parent_entity_id:15, reporting_currency:'USD'},
  {group_code:'WBG-FUND', group_name:'Investment funds',                 parent_group:'WBG', parent_entity_id:32, reporting_currency:'USD'},
  {group_code:'WBG-SVC',  group_name:'Service companies',                parent_group:'WBG', parent_entity_id:33, reporting_currency:'USD'},
];

export const TOP_GROUP_CODE = 'WBG';

// The group's first reporting period. Membership before this is not asserted.
export const CONSOLIDATION_EFFECTIVE_FROM = '2025-12';

const M = (entity_id, group_code, parent_entity_id, ownership_bp, method, entity_label) => ({
  entity_id, group_code, parent_entity_id, ownership_bp, method, entity_label,
  effective_from: CONSOLIDATION_EFFECTIVE_FROM, effective_to: null,
});

export const CONSOLIDATION_MEMBERS = [
  M(  1, 'WBG'     , null, 10000, 'FULL', 'WBGR Wan Bridge Group LLC'),
  M(  2, 'WBG'     ,    1, 10000, 'FULL', 'WBLD Wan Bridge Land LLC'),
  M(  3, 'WBG'     ,    1, 10000, 'FULL', 'WBDE Wan Bridge Development LLC'),
  M(  4, 'WBG'     ,    1, 10000, 'FULL', 'WBHO WB Home LLC'),
  M(  5, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBCR WB Conroe LLC'),
  M(  6, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBGE WB Georgetown LLC'),
  M(  7, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBBM WB Balmoral LLC'),
  M(  8, 'WBG-VERT',    4, 10000, 'FULL', 'WBWH WB Waxahachie Home Building LLC'),
  M(  9, 'WBG-VERT',    4, 10000, 'FULL', 'WBDH WB Denton Home Building LLC'),
  M( 10, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBEE WBWT West End Estates LLC'),
  M( 11, 'WBG-LAND',    2, 10000, 'FULL', 'WBPL WB Pradera Oaks Land 1 LLC'),
  M( 12, 'WBG-VERT',    4, 10000, 'FULL', 'WBRO WB Red Oaks Home Building LLC'),
  M( 13, 'WBG-VERT',    4, 10000, 'FULL', 'WBIB WB Ivy District Home Building LLC'),
  M( 14, 'WBG-VERT',    4, 10000, 'FULL', 'WBCW WB Crowley Home Building LLC'),
  M( 15, 'WBG'     ,    1, 10000, 'FULL', 'WBAI AIWB INC'),
  M( 16, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBTD TF Portfolio Delaware LLC'),
  M( 17, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBTS WAN BRIDGE TEXAS SERVICE LLC'),
  M( 18, 'WBG-LAND',    2, 10000, 'FULL', 'WBL8 WB Lago Mar POD 8 Land LLC'),
  M( 19, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBSC WBWT Sandy Cove LLC'),
  M( 20, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBSV WBWT Sandy Cove II LLC'),
  M( 21, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBTP Tilegend Partners LLC'),
  M( 22, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBC3 WB Churchill III LLC'),
  M( 23, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBFP WB TF Portfolio Locust LLC'),
  M( 24, 'WBG-FUND',   32, 10000, 'FULL', 'WBC4 WB Conroe 40 LP'),
  M( 25, 'WBG-FUND',   32, 10000, 'FULL', 'WBS5 WB Investment Sub Fund IV LP'),
  M( 26, 'WBG-VERT',    4, 10000, 'FULL', 'WBS1 WB San Marcos 1 Home Building LLC'),
  M( 27, 'WBG-VERT',    4, 10000, 'FULL', 'WBP8 WB POD 8 Home Building LLC'),
  M( 28, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBGA WB Galveston LLC'),
  M( 29, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBLO WB Longhorn LLC'),
  M( 30, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBB7 WBWT Balmoral Section 27 LLC'),
  M( 31, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBTO WB TF Portfolio LLC'),
  M( 32, 'WBG'     ,    1, 10000, 'FULL', 'FDF4 WB Investment Fund IV LLC'),
  M( 33, 'WBG'     ,    1, 10000, 'FULL', 'WBPM WBPT Management LLC'),
  M( 34, 'WBG-SVC' ,   33, 10000, 'FULL', 'WBCA Wan Pacific Capital Management LLC'),
  M( 35, 'WBG-FUND',   32, 10000, 'FULL', 'WBOF WB Opportunity Fund III LP'),
  M( 36, 'WBG-DEV' ,    3, 10000, 'FULL', 'TPAU WBWT Audra I LLC'),
  M( 37, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBIN Wan Bridge Investment LLC'),
  M( 38, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBT2 TF Texas 002 LLC'),
  M( 39, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBC5 WB CH I LLC'),
  M( 40, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBIV WB Ivy District LLC'),
  M( 41, 'WBG-FUND',   32, 10000, 'FULL', 'WBIF Wan Bridge Sub Fund LP'),
  M( 42, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBPH WB Pradera Oaks 2 and 3 Holding LLC'),
  M( 43, 'WBG-FUND',   32, 10000, 'FULL', 'FDF2 WB Investment Fund II LP'),
  M( 44, 'WBG-FUND',   32, 10000, 'FULL', 'WBP2 WB Pradera Oaks 200 LP'),
  M( 45, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBC6 WB CH II LLC'),
  M( 46, 'WBG-FUND',   32, 10000, 'FULL', 'WBO2 WB Opportunity Fund II LP'),
  M( 47, 'WBG-LAND',    2, 10000, 'FULL', 'WBWL WB Waxahachie Land LLC'),
  M( 48, 'WBG-CORP',   15, 10000, 'FULL', 'WBVI WB Investment Texas VI INC'),
  M( 49, 'WBG-LAND',    2, 10000, 'FULL', 'WBLL WB Lago Vista Land LLC'),
  M( 50, 'WBG-CORP',   15, 10000, 'FULL', 'WBSO WB Sage One Inc'),
  M( 51, 'WBG-FUND',   32, 10000, 'FULL', 'WBBT Wan BT Fund Management LLC'),
  M( 52, 'WBG-FUND',   32, 10000, 'FULL', 'WBD2 WB Denton Phase II LP'),
  M( 53, 'WBG-VERT',    4, 10000, 'FULL', 'WBPW WB Parkway Eldridge Home Building LLC'),
  M( 54, 'WBG-LAND',    2, 10000, 'FULL', 'WBSM WB San Marcos SH123 Land LLC'),
  M( 55, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBR2 WBWT Rayzor Ranch II LLC'),
  M( 56, 'WBG-FUND',   32, 10000, 'FULL', 'WBIL Wan Bridge Investment Fund LP'),
  M( 57, 'WBG-CORP',   15, 10000, 'FULL', 'WBS3 WB Sage Investment Three Inc'),
  M( 58, 'WBG-LAND',    2, 10000, 'FULL', 'WBJL WB Joshua Land LLC'),
  M( 59, 'WBG-FUND',   32, 10000, 'FULL', 'WBDP WB Denton Land LP'),
  M( 60, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBFU Wan Bridge Foundation'),
  M( 61, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBCH WB Churchill II LLC'),
  M( 62, 'WBG-LAND',    2, 10000, 'FULL', 'WBFL WB Forney Land LLC'),
  M( 63, 'WBG-LAND',    2, 10000, 'FULL', 'WBWK WB W Klein Land LLC'),
  M( 64, 'WBG-LAND',    2, 10000, 'FULL', 'WBWA WB West Alvin Land LLC'),
  M( 65, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBWR WBWT Rayzor Ranch LLC'),
  M( 66, 'WBG-SVC' ,   33, 10000, 'FULL', 'WBCM Wan Pacific II Capital Management LLC'),
  M( 67, 'WBG-FUND',   32, 10000, 'FULL', 'FD2B Wan Bridge Fund 2B DE LLC'),
  M( 68, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBA2 WBWT Audra II LLC'),
  M( 69, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBL2 WB Lago Mar Pod 12 LLC'),
  M( 70, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBMC WBWT Mason Creek LLC'),
  M( 71, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBT1 TF Texas 001 LLC'),
  M( 72, 'WBG-FUND',   32, 10000, 'FULL', 'WBO6 WB Opportunity Sub Fund 6 LP'),
  M( 73, 'WBG-DEV' ,    3, 10000, 'FULL', 'FDFO WB Magnolia LLC'),
  M( 74, 'WBG-LAND',    2, 10000, 'FULL', 'WBSE WB Seagoville Land LLC'),
  M( 75, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBWI WBWT Investment LLC'),
  M( 76, 'WBG-FUND',   32, 10000, 'FULL', 'WBF4 WB Investment Fund IV LP'),
  M( 77, 'WBG-CORP',   15, 10000, 'FULL', 'WBNF Nanafu Texas Investment Inc'),
  M( 78, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBLF WBWT LS Fronterra LLC'),
  M( 79, 'WBG-CORP',   15, 10000, 'FULL', 'WBST WB Sage Two INC'),
  M( 80, 'WBG-CORP',   15, 10000, 'FULL', 'WBS2 WB Sage Investment Two Inc'),
  M( 81, 'WBG-FUND',   32, 10000, 'FULL', 'WBIT WB Investment Fund IV Holding LLC'),
  M( 82, 'WBG-DEV' ,    3, 10000, 'FULL', 'WB2P WB Conroe 2P DE LLC'),
  M( 83, 'WBG-DEV' ,    3, 10000, 'FULL', 'WB16 WB Red Oak 116B DE LLC'),
  M( 84, 'WBG-LAND',    2, 10000, 'FULL', 'WBCL WB Crowley Land LLC'),
  M( 85, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBPR WB Pearland LLC'),
  M( 86, 'WBG-DEV' ,    3, 10000, 'FULL', 'WB27 WB Balmoral 27 LLC'),
  M( 87, 'WBG-FUND',   32, 10000, 'FULL', 'WBPP WB Primera Red Oaks LP'),
  M( 88, 'WBG-LAND',    2, 10000, 'FULL', 'WBWD W Land Development Management LLC'),
  M( 89, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBVC WB VCH I LLC'),
  M( 90, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBRT WB Red Oak Phase II LLC'),
  M( 91, 'WBG-VERT',    4, 10000, 'FULL', 'WBB5 WB Bastrop 5 Home Building LLC'),
  M( 92, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBHM WB HMH Lago Mar Pod 12 LLC'),
  M( 93, 'WBG-VERT',    4, 10000, 'FULL', 'WBP1 WB PC Phase I Home Building LLC'),
  M( 94, 'WBG-VERT',    4, 10000, 'FULL', 'WBB1 WB Bastrop 1 Home Building LLC'),
  M( 95, 'WBG-VERT',    4, 10000, 'FULL', 'WBPU WB Plum Creek Home Building LLC'),
  M( 96, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBB8 WBWT Balmoral Section 28 LLC'),
  M( 97, 'WBG-CORP',   15, 10000, 'FULL', 'WBSA WB Sage Investment One INC'),
  M( 98, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBBN WB Brooklyn Village LLC'),
  M( 99, 'WBG-FUND',   32, 10000, 'FULL', 'WBOV WB Opportunity Fund V LP'),
  M(100, 'WBG-FUND',   32, 10000, 'FULL', 'FDCM WB Cayman LP'),
  M(101, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBAE WBWT Aurora Square Estates LLC'),
  M(102, 'WBG-FUND',   32, 10000, 'FULL', 'WBF1 Wan Bridge Fund 115 DE LLC'),
  M(103, 'WBG-FUND',   32, 10000, 'FULL', 'FD1B Wan Bridge Fund 1B DE LLC'),
  M(104, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBPS WB Magnolia 1774 LLC'),
  M(105, 'WBG-FUND',   32, 10000, 'FULL', 'WBP6 WB Pradera Oaks 6 LP'),
  M(106, 'WBG-SVC' ,   33, 10000, 'FULL', 'WBTC WB Texas Consulting LLC'),
  M(107, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBCP WB CONROE PH 2 LLC'),
  M(108, 'WBG-VERT',    4, 10000, 'FULL', 'WBCV WB Sandy Cove at Lago Mar Home Building LLC'),
  M(109, 'WBG-FUND',   32, 10000, 'FULL', 'WBCY WB Opportunity Fund VI Cayman L.P.'),
  M(110, 'WBG-DEV' ,    3, 10000, 'FULL', 'WB13 WB BV 139 Delaware LLC'),
  M(111, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBPI WB PC Phase I LLC'),
  M(112, 'WBG-FUND',   32, 10000, 'FULL', 'FDF6 WB Opportunity fund 6 LP'),
  M(113, 'WBG-DEV' ,    3, 10000, 'FULL', 'WB2B WB Conroe 2B DE LLC'),
  M(114, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBPA Wan Pacific Real Estate Development LLC'),
  M(115, 'WBG-FUND',   32, 10000, 'FULL', 'WBP4 WB Pradera Oaks 4 and 5 LP'),
  M(116, 'WBG-SVC' ,   33, 10000, 'FULL', 'WBYF Yanfu Management LLC'),
  M(117, 'WBG-LAND',    2, 10000, 'FULL', 'WBBL WB Bastrop Land LLC'),
  M(118, 'WBG-LAND',    2, 10000, 'FULL', 'WBRL WB Red Oaks Land LLC'),
  M(119, 'WBG-DEV' ,    3, 10000, 'FULL', 'WBON WB Opportunity II Holding LLC'),
];

export const CONSOLIDATION_METHODS = Object.freeze(['FULL', 'EQUITY', 'EXCLUDED']);
const CONTROL_THRESHOLD_BP = 5000;   // more than 50.00% is control

const GROUP_BY_CODE = Object.fromEntries(CONSOLIDATION_GROUPS.map(g => [g.group_code, g]));
const MEMBER_BY_ENTITY = Object.fromEntries(CONSOLIDATION_MEMBERS.map(m => [m.entity_id, m]));

export const consolidationGroup = code => GROUP_BY_CODE[code] || null;
export const consolidationMemberOf = entityId => MEMBER_BY_ENTITY[Number(entityId)] || null;

// The group codes that roll up into `code`, including `code` itself.
export function groupTree(code) {
  if (!GROUP_BY_CODE[code]) return [];
  const out = [];
  const walk = c => { out.push(c); CONSOLIDATION_GROUPS.filter(g => g.parent_group === c).forEach(g => walk(g.group_code)); };
  walk(code);
  return out;
}

// The members reported inside `code`, with the method that applies to them.
// `overrides` re-states a member's method for a what-if run; the measurement
// script uses it to prove that excluding a member breaks the consolidation.
export function groupMembers(code, overrides = {}) {
  const codes = new Set(groupTree(code));
  return CONSOLIDATION_MEMBERS
    .filter(m => codes.has(m.group_code))
    .map(m => (overrides[m.entity_id] ? {...m, method: overrides[m.entity_id]} : m));
}

// The entity ids consolidated line by line inside `code`.
export function fullyConsolidatedEntityIds(code, overrides = {}) {
  return groupMembers(code, overrides).filter(m => m.method === 'FULL').map(m => m.entity_id);
}

// The group model is itself auditable. Every finding here is a defect in the
// model, not in the ledger, and the verifier fails on any of them.
export function validateConsolidationModel(entities = ENTITIES, members = CONSOLIDATION_MEMBERS) {
  const findings = [];
  const seen = new Map();
  for (const m of members) {
    if (seen.has(m.entity_id)) findings.push(`entity ${m.entity_id} has more than one membership row`);
    seen.set(m.entity_id, m);
    if (!GROUP_BY_CODE[m.group_code]) findings.push(`entity ${m.entity_id} names group '${m.group_code}', which is not a consolidation group`);
    if (!CONSOLIDATION_METHODS.includes(m.method)) findings.push(`entity ${m.entity_id} carries method '${m.method}'`);
    if (!Number.isInteger(m.ownership_bp) || m.ownership_bp < 0 || m.ownership_bp > 10000) {
      findings.push(`entity ${m.entity_id} carries ownership_bp ${m.ownership_bp}, which is not an integer 0..10000`);
    }
    if (m.method === 'FULL' && m.ownership_bp <= CONTROL_THRESHOLD_BP) {
      findings.push(`entity ${m.entity_id} is consolidated FULL on ${m.ownership_bp} bp; full consolidation requires control (over ${CONTROL_THRESHOLD_BP} bp)`);
    }
    if (m.parent_entity_id != null && !members.some(x => x.entity_id === m.parent_entity_id)) {
      findings.push(`entity ${m.entity_id} names parent ${m.parent_entity_id}, which is not a group member`);
    }
    if (m.parent_entity_id === m.entity_id) findings.push(`entity ${m.entity_id} is its own parent`);
  }
  for (const e of entities) {
    if (!seen.has(e.entity_id)) findings.push(`entity ${e.entity_id} ${e.entity_code} is in the entity master but in no consolidation group`);
  }
  for (const m of members) {
    if (!entities.some(e => Number(e.entity_id) === Number(m.entity_id))) {
      findings.push(`membership row names entity ${m.entity_id}, which is not in the entity master`);
    }
  }
  // Exactly one root, and every parent chain reaches it without a cycle.
  const roots = members.filter(m => m.parent_entity_id == null);
  if (roots.length !== 1) findings.push(`the group has ${roots.length} ultimate parents; it must have exactly one`);
  for (const m of members) {
    const path = new Set([m.entity_id]);
    let cur = m;
    while (cur && cur.parent_entity_id != null) {
      if (path.has(cur.parent_entity_id)) { findings.push(`entity ${m.entity_id} sits in an ownership cycle`); break; }
      path.add(cur.parent_entity_id);
      cur = seen.get(cur.parent_entity_id);
    }
  }
  for (const g of CONSOLIDATION_GROUPS) {
    if (g.parent_group && !GROUP_BY_CODE[g.parent_group]) findings.push(`group ${g.group_code} names parent group '${g.parent_group}', which does not exist`);
    if (!seen.has(g.parent_entity_id)) findings.push(`group ${g.group_code} names parent entity ${g.parent_entity_id}, which is not a group member`);
  }
  if (entities.some(e => Number(e.entity_id) === ELIMINATION_ENTITY.entity_id)) {
    findings.push('the elimination entity is in the entity master; it must exist only inside the consolidation');
  }
  return {ok: findings.length === 0, findings, member_count: members.length, entity_count: entities.length};
}
