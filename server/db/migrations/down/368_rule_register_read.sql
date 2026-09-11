BEGIN;
DROP FUNCTION IF EXISTS refs_read_rule_detail(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS refs_read_rule_register(uuid,uuid,text,text,uuid,integer);
DROP FUNCTION IF EXISTS refs_project_rule_register_row(uuid,uuid,uuid,boolean);
DROP FUNCTION IF EXISTS refs_rule_json_is_safe(jsonb);
DROP FUNCTION IF EXISTS refs_rule_redact_text(text);
DROP FUNCTION IF EXISTS refs_rule_text_is_safe(text);
COMMIT;
