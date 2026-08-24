export function assertCompleteAiPopulation(rows,{limit,code='AI_POPULATION'}={}){
  if(!Number.isSafeInteger(limit)||limit<1||!Array.isArray(rows))throw Object.assign(new Error('AI analysis returned an invalid bounded population.'),{code:`${code}_INVALID`});
  if(rows.length>=limit)throw Object.assign(new Error('AI analysis reached its bounded population limit and cannot assert completeness.'),{code:`${code}_INCOMPLETE`});
  return rows;
}
