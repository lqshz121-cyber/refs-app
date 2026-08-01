# REFS 会计错误码(冻结 · V2 §Phase0)— 与 src/engine.js validateJE / staging 一致
| Code | 含义 | 触发 | 处置 |
|---|---|---|---|
| 4001 | JE_OUT_OF_BALANCE | 借贷差>0.005 | 阻断 Post |
| 4002 | LINE_EMPTY_AMOUNT | 行借贷均为空 | 阻断 |
| 4004 | DUPLICATE | 同 vendor+invoice_no / 同 source_id 重复 | 阻断入账 |
| 4005 | MISSING_ACCOUNT | 行缺科目/科目不存在 | 阻断 |
| 4006 | PERIOD_CLOSED | 期间已锁 | 阻断,需 Reopen 流程 |
| 4009 | SOD_VIOLATION | Maker=最终Approver/Poster | 阻断(Controller override 需记录) |
| 4010 | MISSING_ATTACHMENT | 手工JE缺附件 | 阻断 Post |
| 4020 | SUBSIDIARY_MEMBER_MISSING | 辅助核算科目行缺 member | 阻断 Post |
| 4030 | POSTED_IMMUTABLE | 试图修改 Posted | 阻断,只允许 Reverse/Reclass |
| 3020 | GL_MAPPING_MISSING | source 无匹配 Setting/Mapping | → Exception,禁止生成JE |
| 3021 | PROJECT_REQUIRED | Setting 行 Project=Select 但未选 | → Pending Mapping |
| 3030 | SOURCE_TRACE_MISSING | AUTO JE 缺 source_document_id/rule_code | AI-SRC-01 审计发现 |
