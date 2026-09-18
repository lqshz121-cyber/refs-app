# Q06 — 无障碍与键盘操作（WCAG 2.1 AA）

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 审查范围

针对 REFS 会计平台核心路径进行 WCAG 2.1 AA 合规性评估。核心路径：
1. 手工凭证（JE）创建与审批
2. AP/AR 发票与付款工作流
3. 期间关账
4. 银行对账
5. COA 科目表维护

## 2. WCAG 2.1 AA 检查项

### 2.1 感知性（Perceivable）

| 标准 | 要求 | 当前状态 | 优先级 |
|---|---|---|---|
| 1.1.1 非文本内容 | 图标/状态徽章有 aria-label | 未确认 | P1 |
| 1.3.1 信息与关系 | 表单使用 `<label for>` 关联 | 未确认 | P1 |
| 1.3.2 有意义的顺序 | DOM 顺序与视觉顺序一致 | 未确认 | P2 |
| 1.4.3 对比度（AA） | 文本对比度 ≥ 4.5:1 | 未确认 | P1 |
| 1.4.4 调整文字大小 | 200% 缩放不破坏布局 | 未确认 | P2 |
| 1.4.11 非文本对比度 | 表单边框/图标 ≥ 3:1 | 未确认 | P2 |

### 2.2 可操作性（Operable）

| 标准 | 要求 | 当前状态 | 优先级 |
|---|---|---|---|
| 2.1.1 键盘可达 | 所有功能可纯键盘操作 | 未确认 | P0 |
| 2.1.2 无键盘陷阱 | Tab 可离开任何组件 | 未确认 | P0 |
| 2.4.3 焦点顺序 | 焦点顺序有意义 | 未确认 | P1 |
| 2.4.7 可见焦点 | 焦点指示器清晰可见 | 未确认 | P1 |

### 2.3 可理解性（Understandable）

| 标准 | 要求 | 当前状态 | 优先级 |
|---|---|---|---|
| 3.3.1 错误识别 | 错误字段有文字说明 | 部分实现（422 映射不完整） | P1 |
| 3.3.2 标签与指令 | 表单字段有明确标签 | 未确认 | P1 |
| 3.3.3 错误建议 | 错误提示给出修复建议 | 未实现 | P2 |

### 2.4 健壮性（Robust）

| 标准 | 要求 | 当前状态 | 优先级 |
|---|---|---|---|
| 4.1.1 解析 | HTML 结构合法 | React 产出通常合法 | P2 |
| 4.1.2 名称/角色/值 | 交互组件有 ARIA 角色 | 未确认 | P1 |
| 4.1.3 状态消息 | 操作成功/失败提示可被辅助技术读取 | 需 aria-live | P1 |

## 3. 核心路径键盘操作验证清单

### JE 创建表单

- [ ] Tab 顺序：期间→日期→科目→金额→成员→行添加→附件→提交
- [ ] Enter 在行内字段不提交整个表单
- [ ] Escape 取消并不丢失已填数据
- [ ] 借贷行的增加/删除通过 `Ctrl+Enter` / `Delete` 键触发
- [ ] 附件上传可通过 `Space` 触发

### 弹窗/抽屉

- [ ] 打开弹窗时焦点移入弹窗
- [ ] `Escape` 关闭弹窗且焦点回到触发元素
- [ ] 弹窗内焦点不逃逸（focus trap）

### 数据表格

- [ ] 表格行可键盘导航（方向键）
- [ ] 排序/筛选可键盘操作
- [ ] 分页 `Prev`/`Next` 可键盘操作

## 4. 高优先级修复（立即可落地）

1. **所有图标按钮添加 aria-label**:
   ```tsx
   // 当前
   <Button><Icon name="check" /></Button>
   // 修复
   <Button aria-label="审批通过"><Icon name="check" /></Button>
   ```

2. **表单错误消息关联字段**:
   ```tsx
   <input id="amount" aria-describedby="amount-error" />
   <span id="amount-error" role="alert">金额格式错误</span>
   ```

3. **成功/失败通知使用 aria-live**:
   ```tsx
   <div role="status" aria-live="polite" aria-atomic="true">
     {message}
   </div>
   ```

4. **焦点可见性强化**:
   ```css
   :focus-visible {
     outline: 2px solid #0066cc;
     outline-offset: 2px;
   }
   ```

## 5. 自动化检查集成

### 建议工具

- **axe-core** + `@axe-core/react`：开发时实时检查
- **jest-axe**：测试套件中添加 `await axe(container)` 断言
- **Playwright** + `@axe-playwright`：E2E 无障碍检查

### 示例测试

```typescript
// 在每个 authoritative-*.test.jsx 中添加
import { axe } from 'jest-axe';
it('has no accessibility violations', async () => {
  const { container } = render(<JournalWorkspace />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## 6. 屏幕阅读器优先测试路径

优先保证以下路径对 NVDA(Windows) / VoiceOver(Mac) 可用：
1. JE 创建 → 提交 → 成功确认
2. 查看待审批列表 → 审批操作
3. 查看期间余额报表

## 7. Owner 决策缺口（D-Q06-x）

| ID | 问题 |
|---|---|
| D-Q06-1 | 无障碍合规是否有法规要求（如中国国标 GB/T 37668 或 WCAG 2.1 AA）？ |
| D-Q06-2 | 是否需要为视觉障碍用户设计高对比度主题？ |
