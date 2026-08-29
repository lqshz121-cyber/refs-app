const SECRET_KEY=/(authorization|credential|password|secret|token|api[_-]?key|raw[_-]?(payload|request|response|package|prompt))/i;
const BEARER=/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const NAMED=/\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|authorization)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi;
const OPAQUE=/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi;
const PRIVATE_KEY=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi;

export function redactAiSecretText(value){
  if(typeof value!=='string')return value;
  return value.replace(PRIVATE_KEY,'[REDACTED PRIVATE KEY]').replace(BEARER,'Bearer [REDACTED]').replace(NAMED,'$1=[REDACTED]').replace(OPAQUE,'[REDACTED]');
}

export const containsAiSecret=value=>typeof value==='string'&&redactAiSecretText(value)!==value;

export function safeAiEvidenceTree(value,{maxArrayLength=2000}={},seen=new Set()){
  if(value===null||typeof value==='number'||typeof value==='boolean')return true;
  if(typeof value==='string')return !containsAiSecret(value);
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  const safe=Array.isArray(value)
    ? value.length<=maxArrayLength&&value.every(item=>safeAiEvidenceTree(item,{maxArrayLength},seen))
    : Object.entries(value).every(([key,item])=>!SECRET_KEY.test(key)&&safeAiEvidenceTree(item,{maxArrayLength},seen));
  seen.delete(value);
  return safe;
}
