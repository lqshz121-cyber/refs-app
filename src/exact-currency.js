// Keep decimal digits out of binary floating point throughout presentation.
export function formatExactCurrency(value,currency='USD'){
  const text=String(value??'');
  if(!/^-?\d+(?:\.\d{1,4})?$/.test(text))return 'Not available';
  const negative=text.startsWith('-'),[whole,fraction='']=(negative?text.slice(1):text).split('.');
  const code=/^[A-Z]{3}$/.test(currency||'')?currency:'USD';
  const minimum=new Intl.NumberFormat('en-US',{style:'currency',currency:code}).resolvedOptions().minimumFractionDigits;
  const decimals=fraction.replace(/0+$/,'').padEnd(minimum,'0');
  const absolute=BigInt(whole),signed=negative?(absolute===0n?-1n:-absolute):absolute;
  return new Intl.NumberFormat('en-US',{style:'currency',currency:code,minimumFractionDigits:decimals.length,maximumFractionDigits:decimals.length}).formatToParts(signed)
    .map(part=>part.type==='fraction'?decimals:part.type==='integer'&&negative&&absolute===0n?'0':part.value).join('');
}
