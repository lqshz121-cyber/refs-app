export const FIXED_ASSET_REGISTER_SCHEMA={
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "tenant_id",
    "entity_id",
    "as_of_date",
    "basis",
    "population_basis",
    "rows",
    "next_cursor"
  ],
  "properties": {
    "schema_version": {
      "const": "FIXED_ASSET_REGISTER_READ_V2"
    },
    "tenant_id": {
      "type": "string",
      "format": "uuid"
    },
    "entity_id": {
      "type": "string",
      "format": "uuid"
    },
    "as_of_date": {
      "type": "string",
      "format": "date"
    },
    "basis": {
      "const": "POSTED_PRIMARY_LEDGER"
    },
    "population_basis": {
      "const": "PLACED_IN_SERVICE_DATE"
    },
    "rows": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "fixed_asset_register_evidence_id",
          "tenant_id",
          "entity_id",
          "asset_tag",
          "asset_class",
          "currency",
          "cost_basis",
          "salvage_value",
          "placed_in_service_date",
          "useful_life_months",
          "depreciation_method",
          "depreciation_convention",
          "asset_account_code",
          "accumulated_depreciation_account_code",
          "depreciation_expense_account_code",
          "capitalization_proposal_id",
          "source_document_id",
          "source_payload_hash",
          "register_evidence_hash",
          "reviewed_by",
          "reviewed_at",
          "member_trace",
          "posted_cost_balance",
          "accumulated_depreciation",
          "accumulated_impairment",
          "net_book_value",
          "posted_ledger_line_count",
          "as_of_date",
          "status",
          "disposal_journal_entry_id",
          "disposal_binding_id",
          "fixed_asset_disposal_evidence_id",
          "disposal_date",
          "disposal_source_document_id",
          "disposal_source_payload_hash",
          "disposal_source_document_version",
          "disposal_source_link_id"
        ],
        "properties": {
          "fixed_asset_register_evidence_id": {
            "type": "string",
            "format": "uuid"
          },
          "tenant_id": {
            "type": "string",
            "format": "uuid"
          },
          "entity_id": {
            "type": "string",
            "format": "uuid"
          },
          "asset_tag": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "asset_class": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "currency": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "cost_basis": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "salvage_value": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "placed_in_service_date": {
            "type": "string",
            "format": "date"
          },
          "useful_life_months": {
            "type": "integer",
            "minimum": 1,
            "maximum": 600
          },
          "depreciation_method": {
            "const": "STRAIGHT_LINE"
          },
          "depreciation_convention": {
            "const": "FULL_MONTH"
          },
          "asset_account_code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "accumulated_depreciation_account_code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "depreciation_expense_account_code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "capitalization_proposal_id": {
            "type": "string",
            "format": "uuid"
          },
          "source_document_id": {
            "type": "string",
            "format": "uuid"
          },
          "source_payload_hash": {
            "type": "string",
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "register_evidence_hash": {
            "type": "string",
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "reviewed_by": {
            "type": "string",
            "minLength": 1
          },
          "reviewed_at": {
            "type": "string",
            "format": "date-time"
          },
          "member_trace": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "project_ref",
              "property_ref",
              "allocation_basis"
            ],
            "properties": {
              "project_ref": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 255
              },
              "property_ref": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 255
              },
              "allocation_basis": {
                "type": "string",
                "minLength": 1,
                "maxLength": 255
              }
            }
          },
          "posted_cost_balance": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "accumulated_depreciation": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "accumulated_impairment": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "net_book_value": {
            "type": "string",
            "pattern": "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "posted_ledger_line_count": {
            "type": "integer",
            "minimum": 0
          },
          "as_of_date": {
            "type": "string",
            "format": "date"
          },
          "status": {
            "enum": [
              "REGISTERED",
              "ACTIVE",
              "DISPOSAL_POSTED",
              "DISPOSED_REVIEWED"
            ]
          },
          "disposal_journal_entry_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "disposal_binding_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "fixed_asset_disposal_evidence_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "disposal_date": {
            "type": [
              "string",
              "null"
            ],
            "format": "date"
          },
          "disposal_source_document_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "disposal_source_payload_hash": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "disposal_source_document_version": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1
          },
          "disposal_source_link_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          }
        }
      }
    },
    "next_cursor": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 2048,
      "pattern": "^[A-Za-z0-9+/=]+[.][a-f0-9]{64}$"
    }
  }
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function valid(value,schema){
 if(schema.const!==undefined)return value===schema.const;if(schema.enum)return schema.enum.includes(value);
 const types=Array.isArray(schema.type)?schema.type:[schema.type];const type=value===null?'null':Array.isArray(value)?'array':Number.isSafeInteger(value)?'integer':typeof value;if(!types.includes(type))return false;if(value===null)return true;
 if(type==='object'){if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))return false;if(schema.required?.some(key=>!Object.hasOwn(value,key)))return false;return !schema.properties||Object.entries(schema.properties).every(([key,child])=>valid(value[key],child));}
 if(type==='array')return (!schema.maxItems||value.length<=schema.maxItems)&&(!schema.items||value.every(item=>valid(item,schema.items)));
 if(type==='integer')return (schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum);
 if(type==='string'){if(schema.minLength&&value.length<schema.minLength||schema.maxLength&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value))return false;if(schema.format==='uuid'&&!UUID.test(value))return false;if(schema.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))return false;if(schema.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T/.test(value)||Number.isNaN(Date.parse(value))))return false;}
 return true;
}
export function validFixedAssetRegister(result,{tenantId,entityId,asOfDate,limit,assetId=null}){
 if(!valid(result,FIXED_ASSET_REGISTER_SCHEMA)||result.tenant_id!==tenantId||result.entity_id!==entityId||result.as_of_date!==asOfDate||result.rows.length>limit||assetId&&result.next_cursor!==null)return false;
 let last=null;const units=value=>BigInt(value.replace('.',''));
 for(const row of result.rows){if(row.tenant_id!==tenantId||row.entity_id!==entityId||row.as_of_date!==asOfDate||row.placed_in_service_date>asOfDate||assetId&&row.fixed_asset_register_evidence_id!==assetId||last&&row.fixed_asset_register_evidence_id<=last)return false;last=row.fixed_asset_register_evidence_id;
 if(units(row.cost_basis)<=0n||units(row.salvage_value)<0n||units(row.salvage_value)>=units(row.cost_basis)||units(row.net_book_value)!==units(row.posted_cost_balance)-units(row.accumulated_depreciation)-units(row.accumulated_impairment))return false;
 if(row.disposal_date&&row.disposal_date>asOfDate||row.status==='REGISTERED'&&row.posted_ledger_line_count!==0||row.status==='DISPOSAL_POSTED'&&(!row.disposal_binding_id||!row.disposal_journal_entry_id||!row.disposal_date)||row.status==='DISPOSED_REVIEWED'&&!row.fixed_asset_disposal_evidence_id)return false;
 const disposalFields=['disposal_journal_entry_id','disposal_binding_id','disposal_date','disposal_source_document_id','disposal_source_payload_hash','disposal_source_document_version','disposal_source_link_id'];
 if(['posted_cost_balance','accumulated_depreciation','accumulated_impairment','net_book_value'].some(key=>units(row[key])<0n))return false;
 if(row.status==='REGISTERED'||row.status==='ACTIVE'){
  if(disposalFields.some(key=>row[key]!==null)||row.fixed_asset_disposal_evidence_id!==null)return false;
  if(row.status==='REGISTERED'&&['posted_cost_balance','accumulated_depreciation','accumulated_impairment','net_book_value'].some(key=>units(row[key])!==0n))return false;
  if(row.status==='ACTIVE'&&row.posted_ledger_line_count===0)return false;
 }else{
  if(['posted_cost_balance','accumulated_depreciation','accumulated_impairment','net_book_value'].some(key=>row[key]!=='0.0000'))return false;
  if(disposalFields.some(key=>row[key]===null)||row.posted_ledger_line_count===0)return false;
  if(row.status==='DISPOSAL_POSTED'&&row.fixed_asset_disposal_evidence_id!==null)return false;
  if(row.status==='DISPOSED_REVIEWED'&&row.fixed_asset_disposal_evidence_id===null)return false;
 }

 }
 return result.next_cursor===null||result.rows.length===limit;
}

