import {fail,ok} from '../db/je-schema.mjs';

export const ROLE_PERMS={
  CONTROLLER:'*',ACCT_MANAGER:['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.APPROVE'],SENIOR_ACCT:['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.POST'],
  STAFF_ACCT:['GL.JE.CREATE','GL.JE.REVIEW'],PROJECT_ACCT:['GL.JE.CREATE'],PROPERTY_ACCT:['GL.JE.CREATE'],TREASURY:['GL.JE.CREATE'],
  AP:[],AR:['GL.JE.CREATE'],REVIEWER:['GL.JE.REVIEW','GL.JE.APPROVE'],AUDITOR:[],READ_ONLY:[],SYS_ADMIN:[],
};

export const ACTION_PERMISSION={create:'GL.JE.CREATE',save:'GL.JE.CREATE',copy:'GL.JE.CREATE',recurring:'GL.JE.CREATE',batch:'GL.JE.CREATE',reclass:'GL.JE.CREATE',
  submit:'GL.JE.CREATE',review:'GL.JE.REVIEW','review-reject':'GL.JE.REVIEW',approve:'GL.JE.APPROVE','approval-reject':'GL.JE.APPROVE',post:'GL.JE.POST',reverse:'GL.JE.REVERSE'};

export const TRANSITIONS={submit:['DRAFT','PENDING_REVIEW'],review:['PENDING_REVIEW','PENDING_APPROVAL'],approve:['PENDING_APPROVAL','APPROVED'],post:['APPROVED','POSTED'],
  'review-reject':['PENDING_REVIEW','DRAFT'],'approval-reject':['PENDING_APPROVAL','DRAFT']};

export function can(actor,permission){const p=ROLE_PERMS[actor?.role_code];return p==='*'||Array.isArray(p)&&p.includes(permission);}
export function authorize(actor,action){const permission=ACTION_PERMISSION[action];return permission&&can(actor,permission)?ok({permission}):fail('JE_PERMISSION_DENIED',`Missing permission ${permission||'UNKNOWN'}.`);}

export function resolveOpenPeriod(state,je){
  const period=state.periods.get(`${je.entity_id}|${je.period_code}`);
  if(!period)return fail('PERIOD_NOT_CONFIGURED',`No period configured for entity ${je.entity_id} and ${je.period_code}.`);
  if(period.status!=='OPEN')return fail('4005',`Period ${je.period_code} is ${period.status}.`);
  return ok(period);
}

export function validateTransition(je,action,actor){
  const edge=TRANSITIONS[action];if(!edge||!je||je.posting_status!==edge[0])return fail('JE_ILLEGAL_TRANSITION',`${je?.posting_status||'MISSING'} cannot perform ${action}.`);
  if(action==='approve'&&je.created_by===actor.user_id)return fail('JE_SOD_MAKER','Maker cannot approve the same journal.');
  if(action==='post'&&je.created_by===actor.user_id)return fail('JE_SOD_MAKER','Maker cannot post the same journal.');
  if(action==='post'&&je.approver===actor.user_id)return fail('JE_SOD_APPROVER_POSTER','Approver cannot post the same journal.');
  return ok({from:edge[0],to:edge[1]});
}
