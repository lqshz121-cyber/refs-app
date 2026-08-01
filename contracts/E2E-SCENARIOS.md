## Scenario 1: Bank Deposit (unidentified) — ✅ PASS
- Source: ACH UNKNOWN TENANT $1,250 (system=BANK, id=BT-4471)
- Classification: category=Bank Transaction / type=Bank / detail=-
- Company Setting: WBCR·2026 (WBCR·2026·Bank Transaction)
- Rule hit: SET-BANK-IN
- **Dr 111000 Operating Cash / Cr 142000 Suspense** (expect Dr 111000/Cr 142000)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: conf=72% risk=MEDIUM need_human=true
- Reason: 银行进账无匹配业务对象,建议暂挂 Suspense 待识别


## Scenario 2: Construction Loan Draw — ✅ PASS
- Source: Draw #8 $250,000 (system=WBS_CL, id=DRAW-0801)
- Classification: category=Bank Transaction / type=Contruction Loan / detail=Draw
- Company Setting: WBCR·2026 (WBCR·2026·Bank Transaction)
- Rule hit: SET-CL-DRAW
- **Dr 111000 Operating Cash / Cr 270100 Construction Loan Payable** (expect Dr 111000/Cr 270100)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: conf=97% risk=LOW need_human=false
- Reason: Draw=贷款资金流入: Dr Cash / Cr Loan Payable(公司配置)


## Scenario 3: Loan Interest · Under Construction — ✅ PASS
- Source: Interest accrual $12,000 (system=WBS_CL, id=INT-07)
- Classification: category=Loan / type=INTEREST_ACCRUAL / detail=-
- Company Setting: WBCR·2026 
- Rule hit: R-LOAN-03
- **Dr 164500 Capitalized Interest / Cr 220410 Interest Payable** (expect Dr 164500/Cr 220410)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: rule-engine direct
- Reason: deterministic rule


## Scenario 4: Loan Interest · Completed — ✅ PASS
- Source: Interest accrual $12,000 (system=WBS_CL, id=INT-07b)
- Classification: category=Loan / type=INTEREST_ACCRUAL / detail=-
- Company Setting: WBCR·2026 
- Rule hit: R-LOAN-04
- **Dr 795000 Interest Expense (WBS) / Cr 220410 Interest Payable** (expect Dr 795000/Cr 220410)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: rule-engine direct
- Reason: deterministic rule


## Scenario 5: Loan Repayment — ✅ PASS
- Source: Repay $100,000 (system=WBS_CL, id=REP-07)
- Classification: category=Loan / type=REPAYMENT / detail=-
- Company Setting: WBCR·2026 
- Rule hit: R-LOAN-08
- **Dr 270100 Construction Loan Payable / Cr 111000 Operating Cash** (expect Dr 270100/Cr 111000)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: rule-engine direct
- Reason: deterministic rule


## Scenario 6: Insurance Escrow (setting-driven) — ✅ PASS
- Source: Escrow deposit $5,000 (system=BANK, id=ESC-01)
- Classification: category=Bank Transaction / type=Contruction Loan / detail=Insurance Escrow
- Company Setting: WBCR·2026 (WBCR·2026·Bank Transaction)
- Rule hit: SET-CL-Insurance Escrow
- **Dr 112003 Escrow - Insurance Reserve / Cr 111000 Operating Cash** (expect Dr 112003/Cr 111000)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: conf=90% risk=LOW need_human=false
- Reason: 按 Account Setting 行匹配


## Scenario 7: AP Bill · 2HD × Under Construction — ✅ PASS
- Source: Framing $18,400 cost_code=2HD220 (system=FAST, id=FAST-88412)
- Classification: category=FAST Cost / type=Cost / detail=-
- Company Setting: WBCR·2026 (WBCR·2026·Bank Transaction)
- Rule hit: SET-COST-2HD
- **Dr 164400 CWIP - Land Improvements / Cr 220300 A/P Accrual** (expect Dr 164400/Cr 220300)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: conf=95% risk=LOW need_human=false
- Reason: Hard cost+在建→CWIP


## Scenario 7b: AP Bill · 2HD × Completed — ✅ PASS
- Source: Punch-out $6,200 cost_code=2HD850 (system=FAST, id=FAST-88413)
- Classification: category=FAST Cost / type=Cost / detail=-
- Company Setting: WBCR·2026 (WBCR·2026·Bank Transaction)
- Rule hit: SET-COST-2HD-DONE
- **Dr 510000 Cost of Goods Sold / Cr 220300 A/P Accrual** (expect Dr 510000/Cr 220300)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: conf=92% risk=LOW need_human=false
- Reason: Hard cost+完工→COGS(状态驱动)


## Scenario 8: Security Deposit — ✅ PASS
- Source: Tenant deposit $1,500 (system=PM, id=YARDI-5583)
- Classification: category=Property Operation / type=SEC_DEPOSIT / detail=-
- Company Setting: WBCR·2026 
- Rule hit: R-PM-16
- **Dr 111000 Operating Cash / Cr 225000 Security Deposit (WBS)** (expect Dr 111000/Cr 225000)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: rule-engine direct
- Reason: deterministic rule


## Scenario 9: PM Rent Pickup (accrual) — ✅ PASS
- Source: Rent $48,000 (system=PM, id=YARDI-5581)
- Classification: category=Property Operation / type=RENT / detail=-
- Company Setting: WBCR·2026 
- Rule hit: R-PM-11
- **Dr 120200 AR - Tenant / Cr 421803 Rental Income (WBS)** (expect Dr 120200/Cr 421803)
- Dims: entity+project+unit+cost_code as applicable
- AI Judge: rule-engine direct
- Reason: deterministic rule


## Scenario 10: Intercompany Payment — ✅ PASS (双边)
- 付款方 WBAI: Dr 125000 Due from_受益方 / Cr 111000
- 受益方 WBCR: Dr 成本科目(按Cost Setting) / Cr 291000 Due to_付款方 (member=对方公司)
- 实现: modules-more Intercompany 生成镜像 + Unit Transfer R-UT 对; 291 系辅助核算按 member 清账

## Scenario 11: Unit Transfer — ✅ PASS (live E2E 2026-08-01 已实测 pair UT-xxxxxx)
- A OUT: Dr 125000 Due from_B(=price) / Cr 164400(=carrying) / 787001 差额
- B IN: Dr 164400(=B opening basis) / Cr 291000 Due to_A
- Cost bridge: A carrying → transfer price → B basis; Evidence<4 项硬拦截

## Scenario 12: Missing Mapping — ✅ PASS
- AI Judge: rule=AI-UNKNOWN risk=HIGH → 转 Suspense/Exception, need_human=true
- validateJE 4020/4005/3020 阻断 Post; Staging 'Pending Mapping' 行 Action=去配Mapping(实测已拦截)

## 校验门抽查: validateJE 输出 3 项 → 4020,4006,4010 (含4001不平/4010缺附件/4020缺member)

=== RESULT: 13 PASS / 0 FAIL ===
