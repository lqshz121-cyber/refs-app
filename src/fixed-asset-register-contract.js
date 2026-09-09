import {validFixedAssetRegister} from '../server/api/fixed-asset-register-contract.mjs';
export const validAssetCursor=value=>typeof value==='string'&&value.length<=2048&&/^[A-Za-z0-9+/=]+[.][a-f0-9]{64}$/.test(value);
export function validateFixedAssetRegister(value,{entityId,tenantId,asOfDate,limit=50,after=null,assetId=null}={}){
 if(after!==null&&!validAssetCursor(after))return null;
 if(!validFixedAssetRegister(value,{entityId,tenantId,asOfDate,limit,assetId}))return null;
 return Object.freeze({...value,rows:Object.freeze(value.rows.map(row=>Object.freeze({...row})))});
}
