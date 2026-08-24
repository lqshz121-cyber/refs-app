const DATE=/^\d{4}-\d{2}-\d{2}$/;

export function isStrictCalendarDate(value){
  if(typeof value!=='string'||!DATE.test(value))return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
