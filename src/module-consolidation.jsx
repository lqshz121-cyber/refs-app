import { useMemo, useState } from 'react';
import { Badge, Drawer, Money, SectionTitle, Segmented, StateBlock, Table } from './ui.jsx';
import {
  buildConsolidation, consolidatedAccountDetail, eliminationDetail,
  ELIMINATION_TYPES, IC_ACCOUNTS,
} from './consolidation.js';
import {
  CONSOLIDATION_GROUPS, CONSOLIDATION_MEMBERS, ELIMINATION_ENTITY, TOP_GROUP_CODE,
  consolidationGroup, validateConsolidationModel,
} from './consolidation-groups.js';
import { ENTITIES } from './data.js';
import { buildConsolidatedCashFlowStatement } from './cash-flow-statement.js';

const VIEWS = ['Trial Balance', 'Balance Sheet', 'Income Statement', 'Cash Flows', 'Eliminations', 'Group'];
const d = c => (c == null ? null : c / 100);

// Three money columns, always in the same order and always the same reading:
// what the entities posted, what consolidation removed, what the group reports.
const amountCols = (entityKey, elimKey, consKey) => ([
  {h:'Entity totals', num:true, w:150, sortVal:r => r[entityKey], render:r => <Money v={d(r[entityKey])}/>},
  {h:'Eliminations', num:true, w:150, sortVal:r => r[elimKey], render:r => <Money v={d(r[elimKey])} nil={r[elimKey] === 0}/>},
  {h:'Consolidated', num:true, w:150, sortVal:r => r[consKey], render:r => <Money v={d(r[consKey])} bold/>},
]);

function TotalRow({label, entity, elimination, consolidated}) {
  return <div className="appr-row" style={{fontWeight:600}}>
    <span>{label}</span>
    <span className="row-acts" style={{display:'flex', gap:24}}>
      <Money v={d(entity)}/><Money v={d(elimination)} nil={elimination === 0}/><Money v={d(consolidated)} bold/>
    </span>
  </div>;
}

