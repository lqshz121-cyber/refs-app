import {readFile} from 'node:fs/promises';
const ui=await readFile(new URL('../src/ui.jsx',import.meta.url),'utf8');
// The four states are rendered only by StateBlock in src/ui.jsx; this checks the
// shared empty class and its announcement still exist on that single component.
if(!ui.includes("empty: 'empty empty-state state-block state-empty'")) throw new Error('TABLE_EMPTY_STATE_CLASS_MISSING');
if(!ui.includes("role={tone==='error' ? 'alert' : 'status'}")||!ui.includes("'assertive' : 'polite'")) throw new Error('TABLE_EMPTY_STATE_A11Y_MISSING');
console.log(JSON.stringify({pass:true,selector:'empty empty-state',role:'status',live:'polite'}));
