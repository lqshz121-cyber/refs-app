// Production navigation is intentionally smaller than the legacy demo menu.
// Every route here has a signed-in authoritative API workspace behind it; the
// production UI must not advertise browser-local workflows as live accounting.
export const AUTHORITATIVE_NAVIGATION = Object.freeze([
  Object.freeze({label:'Control center',items:Object.freeze([Object.freeze({route:'overview',label:'Control overview'})])}),
  Object.freeze({label:'Expenses',items:Object.freeze([Object.freeze({route:'payables',label:'Bills & expenses'})])}),
  Object.freeze({label:'Receivables',items:Object.freeze([Object.freeze({route:'receivables',label:'Invoices & receipts'})])}),
  Object.freeze({label:'Auto reconciliation',items:Object.freeze([
    Object.freeze({route:'bank',label:'Bank transactions'}),
    Object.freeze({route:'reconciliation',label:'Reconciliation worksheet'}),
  ])}),
  Object.freeze({label:'Accounting',items:Object.freeze([Object.freeze({route:'journals',label:'Journal entries'})])}),
  Object.freeze({label:'Reports',items:Object.freeze([Object.freeze({route:'reports',label:'Financial statements'})])}),
]);

export const AUTHORITATIVE_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(group=>group.items.map(item=>item.route)));
