// Service/Repository layer: all persistence + audit through here (backend swap point)
const NS='refs_';
export const repo = {
  load(k,d){ try{const v=localStorage.getItem(NS+k); return v?JSON.parse(v):d;}catch(e){return d;} },
  save(k,v){ try{localStorage.setItem(NS+k,JSON.stringify(v));}catch(e){} },
  clear(keys){ try{keys.forEach(k=>localStorage.removeItem(NS+k));}catch(e){} },
  audit(user, action, objectType, objectRef, detail){
    const log = repo.load('audit',[]);
    log.unshift({ts:new Date().toISOString().slice(0,19).replace('T',' '), user, action, objectType, objectRef, detail:detail||''});
    repo.save('audit', log.slice(0,500));
  },
  auditLog(){ return repo.load('audit',[]); },
};