export function Consolidation({ctx}) {
  const jes = (ctx && ctx.jes) || [];
  // A route preset may open a named view directly, the same way the General
  // Ledger workspace accepts one. It is also what lets a server-side render
  // exercise every view rather than only the default one.
  const preset = (ctx && ctx.navContext && ctx.navContext.route === 'consolidation') ? ctx.navContext : {};
  const [view, setView] = useState(VIEWS.includes(preset.view) ? preset.view : 'Trial Balance');
  const [groupCode, setGroupCode] = useState(TOP_GROUP_CODE);
  const [throughPeriod, setThroughPeriod] = useState((ctx && ctx.currentPeriod) || '2026-07');
  const [drillAccount, setDrillAccount] = useState(null);
  const [cashFlowFrom, setCashFlowFrom] = useState('2026-01');
  const [drillElimination, setDrillElimination] = useState(null);

  const periods = useMemo(() => {
    const set = new Set(jes.filter(j => j.posting_status === 'POSTED').map(j => String(j.period_code || '')).filter(Boolean));
    return [...set].sort();
  }, [jes]);

  const result = useMemo(
    () => buildConsolidation({journals: jes, groupCode, throughPeriod}),
    [jes, groupCode, throughPeriod]);

  // The consolidated statement of cash flows runs over the entity ledgers PLUS
  // the elimination ledger, with intercompany balances inside the boundary
  // treated as internal cash so that a payment one member made on another
  // member's behalf reports where the money actually went. The period range is
  // the group's first reporting period through the selected period, which is
  // the range the elimination batch was built for.
  const cashFlow = useMemo(() => {
    const ids = result.elimination.entity_ids || [];
    const byId = Object.fromEntries(ENTITIES.map(e => [Number(e.entity_id), e.entity_name]));
    return buildConsolidatedCashFlowStatement({
      journals: jes.filter(j => j.posting_status === 'POSTED'),
      eliminations: result.elimination.eliminations,
      entityIds: ids,
      entityNames: ids.map(id => byId[Number(id)]).filter(Boolean),
      fromPeriod: cashFlowFrom,
      throughPeriod,
    });
  }, [jes, result, cashFlowFrom, throughPeriod]);

  const model = useMemo(() => validateConsolidationModel(ENTITIES, CONSOLIDATION_MEMBERS), []);
  const group = consolidationGroup(groupCode) || {group_code: groupCode, group_name: groupCode};
  const tb = result.trialBalance;
  const bs = result.balanceSheet;
  const is = result.incomeStatement;
  const elim = result.elimination;
  const icResidual = IC_ACCOUNTS.reduce((s, code) => {
    const row = tb.rows.find(r => r.account_code === code);
    return s + (row ? row.consolidated_balance_cents : 0);
  }, 0);

  const detail = drillAccount ? consolidatedAccountDetail(result, drillAccount) : null;
  const eliminationRecord = drillElimination ? eliminationDetail(result, drillElimination) : null;

  const statementRows = section => section.map(r => ({...r, key: r.account_code}));

  const tbCols = [
    {h:'Account', w:80, k:'account_code'},
    {h:'Name', render:r => r.account_name},
    {h:'Type', w:100, render:r => <Badge tone="muted">{r.account_type}</Badge>},
    ...amountCols('entity_balance_cents', 'elimination_balance_cents', 'consolidated_balance_cents'),
    {h:'Sources', w:120, render:r => <span className="muted sm">{r.entities.length} entit{r.entities.length === 1 ? 'y' : 'ies'}{r.elimination_refs.length ? ` · ${r.elimination_refs.length} elim` : ''}</span>},
  ];
  const statementCols = [
    {h:'Account', w:80, k:'account_code'},
    {h:'Name', render:r => r.account_name},
    ...amountCols('entity_cents', 'elimination_cents', 'consolidated_cents'),
    {h:'Sources', w:120, render:r => <span className="muted sm">{r.entities.length} entit{r.entities.length === 1 ? 'y' : 'ies'}{r.elimination_refs.length ? ` · ${r.elimination_refs.length} elim` : ''}</span>},
  ];

  return <div className="full-bleed">
    <h2 className="page-h">Consolidation</h2>
    <p className="page-subtitle">
      Entity totals, eliminations and the consolidated column side by side. Eliminations are journals on a
      separate elimination ledger ({ELIMINATION_ENTITY.entity_code} · entity {ELIMINATION_ENTITY.entity_id}); no
      entity ledger is changed by anything on this page. Every figure opens to the entities and eliminations behind it.
    </p>

    <div className="filter-bar">
      <label className="sw">
        <span className="muted sm" style={{marginRight:6}}>Group</span>
        <select value={groupCode} onChange={e => setGroupCode(e.target.value)} aria-label="Consolidation group">
          {CONSOLIDATION_GROUPS.map(g => <option key={g.group_code} value={g.group_code}>{g.group_code} · {g.group_name}</option>)}
        </select>
      </label>
      <label className="sw">
        <span className="muted sm" style={{marginRight:6}}>Through period</span>
        <select value={throughPeriod} onChange={e => setThroughPeriod(e.target.value)} aria-label="Report through period">
          {periods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <span className="muted sm">
        {elim.entity_ids.length} entities consolidated · {elim.eliminations.length} elimination entries
      </span>
      <Badge tone={icResidual === 0 ? 'ok' : 'bad'}>
        {icResidual === 0 ? 'Intercompany residual 0.00' : 'Intercompany residual not zero'}
      </Badge>
      <Badge tone={bs.balanced ? 'ok' : 'bad'}>
        {bs.balanced ? 'Consolidated balance sheet balances' : 'Consolidated balance sheet out of balance'}
      </Badge>
    </div>

    <Segmented options={VIEWS} value={view} onChange={setView} label="Consolidated report"/>

    {!elim.batch.balanced && <StateBlock tone="error" title="The elimination batch does not balance">
      {elim.batch.unbalanced.length} elimination entr{elim.batch.unbalanced.length === 1 ? 'y does' : 'ies do'} not balance in themselves.
      A consolidated statement built on them cannot be relied on. First unbalanced entry: {elim.batch.unbalanced[0]}.
    </StateBlock>}

    {elim.warnings.length > 0 && <StateBlock tone="error" title={`${elim.warnings.length} intercompany item(s) could not be eliminated`}>
      <ul style={{margin:'6px 0 0 16px'}}>{elim.warnings.slice(0, 5).map((w, i) => <li key={i} className="sm">{w}</li>)}</ul>
      {elim.warnings.length > 5 && <div className="muted sm">and {elim.warnings.length - 5} more.</div>}
    </StateBlock>}

    {view === 'Trial Balance' && <section style={{marginTop:14}}>
      <SectionTitle right={<span className="muted sm">{tb.rows.length} accounts</span>}>
        Consolidated trial balance · {group.group_name} · through {throughPeriod}
      </SectionTitle>
      <Table cols={tbCols} rows={tb.rows} rowKey="account_code" exportName="consolidated-trial-balance"
        pageSize={40} onRow={r => setDrillAccount(r.account_code)}
        empty="No posted activity in this group and period."/>
      <TotalRow label="Total debits" entity={tb.totals.entity_debit_cents}
        elimination={tb.totals.elimination_debit_cents} consolidated={tb.totals.consolidated_debit_cents}/>
      <TotalRow label="Total credits" entity={tb.totals.entity_credit_cents}
        elimination={tb.totals.elimination_credit_cents} consolidated={tb.totals.consolidated_credit_cents}/>
    </section>}

    {view === 'Balance Sheet' && <section style={{marginTop:14}}>
      {[['assets', 'Assets'], ['liabilities', 'Liabilities'], ['equity', 'Equity']].map(([key, label]) => <div key={key}>
        <SectionTitle>{label}</SectionTitle>
        <Table cols={statementCols} rows={statementRows(bs.sections[key])} rowKey="key"
          onRow={r => setDrillAccount(r.account_code)} features={{filterable:false, paginate:false}}
          empty={`No ${label.toLowerCase()} in this group and period.`}/>
        <TotalRow label={`Total ${label.toLowerCase()}`} entity={bs.totals.entity[key]}
          elimination={bs.totals.elimination[key]} consolidated={bs.totals.consolidated[key]}/>
      </div>)}
      <TotalRow label="Current year earnings" entity={bs.totals.entity.current_earnings}
        elimination={bs.totals.elimination.current_earnings} consolidated={bs.totals.consolidated.current_earnings}/>
      <TotalRow label="Liabilities + equity + current earnings" entity={bs.totals.entity.liabilities + bs.totals.entity.equity + bs.totals.entity.current_earnings}
        elimination={bs.totals.elimination.liabilities + bs.totals.elimination.equity + bs.totals.elimination.current_earnings}
        consolidated={bs.totals.consolidated.liabilities + bs.totals.consolidated.equity + bs.totals.consolidated.current_earnings}/>
      <p className="muted sm">
        Consolidated assets less liabilities, equity and current earnings: <Money v={d(bs.out_of_balance_cents.consolidated)}/>.
      </p>
    </section>}

    {view === 'Income Statement' && <section style={{marginTop:14}}>
      {[['revenue', 'Revenue'], ['cost_of_sales', 'Cost of sales'], ['operating_expense', 'Operating expense']].map(([key, label]) => <div key={key}>
        <SectionTitle>{label}</SectionTitle>
        <Table cols={statementCols} rows={statementRows(is.sections[key])} rowKey="key"
          onRow={r => setDrillAccount(r.account_code)} features={{filterable:false, paginate:false}}
          empty={`No ${label.toLowerCase()} in this group and period.`}/>
        <TotalRow label={`Total ${label.toLowerCase()}`} entity={is.totals.entity[key]}
          elimination={is.totals.elimination[key]} consolidated={is.totals.consolidated[key]}/>
      </div>)}
      <TotalRow label="Gross profit" entity={is.totals.entity.gross_profit}
        elimination={is.totals.elimination.gross_profit} consolidated={is.totals.consolidated.gross_profit}/>
      <TotalRow label="Net income" entity={is.totals.entity.net_income}
        elimination={is.totals.elimination.net_income} consolidated={is.totals.consolidated.net_income}/>
    </section>}

    {view === 'Cash Flows' && <section style={{marginTop:14}}>
      <SectionTitle right={<span className="muted sm">{cashFlow.scope.boundary_size} entities in the boundary</span>}>
        Consolidated statement of cash flows · {group.group_name} · {cashFlowFrom} ~ {throughPeriod}
      </SectionTitle>
      <div className="filter-bar">
        <label className="sw">
          <span className="muted sm" style={{marginRight:6}}>From period</span>
          <select value={cashFlowFrom} onChange={e => setCashFlowFrom(e.target.value)} aria-label="Cash flow statement from period">
            {periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <Badge tone={cashFlow.ties.opening_plus_change_equals_closing && cashFlow.ties.sections_equal_cash_movement ? 'ok' : 'bad'}>
          {cashFlow.ties.opening_plus_change_equals_closing && cashFlow.ties.sections_equal_cash_movement ? 'Opening + net change = closing' : 'Statement does not tie'}
        </Badge>
        <Badge tone={cashFlow.ties.direct_equals_indirect ? 'ok' : 'bad'}>
          {cashFlow.ties.direct_equals_indirect ? 'Direct and indirect agree' : 'Methods disagree'}
        </Badge>
        <Badge tone={cashFlow.ties.intercompany_eliminated ? 'ok' : 'bad'}>
          {cashFlow.ties.intercompany_eliminated ? 'Intercompany cash eliminated' : 'Intercompany cash not eliminated'}
        </Badge>
      </div>

      {!cashFlow.ready && <StateBlock tone="error" title="The consolidated statement of cash flows does not tie">
        <ul style={{margin:'6px 0 0 16px'}}>{cashFlow.findings.slice(0, 5).map((f, i) => <li key={i} className="sm">{f}</li>)}</ul>
      </StateBlock>}

      <div className="stmt stmt-wide">
        <div className="stmt-row"><span>Cash, cash equivalents and restricted cash at the beginning of {cashFlowFrom}</span><Money v={d(cashFlow.cash.opening_cents)}/></div>
        {cashFlow.direct.sections.map(section => <div key={section.section}>
          <div className="stmt-sec">{section.section} activities</div>
          {section.lines.length === 0
            ? <div className="stmt-row"><span className="muted sm">No consolidated {section.section.toLowerCase()} cash activity in this period</span><Money v={0}/></div>
            : section.lines.map(line => <div key={line.rule_id} className="stmt-row"><span>{line.label} <span className="muted sm">{line.rule_id}</span></span><Money v={d(line.cents)}/></div>)}
          <div className="stmt-row tot"><span>Net cash provided by (used in) {section.section.toLowerCase()} activities</span><Money v={d(section.total_cents)} bold/></div>
        </div>)}
        <div className="stmt-sec">Net change in cash</div>
        <div className="stmt-row tot"><span>Net increase (decrease) in cash, cash equivalents and restricted cash</span><Money v={d(cashFlow.direct.total_cents)} bold/></div>
        <div className="stmt-row tot"><span>Cash, cash equivalents and restricted cash at the end of {throughPeriod}</span><Money v={d(cashFlow.cash.closing_cents)} bold/></div>

        <div className="stmt-sec">Reconciliation of consolidated net income to operating cash</div>
        <div className="stmt-row"><span>Consolidated net income, after eliminations</span><Money v={d(cashFlow.indirect.net_income_cents)}/></div>
        {cashFlow.indirect.reclassifications.map(r => <div key={'rc' + r.account_code} className="stmt-row"><span>Reported in investing or financing · {r.account_code} {r.account_name}</span><Money v={d(r.presented_cents)}/></div>)}
        {cashFlow.indirect.non_cash_adjustments.map(r => <div key={'nc' + r.account_code} className="stmt-row"><span>Non-cash · {r.account_code} {r.account_name}</span><Money v={d(r.presented_cents)}/></div>)}
        {cashFlow.indirect.working_capital.map(r => <div key={'wc' + r.account_code} className="stmt-row"><span>Working capital · {r.account_code} {r.account_name}</span><Money v={d(r.presented_cents)}/></div>)}
        <div className="stmt-row tot"><span>Net cash from operating activities · indirect</span><Money v={d(cashFlow.indirect.operating_cents)} bold/></div>
        <div className="stmt-row tot"><span>Net cash from operating activities · direct</span><Money v={d(cashFlow.direct.sections[0].total_cents)} bold/></div>

        <div className="stmt-sec">Intercompany</div>
        <div className="stmt-row"><span>Intercompany cash moved between members (in / out)</span><span><Money v={d(cashFlow.intercompany.internal_cash_inflow_cents)}/> / <Money v={d(cashFlow.intercompany.internal_cash_outflow_cents)}/></span></div>
        <div className="stmt-row"><span>Net intercompany cash left in the consolidated statement</span><span><Money v={d(cashFlow.intercompany.internal_cash_net_cents)}/><Badge tone={cashFlow.intercompany.internal_cash_net_cents === 0 ? 'ok' : 'bad'}>{cashFlow.intercompany.internal_cash_net_cents === 0 ? 'ELIMINATED' : 'RESIDUAL'}</Badge></span></div>
        <div className="stmt-row"><span>Purely internal transaction chains kept out of the sections</span><span className="muted sm">{cashFlow.intercompany.internal_transaction_groups} chain(s) · {cashFlow.intercompany.internal_transaction_journals} journal(s)</span></div>
      </div>
      <p className="muted sm">
        For the group an intercompany receivable or payable that eliminates inside the boundary is internal cash, so a
        payment one member made on another member's behalf reports as the group's operating payment rather than as a
        financing advance. A chain of intercompany journals that moved no bank balance at all is reported here and kept
        out of every section, so an internal transfer cannot gross up operating activities.
      </p>
    </section>}

    {view === 'Eliminations' && <section style={{marginTop:14}}>
      <SectionTitle right={<span className="muted sm">batch {elim.batch.batch_id}</span>}>Elimination ledger</SectionTitle>
      <div className="filter-bar">
        {ELIMINATION_TYPES.map(t => {
          const n = elim.eliminations.filter(e => e.elimination_type === t.code).length;
          return <span key={t.code} className="muted sm"><Badge tone="muted">{t.code}</Badge> {t.name} · {n}</span>;
        })}
      </div>
      <Table
        cols={[
          {h:'Elimination', w:230, k:'elimination_id'},
          {h:'Type', w:110, render:r => <Badge tone="muted">{r.elimination_type}</Badge>},
          {h:'Period', w:80, k:'period_code'},
          {h:'Pair', render:r => r.pair_key || '—'},
          {h:'Debit', num:true, w:130, sortVal:r => r.total_debit_cents, render:r => <Money v={d(r.total_debit_cents)}/>},
          {h:'Credit', num:true, w:130, sortVal:r => r.total_credit_cents, render:r => <Money v={d(r.total_credit_cents)}/>},
          {h:'Balances', w:90, render:r => <Badge tone={r.balanced ? 'ok' : 'bad'}>{r.balanced ? 'BALANCED' : 'OUT_OF_BALANCE'}</Badge>},
        ]}
        rows={elim.eliminations} rowKey="elimination_id" exportName="consolidation-eliminations"
        onRow={r => setDrillElimination(r.elimination_id)}
        empty="This group and period produced no eliminations."/>
      <TotalRow label="Elimination batch total" entity={0} elimination={elim.batch.total_debit_cents} consolidated={elim.batch.total_credit_cents}/>
    </section>}

    {view === 'Group' && <section style={{marginTop:14}}>
      <SectionTitle>Consolidation groups</SectionTitle>
      <Table cols={[
        {h:'Group', w:110, k:'group_code'},
        {h:'Name', k:'group_name'},
        {h:'Reports into', w:120, render:r => r.parent_group || 'Ultimate parent'},
        {h:'Parent entity', w:220, render:r => {
          const e = ENTITIES.find(x => x.entity_id === r.parent_entity_id);
          return e ? `${e.entity_code} ${e.entity_name}` : String(r.parent_entity_id);
        }},
        {h:'Members', num:true, w:90, render:r => CONSOLIDATION_MEMBERS.filter(m => m.group_code === r.group_code).length},
        {h:'Currency', w:90, k:'reporting_currency'},
      ]} rows={CONSOLIDATION_GROUPS} rowKey="group_code" features={{filterable:false, paginate:false}}/>

      <SectionTitle right={<Badge tone={model.ok ? 'ok' : 'bad'}>{model.ok ? 'Model consistent' : `${model.findings.length} defect(s)`}</Badge>}>
        Group membership · {CONSOLIDATION_MEMBERS.length} entities
      </SectionTitle>
      {!model.ok && <StateBlock tone="error" title="The consolidation group model is inconsistent">
        <ul style={{margin:'6px 0 0 16px'}}>{model.findings.slice(0, 6).map((f, i) => <li key={i} className="sm">{f}</li>)}</ul>
      </StateBlock>}
      <Table cols={[
        {h:'Entity', w:80, num:true, k:'entity_id'},
        {h:'Name', render:r => r.entity_label},
        {h:'Group', w:110, k:'group_code'},
        {h:'Parent entity', w:110, num:true, render:r => r.parent_entity_id == null ? 'None' : r.parent_entity_id},
        {h:'Ownership', num:true, w:110, sortVal:r => r.ownership_bp, render:r => `${(r.ownership_bp / 100).toFixed(2)}%`},
        {h:'Method', w:110, render:r => <Badge tone={r.method === 'FULL' ? 'ok' : 'muted'}>{r.method}</Badge>},
        {h:'From', w:90, k:'effective_from'},
      ]} rows={CONSOLIDATION_MEMBERS} rowKey="entity_id" exportName="consolidation-members" pageSize={30}/>
      <p className="muted sm">
        FULL consolidates the member line by line and eliminates all of its intercompany balances. EQUITY and EXCLUDED
        keep the member outside the line-by-line boundary, and its intercompany balances then cannot eliminate - the
        engine reports each one rather than dropping it. Non-controlling interest is not measured; the ledger carries no
        non-controlling capital.
      </p>
    </section>}

    <Drawer open={!!detail} onClose={() => setDrillAccount(null)} width={720}
      title={detail ? `${detail.account_code} ${detail.account_name}` : ''}>
      {detail && <div>
        <div className="appr-row"><span>Entity totals</span><span className="row-acts"><Money v={d(detail.entity_balance_cents)}/></span></div>
        <div className="appr-row"><span>Eliminations</span><span className="row-acts"><Money v={d(detail.elimination_balance_cents)}/></span></div>
        <div className="appr-row" style={{fontWeight:600}}><span>Consolidated</span><span className="row-acts"><Money v={d(detail.consolidated_balance_cents)} bold/></span></div>
        <SectionTitle>Entities behind the entity column</SectionTitle>
        <Table cols={[
          {h:'Entity', w:90, k:'entity_code'},
          {h:'Name', k:'entity_name'},
          {h:'Debit', num:true, render:r => <Money v={d(r.debit_cents)}/>},
          {h:'Credit', num:true, render:r => <Money v={d(r.credit_cents)}/>},
          {h:'Balance', num:true, render:r => <Money v={d(r.debit_cents - r.credit_cents)}/>},
          {h:'Lines', num:true, w:80, k:'line_count'},
        ]} rows={detail.entities} rowKey="entity_id" pageSize={12}
          empty="No entity posted to this account in scope."/>
        <SectionTitle>Eliminations applied to this account</SectionTitle>
        <Table cols={[
          {h:'Elimination', k:'elimination_id'},
          {h:'Type', w:110, render:r => <Badge tone="muted">{r.elimination_type}</Badge>},
          {h:'Period', w:80, k:'period_code'},
          {h:'Debit', num:true, render:r => <Money v={d(r.debit_cents)}/>},
          {h:'Credit', num:true, render:r => <Money v={d(r.credit_cents)}/>},
          {h:'Source lines', num:true, w:110, render:r => r.sources.length},
        ]} rows={detail.eliminations} rowKey="elimination_id" pageSize={12}
          onRow={r => { setDrillAccount(null); setDrillElimination(r.elimination_id); }}
          empty="Nothing was eliminated from this account."/>
      </div>}
    </Drawer>

    <Drawer open={!!eliminationRecord} onClose={() => setDrillElimination(null)} width={780}
      title={eliminationRecord ? eliminationRecord.elimination_id : ''}>
      {eliminationRecord && <div>
        <p className="muted sm">{eliminationRecord.description}</p>
        <div className="filter-bar">
          <Badge tone="muted">{eliminationRecord.elimination_type}</Badge>
          <Badge tone="muted">{eliminationRecord.rule_code}</Badge>
          <Badge tone={eliminationRecord.balanced ? 'ok' : 'bad'}>{eliminationRecord.balanced ? 'BALANCED' : 'OUT_OF_BALANCE'}</Badge>
          <span className="muted sm">Ledger: {eliminationRecord.ledger} · entity {eliminationRecord.entity_id} {eliminationRecord.entity_name}</span>
        </div>
        <SectionTitle>Elimination lines</SectionTitle>
        <Table cols={[
          {h:'Account', w:80, k:'account_code'},
          {h:'Name', render:r => r.account_name},
          {h:'Member', render:r => r.member || '—'},
          {h:'From', render:r => r.source_entity_name || '—'},
          {h:'Debit', num:true, render:r => <Money v={d(r.debit_cents)} nil={r.debit_cents === 0}/>},
          {h:'Credit', num:true, render:r => <Money v={d(r.credit_cents)} nil={r.credit_cents === 0}/>},
        ]} rows={eliminationRecord.lines} features={{filterable:false, paginate:false}}
          empty="This elimination has no lines."/>
        <SectionTitle right={<span className="muted sm">{eliminationRecord.sources.length} posted journal lines</span>}>
          Posted journal lines this elimination was derived from
        </SectionTitle>
        <Table cols={[
          {h:'Journal', w:170, k:'je_number'},
          {h:'Entity', w:70, num:true, k:'entity_id'},
          {h:'Entity name', render:r => r.entity_name},
          {h:'Period', w:80, k:'period_code'},
          {h:'Account', w:80, k:'account_code'},
          {h:'Member', render:r => r.member || '—'},
          {h:'Debit', num:true, render:r => <Money v={d(r.debit_cents)} nil={r.debit_cents === 0}/>},
          {h:'Credit', num:true, render:r => <Money v={d(r.credit_cents)} nil={r.credit_cents === 0}/>},
        ]} rows={eliminationRecord.sources} pageSize={15} exportName="elimination-source-lines"
          empty="This elimination names no source journal line."/>
      </div>}
    </Drawer>
  </div>;
}
