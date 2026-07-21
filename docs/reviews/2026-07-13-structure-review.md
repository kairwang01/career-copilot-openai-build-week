# 代码结构审查报告（2026-07-13）

> 审查范围：`dev` 分支 @ `4c19cbd` + 多智能体施工中的当前工作区。2026-07-13 19:39 EDT 快照为 200 个 tracked 状态项和 105 个 untracked 顶层状态项；该数字持续变化，不能作为最终门禁。
> 审查方式：静态阅读 + git 历史分析。系统 PATH 未配置 Node.js；协调器已使用 workspace bundled Node 运行分阶段测试，但本结构审查者没有执行测试。最终结论必须以后续统一门禁为准。

## 一、总体评价

工程化水位显著高于同类课程/团队项目：快照时有 139 个 vitest 测试文件、Playwright E2E、13 个 `smoke:*` 模拟器脚本、负载测试、AI 质量评测（M7/M8）、部署检查清单与回滚 runbook；近期新增的安全加固（SSRF 防护、safeHttpsTransport、自定义 Provider 密钥存储、账号删除、PII 脱敏测试）方向正确。主要债务集中在**前端超大组件**与**一次性巨型未提交变更**两处。

## 二、优先级问题清单

### P0 — 大型跨主题未提交工作区应在审查后拆分落库
当前工作区堆积了 Stripe 计费、admin 门户、7 语言 i18n、安全加固和大量新测试等多主题变更。风险：无法回滚单一主题、review 困难、与 upstream/dev 漂移扩大。施工期状态数量只是一张快照；提交前应以最终 `git status` 和逐主题 diff 重新核对。
建议按主题拆为 5–7 个提交（顺序）：
1. `feat(billing)`: functions/src/billing/ + stripeBilling.ts + 相关测试
2. `feat(admin)`: adminPortal/adminModels/userReportProjection + UI
3. `feat(security)`: safeHttpsTransport / customProviderStore / accountDeletion / secureRandomId + SSRF 测试
4. `i18n`: localization/ + public/localization/（成对同步，prebuild 已有 --check 守门）
5. `test`: 其余新增测试
6. `docs/chore`: docs/meetings、scripts

### P1 — 前端"上帝组件"拆分（体量 Top 6）
| 文件 | 行数 | 建议 |
|---|---:|---|
| components/admin/AdminPortal.tsx | 5,611 | 按 tab 拆到 `components/admin/pages/*`，共享状态提为 context/hook；AGENTS.md 里 ADMIN_TAB_HELP 的同步义务改为每页自带 help 元数据 |
| components/AgencyHub.tsx | 2,994 | 按业务区块拆分 + 数据获取下沉自定义 hook |
| components/ApplicantFunnel.tsx | 2,975 | 漏斗各阶段列表/操作各自成组件 |
| components/InterviewSimulator.tsx | 2,142 | 会话状态机提取为 hook，UI 与状态分离 |
| CareerApp.tsx | 1,922 | 路由/布局骨架化，页面懒加载 |
| functions/src/handlers/adminPortal.ts | 1,797 | 按资源域拆 handler 模块，共用 schema 已在 admin/schema.ts，保持 |

拆分务必在测试绿色基线上小步进行（每次一个组件、跑 `vitest run` + 相应 smoke）。

### P2 — 行尾符规范
仓库以 LF 入库、Windows 工作区触发全量 CRLF 警告（每次 git 操作刷屏，diff 噪声风险）。本轮已新增 `.gitattributes`，以下仅为核心规则摘录（完整规则见仓库根文件）：
```
* text=auto eol=lf
*.png binary
*.pptx binary
*.docx binary
```
由于当前工作区包含大量用户/代理变更，本轮没有执行全仓库 renormalize，避免把机械行尾改动混入功能审查。待工作区按主题落库后，再在独立审查提交中执行并验证 `git add --renormalize .`。

### P3 — 其他
- `localization/` 与 `public/localization/` 成对重复是同步脚本的产物，prebuild 有 `--check` 守门，可接受；建议在 README 标注"public 侧为生成物，勿手改"。
- `docs/meetings/*.pptx`、`docs/reflections/*.docx` 等二进制课程材料入库会持续膨胀仓库，建议移至 Release 附件或 LFS。
- evals/resume-eval-set.json 标注样本仅 5 条，M7/M8 数字对外表述时应注明"小样本、干跑管线验证"。

## 三、近期变更主题速览（HEAD 快照累计 684 commits）
- LLM API Gateway：按模块分组的路由池、密钥 pinning、多模态请求仅路由多模态模型、退役模型 404 统一错误分类救援
- 计费：Stripe sandbox checkout、积分/配额、月度授信
- 质量门：服务端二次审稿（second-pass review）后才展示草稿
- i18n：7 语言架构（ar/de/en/fr/ja/vi/zh）；营销/内部 claim 与新增 preview/tool-card keys 在本轮施工中，只有最终 source/public 镜像和 localization gate 全绿后才能称为全量本地化
- 安全/合规：SSRF 防护、密钥服务端化、账号删除流、隐私同意、PII 脱敏
