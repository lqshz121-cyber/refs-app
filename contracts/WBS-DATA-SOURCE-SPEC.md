# WBS 数据源移交规格(Claude→Codex · 2026-08-01 实测)
> 数据读取线全部移交 Codex。以下为实地摸排结论,省去重复侦察。生产接入必须用正式只读API,页面token仅用于语义验证。

## 1. 入口与鉴权
- 域: wbs.lvshiwanyang.com(主)/wbs.wanbridge.com(同系统)。SSO: /sso/?serviceUrl=…,session cookie 短时效。
- 会计子应用: /accounting/#/<route>?companyCode=XX&year=YYYY&token=<32hex>;token 由 /new/#/list/Finance 菜单点击时下发(window.open),对同子应用多路由可复用,会过期。
- 老应用: /wbs/*.do(如 autoPayment.do?method=viewPaymentBankSum&bizType=WB, actCom.do?method=templateList / showTemplateData&ahId=N)。

## 2. 关键页面与数据(已实测)
| 路由 | 内容 | 字段要点 |
|---|---|---|
| accounting#/companyAccount | JE工作台(每公司) | 19列: PostingDate/CreateDate/Source/JournalNo(YYYYMMDD+6位)/CheckNo/Payee/Memo/Account/Description(=辅助核算member)/CostCode/Class/PayableNo(GUID,回链上游)/Unit/Dr/Cr/Originator/Reviewer/Approver;过滤器含Type=Automatic|Manual、Review=Y/N、Approve三态、ComeFrom |
| accounting#/cashOrBankBookAccountSetting | 四大Setting | AccountSetting 62行taxonomy(Bank按账号/ContructionLoan 7种/Cost按码组0LD·2HD·24E·21E·11O·1SF·3GN·9AM/Cost_子类/Dividend 5种/InternalTransfer 3种/SalesIncome 6种含TitleWithholding/Yardi);CostSetting=CostGL按单码×Dr/Cr;PayableSetting=Credit行+Debit按码分公司(AIWB INC/LLC);BatchSetting=双边科目+Sequential+ReverseNextMonth;有Copy按钮 |
| accounting#/propertyComparisonReport | 跨公司TB | type=WB, 公司多选格式"CODE - Name"(119家代码表已入 refs data.js) |
| wbs/actCom.do templateList | COA模板 | 4套(ALL/Consolidated/HongKong/Restaurant);showTemplateData&ahId=6=ALL 766行: Account/Name/Subsidiary(Bank/Vendor)/NormalBalance/AcctType(Head|Reg|Tot)/RptType/TotalAccount(滚加目标)/BalMargin(层级) |
| wbs/autoPayment.do viewPaymentBankSum | AutoBankRec看板 | 134公司×制单/审核团队×M/R/C三线关账日期×Quantity/Amount/Released/Incurred/ReconBalance/Balance(New)/ReconDate;四步: CompanyScreening→DataProcessing&Release→Incur→IncurredList |

## 3. 记账语义(引擎已同构,fixtures已冻结)
九类Source: PAYABLE(Dr费用+CostCode+PayableNo/Cr 291001_Payee) · EXPA(银行feed清账 Dr291001/Cr111000_公司_银行_尾号,memo=ACH/CCD原文) · AUTOC(卡消费即清) · DIVIDEND(按Lot多行291000+220204代扣) · Reimb三件套 · InternalTransfer · Internal/Individual · NotMatch→异常。
291000-291031=辅助核算清算网(按对手方member);111000按银行账号子账。

## 4. Codex 适配器建议
- 表映射(V2§6): autopaymentbank/fast_auto_payment_detail/accountbook/accountbookpaymentset/match_business_info。
- 幂等键: source_system+source_id+source_version;JournalNo+company 唯一;PayableNo GUID=上游关联。
- 增量: 按 CreateDate/更新时间游标;raw payload 原样落库只读。
- 需 Ricky 提供: 正式只读API或DB账号(页面token不可用于生产)。
