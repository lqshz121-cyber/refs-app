export const JE_ACTIONS=['create','save','copy','recurring','batch','submit','review','review-reject','approve','approval-reject','post','reverse','reclass'];
export const NON_PRODUCTION_EXECUTABLE_SPEC=true;

export function successResponse(result){return {status:result.idempotent?200:201,body:{ok:true,code:null,data:result.data,idempotent:!!result.idempotent}};}
export function errorStatus(code){if(code==='JE_PERMISSION_DENIED')return 403;if(['JE_NOT_FOUND','PERIOD_NOT_CONFIGURED'].includes(code))return 404;if(['JE_DUPLICATE_SOURCE','JE_DUPLICATE_ACTION','JE_ID_EXISTS','JE_REVISION_CONFLICT','RECURRING_ID_EXISTS'].includes(code))return 409;if(code==='4005')return 423;return 422;}
export function errorResponse(result){return {status:errorStatus(result.code),body:result};}

export const FRONTEND_API_CONTRACT={
  endpoint:'/api/v1/journal-entries/:id/actions/:action',
  request:{actor_from_session:true,idempotency_header:'Idempotency-Key',expected_revision:'number',payload:'action-specific JSON'},
  success:'{ok:true,code:null,data:{je|template|batch},idempotent:boolean}',
  failure:'{ok:false,code,message,data:null}',
};

export const HARNESS_BOUNDARY='Policy/domain harness only: no network listener, durable database, authentication provider, object storage, or cross-process transaction guarantee is included.';
