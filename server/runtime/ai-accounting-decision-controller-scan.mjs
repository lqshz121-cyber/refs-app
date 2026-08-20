import {assertAiAccountingDecisionPacketFullBatch} from './ai-accounting-approved-decision-service.mjs';

const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});

export function projectAiAccountingDecisionControllerScan(batch,{tenantId,entityId,accountingPeriodId}={}){
  assertAiAccountingDecisionPacketFullBatch(batch,{tenantId,entityId,accountingPeriodId});
  const findings=batch.packets.map(packet=>Object.freeze({
    entity_id:entityId,
    accounting_period_id:accountingPeriodId,
    rule_id:packet.rule_id,
    risk_level:packet.status==='EXCEPTION'?'HIGH':packet.risk.risk_level,
    reason:packet.reason,
    suggested_action:packet.status==='EXCEPTION'
      ?'Resolve the retained source or approved settings exception before any human Draft is prepared.'
      :'Review the settings-bound suggested Journal and expected report effects before any human Draft is prepared.',
    decision_status:packet.status,
    source_document_id:packet.source.retained_source_id,
    source_type:packet.source.source_type,
    classification:packet.classification,
    settings_snapshot_id:packet.settings_snapshot_id,
    settings_snapshot_hash:packet.settings_snapshot_hash,
    decision_packet:packet,
    action_flags:ACTIONS
  }));
  return Object.freeze({
    schema_version:'AI_ACCOUNTING_DECISION_CONTROLLER_SCAN_BATCH_V1',
    current_accounting_period_id:accountingPeriodId,
    scanned_source_count:batch.row_count,
    decision_counts:batch.decision_counts,
    finding_count:findings.length,
    findings:Object.freeze(findings),
    action_flags:ACTIONS
  });
}
