import {createHash} from 'node:crypto';
import {posix,join} from 'node:path';

export function resolveSnapshotEntryPath(root,entry){
  if(typeof root!=='string'||!root)throw new Error('A snapshot root directory is required');
  const name=posix.basename(String(entry?.path??'').replace(/\\/g,'/'));
  if(!name.endsWith('.ndjson')||name.includes(':')||name.includes('\0'))throw new Error('A snapshot entry must name an .ndjson file');
  return join(root,name);
}

export function snapshotEntryExpectation(entry){
  const rows=entry?.rows,bytes=entry?.bytes,sha256=String(entry?.sha256??'').toLowerCase();
  if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(bytes)||bytes<0||!/^[0-9a-f]{64}$/.test(sha256))throw new Error('A snapshot entry requires integer rows, bytes and a sha256 digest');
  return Object.freeze({rows,bytes,sha256});
}

export function createSnapshotIntegrityProbe(entry){
  const expected=snapshotEntryExpectation(entry),hash=createHash('sha256');
  let bytes=0;
  return Object.freeze({
    expected,
    observe(chunk){bytes+=chunk.length;hash.update(chunk);},
    settle(rows){
      const sha256=hash.digest('hex');
      if(rows!==expected.rows||bytes!==expected.bytes||sha256!==expected.sha256)throw new Error('WBS H1 snapshot drift: parsed rows, bytes or sha256 do not match the manifest');
      return Object.freeze({rows,bytes,sha256});
    }
  });
}