export const FIXED_ASSET_MOVEMENTS_SCHEMA={
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "tenant_id",
    "entity_id",
    "fixed_asset_register_evidence_id",
    "as_of_date",
    "basis",
    "rows",
    "next_cursor"
  ],
  "properties": {
    "schema_version": {
      "const": "FIXED_ASSET_MOVEMENTS_V1"
    },
    "tenant_id": {
      "type": "string",
      "format": "uuid"
    },
    "entity_id": {
      "type": "string",
      "format": "uuid"
    },
    "fixed_asset_register_evidence_id": {
      "type": "string",
      "format": "uuid"
    },
    "as_of_date": {
      "type": "string",
      "format": "date"
    },
    "basis": {
      "const": "POSTED_PRIMARY_LEDGER"
    },
    "rows": {
      "type": "array",
      "maxItems": 100,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "ledger_line_id",
          "journal_line_id",
          "journal_entry_id",
          "posting_batch_id",
          "accounting_period_id",
          "tenant_id",
          "entity_id",
          "fixed_asset_register_evidence_id",
          "as_of_date",
          "journal_number",
          "journal_date",
          "journal_type",
          "journal_status",
          "posted_at",
          "posted_by",
          "account_code",
          "currency",
          "debit_amount",
          "credit_amount",
          "dimensions",
          "account_role",
          "impairment_assessment_reference",
          "impairment_assessment_evidence_id",
          "valuation_source_document_id",
          "source_binding_status",
          "source_document_id",
          "source_payload_hash",
          "source_document_version",
          "source_link_id",
          "disposal_binding_id",
          "posting_audit_event_id",
          "posting_audit_event_count",
          "ledger_lineage_status",
          "ledger_source_link_id",
          "ledger_source_link_count",
          "journal_total_debit",
          "journal_total_credit",
          "journal_ledger_line_count",
          "valuation_source_payload_hash",
          "impairment_assessment_hash",
          "assessment_lineage_status"
        ],
        "properties": {
          "ledger_line_id": {
            "type": "string",
            "format": "uuid"
          },
          "journal_line_id": {
            "type": "string",
            "format": "uuid"
          },
          "journal_entry_id": {
            "type": "string",
            "format": "uuid"
          },
          "posting_batch_id": {
            "type": "string",
            "format": "uuid"
          },
          "accounting_period_id": {
            "type": "string",
            "format": "uuid"
          },
          "tenant_id": {
            "type": "string",
            "format": "uuid"
          },
          "entity_id": {
            "type": "string",
            "format": "uuid"
          },
          "fixed_asset_register_evidence_id": {
            "type": "string",
            "format": "uuid"
          },
          "as_of_date": {
            "type": "string",
            "format": "date"
          },
          "journal_number": {
            "type": "string",
            "minLength": 1
          },
          "journal_date": {
            "type": "string",
            "format": "date"
          },
          "journal_type": {
            "enum": [
              "MANUAL",
              "AUTO",
              "REVERSAL",
              "RECLASS"
            ]
          },
          "journal_status": {
            "const": "POSTED"
          },
          "posted_at": {
            "type": "string",
            "format": "date-time"
          },
          "posted_by": {
            "type": "string",
            "minLength": 1
          },
          "account_code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "currency": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "debit_amount": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "credit_amount": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$"
          },
          "dimensions": {
            "type": "object"
          },
          "account_role": {
            "enum": [
              "ASSET_COST",
              "ACCUMULATED_DEPRECIATION",
              "ACCUMULATED_IMPAIRMENT",
              "OTHER"
            ]
          },
          "impairment_assessment_reference": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 255
          },
          "impairment_assessment_evidence_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "valuation_source_document_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "source_binding_status": {
            "enum": [
              "EXACT_DISPOSAL_SOURCE",
              "BLOCKED_MISSING_EXACT_SOURCE_BINDING"
            ]
          },
          "source_document_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "source_payload_hash": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "source_document_version": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1
          },
          "source_link_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "disposal_binding_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "posting_audit_event_id": {
            "type": "string",
            "format": "uuid"
          },
          "posting_audit_event_count": {
            "const": 1
          },
          "ledger_lineage_status": {
            "enum": [
              "EXACT",
              "BLOCKED_MISSING",
              "BLOCKED_AMBIGUOUS"
            ]
          },
          "ledger_source_link_id": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "ledger_source_link_count": {
            "type": "integer",
            "minimum": 0
          },
          "journal_total_debit": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,21})\\.[0-9]{4}$"
          },
          "journal_total_credit": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,21})\\.[0-9]{4}$"
          },
          "journal_ledger_line_count": {
            "type": "integer",
            "minimum": 2
          },
          "valuation_source_payload_hash": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "impairment_assessment_hash": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^sha256:[a-f0-9]{64}$"
          },
          "assessment_lineage_status": {
            "enum": [
              "EXACT_RETAINED_ASSESSMENT",
              "BLOCKED_UNRESOLVED_REFERENCE",
              "NOT_REFERENCED"
            ]
          }
        }
      }
    },
    "next_cursor": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 2048,
      "pattern": "^[A-Za-z0-9+/=]+[.][a-f0-9]{64}$"
    }
  }
};
export function validFixedAssetMovements(result,{tenantId,entityId,assetId,asOfDate,limit}){
 if(!valid(result,FIXED_ASSET_MOVEMENTS_SCHEMA)||result.tenant_id!==tenantId||result.entity_id!==entityId||result.fixed_asset_register_evidence_id!==assetId||result.as_of_date!==asOfDate||result.rows.length>limit)return false;
 let last=null;for(const row of result.rows){if(row.tenant_id!==tenantId||row.entity_id!==entityId||row.fixed_asset_register_evidence_id!==assetId||row.as_of_date!==asOfDate||row.journal_date>asOfDate||row.dimensions.fixed_asset_register_evidence_id!==assetId||last&&row.ledger_line_id<=last)return false;last=row.ledger_line_id;
 const debit=BigInt(row.debit_amount.replace('.','')),credit=BigInt(row.credit_amount.replace('.',''));if(debit===0n&&credit===0n||debit>0n&&credit>0n)return false;
 if(row.ledger_lineage_status==='EXACT'?(row.ledger_source_link_count!==1||row.ledger_source_link_id===null):row.ledger_source_link_id!==null||row.ledger_source_link_count===(row.ledger_lineage_status==='BLOCKED_MISSING'?1:0)||row.ledger_lineage_status==='BLOCKED_MISSING'&&row.ledger_source_link_count!==0||row.ledger_lineage_status==='BLOCKED_AMBIGUOUS'&&row.ledger_source_link_count<2)return false;
 if(row.journal_total_debit!==row.journal_total_credit||BigInt(row.journal_total_debit.replace('.',''))<debit||BigInt(row.journal_total_credit.replace('.',''))<credit)return false;
 if(row.assessment_lineage_status==='EXACT_RETAINED_ASSESSMENT'?row.impairment_assessment_evidence_id===null||row.valuation_source_payload_hash===null||row.impairment_assessment_hash===null:row.impairment_assessment_evidence_id!==null||row.valuation_source_document_id!==null||row.valuation_source_payload_hash!==null||row.impairment_assessment_hash!==null)return false;
 if(row.assessment_lineage_status==='NOT_REFERENCED'&&row.impairment_assessment_reference!==null||row.assessment_lineage_status==='BLOCKED_UNRESOLVED_REFERENCE'&&row.impairment_assessment_reference===null)return false;
 const fields=['source_document_id','source_payload_hash','source_document_version','source_link_id','disposal_binding_id'];if(row.source_binding_status==='EXACT_DISPOSAL_SOURCE'?fields.some(key=>row[key]===null):fields.some(key=>row[key]!==null))return false;
 if(row.impairment_assessment_evidence_id!==null&&(row.impairment_assessment_evidence_id!==row.impairment_assessment_reference||row.valuation_source_document_id===null)||row.impairment_assessment_evidence_id===null&&row.valuation_source_document_id!==null)return false;
 }return result.next_cursor===null||result.rows.length===limit;
}
