const SECRET_KEY=/(authorization|credential|password|secret|token|api[_-]?key|raw[_-]?(payload|request|response|package|prompt))/i;
const SECRET_VALUE=/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|authorization)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/i;

export function safeAiEvidenceTree(value,{maxArrayLength=2000}={},seen=new Set()){
  if(value===null||typeof value==='number'||typeof value==='boolean')return true;
  if(typeof value==='string')return !SECRET_VALUE.test(value);
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  const safe=Array.isArray(value)
    ? value.length<=maxArrayLength&&value.every(item=>safeAiEvidenceTree(item,{maxArrayLength},seen))
    : Object.entries(value).every(([key,item])=>!SECRET_KEY.test(key)&&safeAiEvidenceTree(item,{maxArrayLength},seen));
  seen.delete(value);
  return safe;
}
