// S-GATE-02: regenerate section H of ACCEPTANCE-TRACEABILITY-MATRIX.md from the
// CLAUDE-TO-CODEX-* receipts present in a repo root. Usage:
//   node tools/matrix-receipt-index.mjs <repo-root> [matrix-path]
// Classification is conservative: a receipt is VERIFIED only if it declares a
// live read-back marker ("LIVE_VERIFIED" or "读回" with a URL); BLOCKED if it
// declares an authorisation/credential blocker; otherwise INHERITED.
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [root,matrixPath='ACCEPTANCE-TRACEABILITY-MATRIX.md']=process.argv.slice(2);
if(!root){console.error('repo root required');process.exit(2);}
const receipts=readdirSync(root).filter(f=>/^CLAUDE-TO-CODEX-.*\.md$/.test(f)).sort();
const classify=text=>/LIVE_VERIFIED|https?:\/\/[^\s)]+.*(读回|read-back|read back)/s.test(text)?'VERIFIED':(/无凭据|无授权|BLOCKED|阻断/.test(text)?'BLOCKED':'INHERITED');
let out=`\n## H. Receipt index (S-GATE-02, generated ${new Date().toISOString().slice(0,10)} by \`tools/matrix-receipt-index.mjs\`)\n\nEvery \`CLAUDE-TO-CODEX-*\` receipt present in the shared repo root at generation time. Classification: **VERIFIED** = live read-back performed by a session; **INHERITED** = offline evidence; **BLOCKED** = credentials/authorisation missing. Receipts are untracked; regenerate with \`node tools/matrix-receipt-index.mjs <repo-root>\`.\n\n| Receipt | Class |\n|---|---|\n`;
for(const r of receipts)out+=`| \`${r}\` | ${classify(readFileSync(join(root,r),'utf8'))} |\n`;
const matrix=readFileSync(matrixPath,'utf8').replace(/\n## H\. Receipt index[\s\S]*$/,'');
writeFileSync(matrixPath,matrix+out);
console.log(`indexed ${receipts.length} receipts into ${matrixPath}`);
