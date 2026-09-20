# 课后关切保护性交接服务

本项目面向课后活动导师和学校保护工作负责人，用于在学生表达潜在安全关切时完成及时、克制且可追溯的责任交接。

系统需要区分原始事实、待核实信息和已经采取的措施，同时限制敏感内容的传播范围。

## 设计红线

- **系统不下结论**：风险规则只决定"多快必须有人接管、谁可以看"，不推断学生处境、不给家庭贴标签（有单元测试固化该不变量）。
- **最小知情**：响应按角色裁剪；匿名咨询屏蔽记录者身份；普通活动老师不接触调查细节。
- **每次披露都留痕**：对象与理由必填，责任视图可审计。

## 运行

```bash
npm install
npm run start:dev        # 开发启动（ts-node），默认端口 3000
npm run build && npm start
npm test                 # 单元测试（风险规则）
npm run test:e2e         # 端到端场景（17 个，含全部自动化场景）
```

存储为 SQLite（sql.js，WASM 实现，无需原生编译）。默认落盘 `data/safeguarding.sqlite`，可用 `SQLITE_PATH` 覆盖；`SQLITE_IN_MEMORY=1` 使用纯内存库（测试用）；`ESCALATION_SCAN_DISABLED=1` 关闭定时升级扫描（测试手动触发）。

## 角色与种子账号

演示环境通过 `x-user-id` 请求头识别身份（生产应替换为正式 SSO）：

| id | 姓名 | 角色 | 班级范围 |
|---|---|---|---|
| `u-mentor-a` / `u-mentor-b` | 导师甲/乙 | `activity_mentor` 课后活动导师 | A / B |
| `u-lead` | 保护负责人 | `safeguarding_lead`（升级链 L1） | — |
| `u-senior` | 校长 | `senior_lead`（升级链 L2） | — |
| `u-ext-b` | 驻校社工(B班) | `external_professional`（L3 / 转交对象） | B |

## 核心流程

1. **记录**：导师 `POST /concerns` 提交学生原话、事发时间、现场安全情况、已采取的最小措施。
2. **分级**：风险规则给出等级 → 接管时限与可见角色（critical 15 分钟 / high 60 分钟 / standard 24 小时 / low 72 小时；匿名咨询访问范围收窄为保护负责人）。
3. **接管**：系统生成待接管指派，接管人必须 `POST /concerns/:id/acknowledge` 确认收到。
4. **升级**：超时未确认，沿 保护负责人 → 高级负责人 → 专业人员 逐级升级，每级向下一级披露摘要并登记理由。
5. **跟进**：补充信息进入同一关切的连续时间线；保护负责人可核实/证伪事实、写调查笔记（仅链路可见）、向记录者指派动作。
6. **转交**：`POST /concerns/:id/transfer` 必须明确移交内容与责任，接收方确认后责任才转移；跨班自动识别。
7. **合并/拆分**：保护负责人可合并相关线索（须填依据）；误合并拆分须填拆分依据，合并与拆分记录永久保留。
8. **结案**：`POST /concerns/:id/close`。

## API 一览

| 方法/路径 | 说明 | 角色 |
|---|---|---|
| `POST /concerns` | 登记关切（可附匿名联系方式） | 全体教职工 |
| `GET /concerns/mine` | 我的提交 + 必须执行的动作 | 记录者 |
| `GET /concerns/inbox` | 指派给我的 + 我可见的未结关切 | 保护链路/专业人员 |
| `GET /concerns/:id` | 按角色裁剪的关切视图 | 视权限 |
| `GET /concerns/:id/responsibility` | 责任视图：谁在接管、何时到期、未核实事实、披露记录 | 保护链路 |
| `POST /concerns/:id/entries` | 补充信息（连续时间线） | 记录者/链路 |
| `POST /concerns/:id/notes` | 调查笔记（仅链路可见） | 保护链路 |
| `POST /concerns/entries/:entryId/verify` | 核实/证伪一条补充 | 保护链路 |
| `POST /concerns/:id/action-requests` | 要求记录者执行动作 | 保护链路 |
| `POST /concerns/entries/:entryId/complete` | 完成动作 | 被指派人 |
| `POST /concerns/:id/acknowledge` | 接管人确认收到 | 当前被指派人 |
| `POST /concerns/:id/contact` · `DELETE` | 登记 / 撤回匿名联系方式（撤回即擦除） | 记录者本人 |
| `POST /concerns/:id/transfer` | 转交（内容+责任必填） | 保护链路 |
| `GET /transfers/incoming` · `POST /transfers/:id/accept` · `decline` | 接收方处理转交 | 接收人 |
| `POST /concerns/:id/merge` · `split` · `GET /concerns/:id/merges` | 合并 / 拆分 / 审计历史 | 保护链路 |
| `POST /concerns/:id/disclosures` | 登记对系统外的披露 | 保护链路 |
| `POST /concerns/:id/close` | 结案 | 保护链路 |

## 访问控制矩阵

| 数据 | 记录者 | 其他活动老师 | 保护负责人/高级负责人 | 被转交专业人员 |
|---|---|---|---|---|
| 自己提交的事实与状态 | ✓ | — | ✓ | 转交范围内 |
| 调查笔记 | — | — | ✓ | — |
| 未核实事实清单 | — | — | ✓ | — |
| 披露记录/责任视图 | — | — | ✓ | — |
| 匿名咨询记录者身份 | 本人 | — | 屏蔽 | 屏蔽 |
| 匿名联系方式内容 | 本人登记/撤回 | — | 仅知"已提供/已撤回" | — |

## 自动化场景（e2e 覆盖）

- **重复报告**：同一学生、24 小时窗口内的未结关切自动标记疑似重复并交叉链接时间线；合并与否由保护负责人决定，合并前两条各自保持待接管（安全优先）。
- **跨班转交**：接收人班级范围与关切班级不同 → 自动标记 `crossClass` 并以该理由登记披露。
- **撤回联系方式**：记录者撤回后内容立即擦除，仅保留"曾提供、已撤回"事实并写入时间线。

## 目录结构

```
src/
  access/        按角色裁剪响应（记录者/保护链路/被转交人三种视角）
  auth/          x-user-id 身份识别守卫（演示用）
  concerns/      关切、连续时间线、匿名联系渠道、重复报告检测
  disclosures/   披露登记（对象+理由）
  merges/        线索合并/拆分（拆分依据永久保留）
  risk/          风险规则（只产出处置参数）
  takeover/      接管指派、确认、逐级升级（30s 定时扫描）
  transfers/     转交（内容+责任，接收方确认生效）
  users/         员工账号与种子数据
test/            e2e：17 个场景覆盖上述全部流程
```
