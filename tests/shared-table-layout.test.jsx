import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table } from '../src/ui.jsx';

const markup=renderToStaticMarkup(<Table
  className="table-journal-entries"
  cols={[{h:'Journal',k:'journal'},{h:'Memo',k:'memo'}]}
  rows={[{id:'je-1',journal:'JE-1',memo:'Authoritative presentation only'}]}
  rowKey="id"
  features={{sortable:false,filterable:false,exportable:false,paginate:false}}
/>);

assert.match(markup,/class="table-wrap\s+table-journal-entries"/,
  'callers must be able to attach a table-specific layout hook to the focusable scroll region');
assert.match(markup,/role="region"/);
assert.match(markup,/tabindex="0"/,
  'class forwarding must retain keyboard access to the table scroller');
assert.match(markup,/<table class="tbl\s*"/,
  'class forwarding must preserve native table semantics');

console.log('shared-table-layout: caller layout classes reach the keyboard-accessible table scroller');
