import fs from 'node:fs';
const source=fs.readFileSync('src/authoritative-reports-workspace.jsx','utf8');
const required=["const entityLabel=config?.scopePresentation?.entityLabel||'Configured entity'","const periodLabel=config?.scopePresentation?.periodLabel||'Configured period'",'Entity {entityLabel} · Period {periodLabel}','Entity {entityLabel} | Period {periodLabel}','title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}'];
for(const token of required)if(!source.includes(token))throw new Error(`reports-runtime-scope: missing ${token}`);
if((source.match(/Entity \{config\.entityId\} · Period \{config\.periodId\}/g)||[]).length)throw new Error('reports-runtime-scope: raw IDs remain in catalog scope');
console.log('reports-runtime-scope: 5/5 PASS');
