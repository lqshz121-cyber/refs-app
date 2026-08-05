import {readFile} from 'node:fs/promises';
const ui=await readFile(new URL('../src/ui.jsx',import.meta.url),'utf8');
if(!ui.includes('className="empty empty-state"')) throw new Error('TABLE_EMPTY_STATE_CLASS_MISSING');
if(!ui.includes('role="status"')||!ui.includes('aria-live="polite"')) throw new Error('TABLE_EMPTY_STATE_A11Y_MISSING');
console.log(JSON.stringify({pass:true,selector:'empty empty-state',role:'status',live:'polite'}));
