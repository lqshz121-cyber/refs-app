// Service/Repository layer: all persistence + audit through here (backend swap point)
const NS='refs_';
export const repo = {
  load(k,d){ try{const v=localStorage.getItem(NS+k); return v?JSON.parse(v):d;}catch(e){return d;} },
  save(k,v){ try{localStorage.setItem(NS+k,JSON.stringify(v));}catch(e){} },
  clear(keys){ try{keys.forEach(k=>localStorage.removeItem(NS+k));}catch(e){} },
  clearAll({preserve=[]}={}){
    try {
      const keep = new Set(preserve.map(k=>NS+k));
      const keys = [];
      for (let i=0; i<localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(NS) && !keep.has(key)) keys.push(key);
      }
      keys.forEach(key=>localStorage.removeItem(key));
    } catch(e) {}
  },
  ensureSchema(version){
    try {
      if (localStorage.getItem(NS+'seedv') !== version) {
        // Preserve the signed-in demo identity during automatic migrations, but
        // remove every other REFS key, including dynamic setting_<entity> keys.
        repo.clearAll({preserve:['user']});
        localStorage.setItem(NS+'seedv', version);
      }
    } catch(e) {}
  },
  reset(){ repo.clearAll(); },
  audit(user, action, objectType, objectRef, detail){
    const log = repo.load('audit',[]);
    log.unshift({ts:new Date().toISOString().slice(0,19).replace('T',' '), user, action, objectType, objectRef, detail:detail||''});
    repo.save('audit', log.slice(0,500));
  },
  auditLog(){ return repo.load('audit',[]); },
};
