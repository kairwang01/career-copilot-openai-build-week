# Career CoPilot 上线准备终审报告（2026-07-13）

> 结论：**本轮源码审查与可自主完成的修复已完成。最近一次完整 source release gate 和 production-shaped build 均已通过；其后静态终审又关闭了退款计数器下溢、异常计数持久复核、stub primitive 边界及 CI smoke 进程清理问题。应用户要求，这批最后静态补丁不再本地复跑测试，不能冒充“当前最终树已全绿”。远端 CI 已证明 Rules 88/88、callables 184/184 和 static/source job 全绿，并暴露出 CI 浏览器安装、Firebase Admin Timestamp 运行时调用、过时 E2E 契约及测试 LLM stub 不遵守结构化输出 schema；这些问题均已按真实失败链修复。2026-07-14 已对 `f548592` 完成补充复验（见 §8.1）：本地复跑 source 门禁等价项发现并修复 1 个单测回归；CI 首次完整跑完的 emulator gate 暴露 web3-preview/resume-preview 两个 smoke 契约缺陷，均已按根因修复。正式上线仍为 NO-GO，等待受授权的真实 Firebase、生产运营和真人设备证据。**
>
> 审查对象：`dev` 分支、团队远端 `upstream=https://github.com/abhishek-ip/Career-CoPilot-uOttawa.git`、本地当前工作区。审查时基线 `HEAD=4c19cbd4582524f24dd4e56ec77245a7cb8d98b0`；已推送的加固提交为 `118a376`、工作流修正为 `4696b8d`、首轮精确 CI 回归修复为 `1e2c1ee`、后续门禁修复为 `b781f52`。报告所在最终提交及其 CI 结果以 Git 历史、`upstream/dev` 和 GitHub Actions 记录为准。

## 1. 最终判定

| 判定面 | 状态 | 说明 |
|---|---|---|
| 源码级 P0/P1 修复 | **已修；最近一次全量回归通过** | 本轮已关闭发现的权限提升、业务角色自助升级/注册竞态、未验证邮箱越过后端、人才发现隐私、外联分页/滥用、计费/退款补偿丢失、密钥泄露、同意前上传、危险脚本和发布假绿等高风险代码缺陷；当前未发现新的、可在源码内直接关闭的 P0/P1。最后静态补丁按用户要求未复跑。 |
| 本地 source release gate | **最近一次 PASS；最后静态补丁未复跑** | 在最后的 smoke 清理与计数器健壮性补丁前，localization 7 locales、localization tests 4/4、API docs 同步、functional bug scan、Stripe env check、根项目/Functions TypeScript、141 files / 922 tests 的全量 pure unit 和两套依赖审计均已完成。 |
| Production-shaped build | **最近一次 PASS；最后静态补丁未复跑** | 使用与 CI 相同形状的 synthetic public Firebase 配置完成 Vite build：3,607 modules、12.47s、0 source maps；9050 静态服务的 `/`、`/workspace`、`/pricing`、`/privacy` 均返回 200 和 CSP。该 synthetic 配置仅用于构建验证，不可部署。 |
| Firebase/Rules/Callable 集成 | **CI 隔离合同已通过；真实 Firebase 仍待上线门禁** | 本机没有 Java/Firebase CLI，未启动本地 emulator；GitHub Actions `1e2c1ee` 已实测 Firestore/Storage Rules 88/88、23 个 callable 文件 184/184。该结果是隔离回归覆盖，不等于生产 Rules/Indexes/TTL/Functions 已部署；正式上线仍以真实 Firebase 状态和 live smoke 为准。 |
| 真实 Stripe/签名 webhook | **未执行，NO-GO** | 代码和 fail-closed 证据门禁已落盘，但本轮没有真实 live Price、Secret Manager、签名 webhook 首次投递/重放证据。 |
| 事务邮件/域名 DNS | **未执行，NO-GO** | 验证邮件和密码重置是客户硬依赖；未取得永久域名、SPF/DKIM/DMARC、真实消费/企业邮箱矩阵证据。 |
| 生产数据迁移/TTL/Storage IAM | **未执行，NO-GO** | BYOA 密钥迁移、API 使用日志/汇总回填、索引 READY、TTL、Storage Rules 跨服务 IAM 与角色 smoke 均须在生产变更窗执行。 |
| 浏览器/真实设备 | **CI 精确回归已修，最终复验与真人设备仍待完成，NO-GO** | 最新构建在 9050 的四条关键路由均为 200+CSP；CI `b781f52` 已把 Admin Shared Credentials、Web3 `eligible → confirm → issued` 和 artifact smoke 跑绿（3/4），唯一失败是测试 stub 违反简历 schema 后后端正确退款，非页面或 Firebase 扣费缺陷；stub 与 happy-path 成功证明均已加固。本地 in-app Browser 仍受 `Cannot redefine property: process` 阻塞，真人多设备走查仍是外部门禁。 |
| 正式部署 | **未执行** | 没有把本轮结果描述成“live production”；当前状态是“等待正式上线”。 |

当前没有发现新的、已知且可在源码内自主关闭的 P0/P1；源码施工可标记完成，候选可按用户指示在不追加本地测试的情况下提交并推送。它不等于已部署或可立即接入正式客户流量：真实 Stripe/邮件/Firebase 配置、组织审核和真人多设备走查仍须通过第 9 节的授权外部门禁。

## 2. 开场实测、远端同步与工作区边界

### 2.1 环境与磁盘实测

- Bundled Node：`v24.14.0`；项目声明并在 CI 固定 Node `22.x`。
- Git：`2.53.0.windows.3`。
- Java：PATH 实测不存在。
- Firebase CLI：PATH 实测不存在。
- 磁盘上的 `dist` 由最后一轮完整门禁时的终审源码构建；其后补丁未重新构建。该构建使用 CI synthetic public Firebase 配置，只作为当时的 production-shaped bundling 证据，不是可部署的生产配置。产物 source map 数为 0。
- 本地 9050 静态服务对 `/`、`/workspace`、`/pricing`、`/privacy` 均返回 200 并带 CSP；这证明静态 artifact 可服务，不等于浏览器交互、身份、支付或真实设备 QA 已通过。

### 2.2 Git 与远端

- 团队远端：`upstream https://github.com/abhishek-ip/Career-CoPilot-uOttawa.git`。
- 个人备份：`origin https://github.com/kairwang01/UO_ELG_5902_career-copilot.git`。
- 当前分支：`dev`，跟踪 `upstream/dev`。
- 协调板记录已实际 fetch 并 fast-forward 到 `4c19cbd`；审查时 `rev-list --left-right --count HEAD...upstream/dev` 为 `0 0`。
- 本轮保留了用户原有 `AGENTS.md`、会议材料和 `docs/reflections/`；没有 clean/reset 丢弃用户文件。
- 终审前工作区快照为 230 个 tracked diff 文件、151 个 untracked 文件、362 条 status；tracked diff 约 21,793 行新增、8,445 行删除。它是多人审查施工快照，不是单一作者或单一功能的变更量。

## 3. 项目结构与运行时接线

当前排除依赖、构建和 coverage 后约 645 个项目文件，其中测试 157、组件 118、Functions 96、`lib` 55、marketing 50、docs 35、scripts 34。

| 层 | 主要入口/目录 | 实际职责与接线 |
|---|---|---|
| Web 入口 | `index.tsx`、`marketing/SiteApp.tsx`、`marketing/SiteRouter.tsx` | 装配营销 i18n、会话、结算、错误/状态 provider；路由到公开页、工作区、企业门户与 admin。 |
| 候选人/企业应用 | `CareerApp.tsx`、`components/dashboard/**`、`components/employer/**` | 候选人 workspace、企业 portal、agency 流程；大页面按路由和工具 lazy load。 |
| Admin | `components/admin/AdminPortal.tsx`、`services/adminClient.ts` | `super/admin/reviewer` 客户端可见性；服务端 callable 仍是最终授权边界。`ADMIN_TAB_HELP` 已同步复核。 |
| 工具层 | `components/ToolRunner.tsx`、`components/tools/**`、`services/aiClient.ts` | ToolRunner 注册并挂载工具；前端生成 request ID、取消/去重，服务端执行验证、计费、模型调用和结果边界。 |
| Functions | `functions/src/index.ts`、`functions/src/handlers/**` | callable、HTTP、schedule 与 Firestore triggers 的部署入口；发布前由显式 target 清单验证 export。 |
| 计费/权限 | `functions/src/billing/**`、`functions/src/credits/**`、`lib/access/**` | 套餐精确 entitlement、配额/积分事务、checkout intent、webhook ledger、客户端可见性映射。 |
| 数据与安全规则 | `firestore.rules`、`storage.rules`、`firestore.indexes.json` | 客户端最小权限、上传路径/MIME/大小、查询索引和 TTL；Admin SDK/生产 IAM 是另一层边界。 |
| 本地化 | `localization/*.json`、`public/localization/*.json`、`scripts/sync-localization.mjs` | 七语言 canonical source 与 public generated mirror；构建前执行 parity check。 |
| 发布/运维 | `scripts/run-release-gate.mjs`、`.github/workflows/ci.yml`、`docs/deployment/README.md` | source/emulator/browser/artifact/all 分阶段门禁、证据脱敏、批准 SHA、build-once artifact、迁移/回滚顺序。 |

关键新增能力均完成了“谁创建、谁装配、运行时如何证明”的接线复核；详细证据保存在 `.agents/asks/*.md`。

## 4. 全量文档阅读证明

文档审查采用两套互补口径，避免文本和 Office 二进制互相漏项。

### 4.1 文本型文档

- `.agents/asks/docs-full-reconciliation.md` 逐文件读取审查冻结点的 **100/100** 个 `md/mdx/txt/rst/adoc` 文档，共 **15,634 行 / 893,545 bytes**。
- 范围包含 `.agents`、`.claude`、`.workbuddy`、根目录、`docs/**`、`marketing/**`、`functions` 契约、`loadtest`、`evals`、公开 API 文档及被忽略的 `repo-context.md`。
- 原审查后又增加了 resume contract/follow-up、auth email、cross-tab、release gate 等 handoff；这些新增材料已在终审中逐份消费。这里保留冻结点的可复核计数，不把之后持续变化的文档总数伪装成最终静态数字。
- `.agents/asks/docs-full-reconciliation.md` 还提供逐文件行数和 SHA-256 前缀，能反虚报“已读”。

### 4.2 Office 与其他交付文档

- `.agents/asks/docs-handoff.md` 按交付清单完成 **48/48** 项阅读。
- 5 个 DOCX：提取正文、表格、页眉/页脚、批注/脚注/尾注、媒体关系，并逐页渲染检查，共 **31 页**。
- 2 个 PPTX：提取全部幻灯片文本、表格、图表、备注和链接，并逐页渲染检查，共 **23 页**。
- 这些 Office 文件在最终审查期间未被修改，因此既有逐页结论仍适用。

### 4.3 文档中仍需归档而非当作上线事实的内容

- `docs/reflections/Website-Content.md`、`Final-Report.md`、`Final-Presentation-Scripts.md` 中的 `launch-ready/live production/every deploy` 属于历史学术叙事，不是本次发布授权。
- 最终报告/网站稿仍有 `INSERT-SHARED-EDIT-LINK-HERE`、`INSERT-VIDEO-EMBED-HERE`；Sprint PPTX 第 2、3 页实质空白。
- 历史 QA、负载基线、AI eval 和课程指标只能作为带日期快照，不能替代当前门禁。
- 当前权威顺序是：磁盘代码/配置/生产证据 → `AGENTS.md`/DECISIONS/最新 handoff → `docs/deployment/README.md`/deploy checklist → 代码旁契约 → 历史材料。

## 5. UI、响应式、可访问性与用户诚信

状态含义：`已修` 表示代码已落盘；绝大多数修复纳入最近一次全量 pure unit/source gate，最后静态补丁按用户要求未复跑并在第 8 节明确标注。`待外部验证` 表示代码已加固但仍需要真实 Firebase、浏览器/设备或生产服务；`开放债务` 不应被宣传为已完成。各行既有 focused 数字是定位过程证据，当前统一候选状态以第 8 节为准。

| ID / 状态 | 发现的问题与客户影响 | 修复方案及优化后代码 | 验证 |
|---|---|---|---|
| UI-01 已修 | 公开页脚显示“Beta 预览版”和 ELG 5902 团队署名，与用户要求和正式品牌状态冲突。 | `marketing/components/SiteFooter.tsx` 删除整个渲染块；七个 `localization/*.json` 与 public mirrors 删除 `footer_beta_notice`、`footer_academic_credit`，不是置空或只改中文。 | 最新 runtime source 与 `dist` 精确扫描均 **0 命中**；测试/E2E 中保留原句作为 negative regression sentinel，只用于防回归，不会渲染。 |
| UI-02 已修 | Unsplash 远程图在 CSP 下会失败；虚构姓名、库存头像和第一人称引语会被误解为客户证言。 | `JobseekerHomePage.tsx`、`marketing/mock/successStories.ts`、`UserVoices.tsx` 删除远程资产/人物证言，改为明确标注的 fictional workflow scenarios。 | `images.unsplash.com` 与四个虚构姓名运行时扫描为 0；25/25 marketing trust tests。 |
| UI-03 已修 | 示例分数、案例、招聘结果、ATS/面试/职位新鲜度等文案过度承诺。 | 七语言 133+ claim-bearing keys 改为“示例、需复核、配置依赖、非保证”；`FeatureShowcase`/`ToolLibrary` 80 个动态 key 全部有真实翻译。 | claim suites、mirror parity、动态 key 提取测试通过；已删除 100k 题库/预测准确率等无证据主张。 |
| UI-04 已修，待真机 | 320×568 时 cookie consent 覆盖登录框，按钮/字段不可达。 | `CookieConsent.tsx` 写 `--cookie-consent-top-space/bottom-space`；`ViewportAwareDialog.tsx` 在可视视口计算中消费保留空间，保持内部滚动/焦点约束。 | 纯布局回归证明 320×568 不相交；真实浏览器因插件故障尚未复验。 |
| UI-05 已修，待真机 | Admin 登录页在窄屏先展示大段营销 rail，表单下沉；焦点/错误关联不完整。 | `AdminAuthLayout.tsx` 在 `lg` 以下压缩 rail、表单 top-align；`AdminSignIn.tsx` 增加焦点移交、36/44px 目标、`aria-invalid/describedby/busy`。 | `adminAuthMobile.test.ts` 3/3；需 320×568 实际滚动/键盘复验。 |
| UI-06 已修 | 多个 modal 声明 `aria-modal` 却没有完整 focus entry/trap/restore/Escape。 | 复用 `ViewportAwareDialog`，为 Auth、Interview、Career Coach、Workspace Tour 和关键确认框统一焦点/顶层语义。 | modal/accessibility contract tests；实际 screen-reader walkthrough 仍待外部。 |
| UI-07 已修 | Auth、消息、onboarding、company review、Talent Discovery 等表单依赖 placeholder、无 label/live error，窄屏按钮溢出。 | `ApplicationMessageThread.tsx`、`OnboardingFlow.tsx`、`CompanyReviewModal.tsx`、`TalentDiscovery.tsx` 等增加 label/fieldset/radio/status/alert、原生约束、mobile stacking 与长词换行。 | 相关 accessibility tests、locale parity、typecheck 通过。 |
| UI-08 已修，待真机 | Interview Simulator 大量英文旁路、无字段组语义、免责声明是假 modal、RTL/窄屏错序、speech 错误暴露原始代码。 | `InterviewSimulator.tsx` 七语言化，使用 fieldset/legend、shared dialog、logical CSS、移动端内容顺序、localized speech guidance、timer/progress/status semantics。 | focused 9/9 + typecheck；320/390、German、Arabic、keyboard 和打印仍待浏览器。 |
| UI-09 已修 | 自定义 LanguageSwitcher 键盘/ID 不完整；Talent Profile 大量硬编码、重复 ID、accordion/错误状态不完整。 | `LanguageSwitcher.tsx` 改用带 `useId` 的原生 select；`TalentProfileForm.tsx` schema 文案本地化、instance-scoped IDs、region/accordion、bounded dialog 和 mobile layout。 | 9/9、7 locale check、根 tsc。 |
| UI-10 已修，待真机 | 九个工具信任 AI/saved JSON、长字符串溢出、触控目标小、错误页阻止编辑。 | `IndustryEventScout`、`SalaryNegotiator`、`LinkedInOptimizer`、`NetworkingAssistant`、`PerformanceReviewPrep`、`SkillLearningPlanner`、`EmailCrafter`、`CoverLetterGenerator`、`InterviewPrep` 做结构化 normalize、数组/字符串上限、safe URL、editable retry、44px targets、anywhere wrapping。 | 7 files / 49 tests；authenticated phone/tablet/desktop 工具遍历仍待外部。 |
| UI-11 已修 | 非 mock 工具被 `max-w-4xl` 限制，而内部 `xl:` sidebar 需要更宽，桌面错位/拥挤。 | `components/AnalysisDisplay.tsx` 工具容器提升到 `max-w-7xl`，mock interview 保持独立宽度。 | `toolWorkspaceWidth.test.ts` 通过。 |
| UI-12 已修 | 公司评价只加载首屏、失败被伪装为空、总数可能显示 0、重复翻页请求。 | `BrowseJobs.tsx` 接入 `listCompanyReviewsPage`，按 employer 缓存分页元数据、in-flight 去重、明确 retry、loaded/total/truncated。 | 3 files / 10 tests。 |
| UI-13 已修 | Firebase persisted session 恢复前瞬时 null，可能闪登录页/错误触发 signed-in transition。 | `SessionContext.tsx`、`firebaseDataClient.ts` 等等待 auth settle，收敛 profile hydration 与错误状态。 | session hydration/transition tests 通过。 |
| UI-14 已修 | Recent applications 无界 N+1，失败伪装“无申请”。 | 新增 `listRecentApplications` callable、`recentApplicationsClient.ts`，有界查询/投影/显式 error+retry；hook 不再吞错误。 | pure contract tests 通过；Firestore callable 待 emulator。 |
| UI-15 已修 | Pricing/sample/marketing 在 zh/ar 等语言混入英文，动态 key 缺失会原样 fallback。 | 所有 canonical locale 和 public mirror 同步；pricing、sample report、FeatureShowcase、ToolLibrary 等改为 key 驱动。 | 七语言 sync/check、key count/parity 和 claim suites 通过。 |
| UI-16 已修 | Pricing CTA 丢失商品选择；URL 若直接触发 checkout 会产生非自愿支付；币种含糊。 | `marketing/lib/pricingAudience.ts` + `lib/pricingIntent.ts` allowlist；登录/验证/onboarding 后只“预选 + 再确认”；所有价格显式 CAD；未实现的 `single_post/job_pack` 从公开卡移除。 | pricing intent 5 files / 42 tests；URL effect 静态断言无 checkout mutation。 |
| UI-17 已修 | Privacy 的 inline reset script 被生产 CSP 拦截。 | 移到 same-origin `public/privacy-consent-reset.js`，保留 live status；security test 递归拒绝未授权 inline scripts。 | hosting/privacy 2 files / 6 tests；`node --check` 通过。 |
| UI-18 部分已修 | Arabic 设置 `dir=rtl`，但历史代码有大量 physical left/right utilities。 | 本轮在 Interview、Talent、表单、关键对话框改用 `text-start/end`、`ps/pe`、`border-s/e`；未做全仓机械替换。 | 关键 source contracts 通过；全产品 Arabic screenshot/keyboard 仍是外部门禁。 |
| UI-19 已修 | 默认 submit button、危险外链、Web3 无效地址、被浏览器拦截的 print window 会造成误操作/假链接/静默失败。 | button type sweep；`lib/safeUrl.ts` 只允许规范 HTTP(S)；`lib/web3Links.ts` fail closed；打印/新窗口错误可见。 | button/safeUrl/web3/portfolio tests 通过。 |
| UI-20 已修 | robots/sitemap/canonical/privacy 可索引与实际路由漂移，营销 metadata 有过度承诺。 | `SiteSeo.tsx`、`index.html`、`public/sitemap.xml`、`public/privacy.html` 对齐 canonical origin、公开路由与诚实描述。 | SEO/public release contract tests + 静态 HEAD/route checks。 |
| UI-21 已修 | Admin reviewer 提示与权限表冲突；prompt audience 无法分类 agency/admin；generic failure 临时显示 admin。 | fail-closed role fallback；authoritative prompt audience helper；reviewer 文案/可见 tabs 对齐；`ADMIN_TAB_HELP` 同步 account deletion、billing development 状态和各角色能力。 | admin routing/audience/help/visibility tests 通过。 |
| UI-22 开放债务 | 四个工具仍有 **84** 处 `isChineseUi ? zh : en`，法/德/日/越/阿会回退英文。 | 路径：`PortfolioWebsiteBuilder.tsx` 27、`CoverLetterGenerator.tsx` 22、`EmailCrafter.tsx` 18、`IndustryEventScout.tsx` 17。应迁入 canonical locale keys 并同步 mirrors。 | 当前精确 `rg` 计数 84；不宣称七语言工具内部全部完成。 |
| UI-23 开放债务 | `FeatureShowcase.tsx` 仍用 div/CSS skeleton/conic-gradient 模拟产品预览；`public/og-cover.png` 是 2026-07-06 旧资产，未与当前 claim/UI 重新比对。 | 正式品牌验收应使用当前产品真实截图或批准的真实图像资产；替换后同时更新 OG regression。 | 本轮不伪称资产终审通过。 |
| UI-24 开放债务 | 最终 production-shaped artifact 仍有大 chunk：pdf worker 1.376MB、Firebase 544.08KB、Mammoth 502.15KB、entry 489.47KB、CareerApp 436.55KB、charts 377.89KB。 | 建立 route-level preload/brotli budget；继续拆分超大页面和重依赖，避免匿名首页预载 workspace 依赖。 | 3,607 modules / 12.47s / 0 source maps 已重测；当前主要是后续性能预算债务，不是功能正确性阻塞。 |
| UI-25 已修，待真机 | 未经组织审核的招聘方在职位卡和人才外联中看起来与已验证组织相同，候选人可能把自报身份误当平台背书。 | `BrowseJobs.tsx` 与 `SourcingConsentInbox.tsx` 对 `unverified_self_reported` 显示醒目的 amber 警告；`jobPostingNormalize.ts`、`sourcingOutreachData.ts` 对缺失/未知值 fail closed 为未验证。 | normalization/role provenance 合同已纳入 141 files / 922 tests；真实视觉/辅助技术走查仍待浏览器。 |
| UI-26 已修，待 emulator/真机 | 候选人接受人才外联后缺少持续可见的撤销入口，过期状态也可能在企业端继续显示为可打开；关闭人才发现曾被表单其他必填项阻断。 | `SourcingConsentInbox.tsx` 保留所有仍有效的 accepted 请求并提供 revoke；`TalentDiscovery.tsx` 只有 accepted 且未过期时开放冻结资料包；`TalentProfileForm.tsx` 的关闭操作改走独立最小写入，不再先验证整张资料表，失败时恢复开关并显示错误。 | UI/normalization/withdraw consent pure contracts 已纳入 source gate；accept/revoke/expiry 的 Firestore callable 测试仍需 emulator。 |
| UI-27 已修，待最终 CI/真机 | 1280px 工作区里的 consent banner 把正文挤成一词一行，形成高遮挡层并盖住 Web3 核心 CTA；这是 CI 失败截图直接暴露的真实视觉异常。 | `CookieConsent.tsx` 对 `avoidSidebar` 使用两行结构：正文独占可用宽度、操作区单独右对齐；平板使用左右安全边距，桌面宽度上限增至 42rem，按钮保持可操作且不挤压正文。 | Web3 E2E 在作出 consent 选择前断言宽度大于 560px、高度不超过 120px，再显式关闭横幅；最终远端 Chromium 与真人多语言视口仍须复验。 |
| UI-28 已修，待最终 CI | Web3 凭据 E2E 仍寻找旧的 `You Qualify / Mint my credential`，且遗漏确认对话框；即使真实 UI 已正确显示 `Eligible / Credential available / Issue credential`，门禁也会假红并跳过完整签发链。 | `Account.tsx` 为 wallet/network/credential 状态、资格卡、签发按钮和已签发卡增加稳定 `data-qa/data-state` 与 section heading 语义；E2E 改为验证 `eligible → enabled issue button → confirmation → issued`，不依赖易漂移文案或 `.first()`。 | CI 原始 accessibility tree 证明 seed 与资格计算正确；新 E2E 等待同一最终提交复验。 |
| UI-29 已修，待最终 CI | Admin 缺密钥告警虽能打开 Models & Keys，但目标 section ref 在 tab 挂载前不存在，页面可能停在 Model Registry；保存 shared credential 也缺少明确成功反馈。 | `AdminPortal.tsx` 在 AI tab refs 挂载后消费 `modelScrollTargetRef` 并滚动到 Shared Credentials；告警 CTA 直达真实编辑器，保存结果使用 `status/alert`，区块有稳定 QA 语义，`ADMIN_TAB_HELP` 同步更新。 | `adminRoutingContract` 固定创建/装配/运行证明；E2E 通过真实字段保存、输入清空、成功状态和 masked key 回读，等待最终 CI。 |

## 6. 工具、业务逻辑、安全与数据一致性

| ID / 状态 | 发现的问题与客户/业务影响 | 修复方案及优化后代码 | 验证 |
|---|---|---|---|
| BE-01 已修 | 任意 active billing 记录可能授权同受众任意付费计划。 | `functions/src/billing/entitlement.ts` 单源绑定 `active/status/plan/audience/mode`；月度积分和套餐选择使用 exact matcher。 | 纯 entitlement 10/10；emulator specs 已写、待执行。 |
| BE-02 已修 | AI 重试/双击可重复调用 provider、重复扣费；失败重放可能凭调用方金额退款。 | `claimMeteredToolRun/claimFreeToolRun/requireFreshToolRun` 在 provider 前持久 claim；refund 从原 usage event 读取金额并同事务写 deterministic refund event/ledger。 | 3 files / 12 focused pure tests；callable transaction 待 emulator。 |
| BE-03 已修 | 日限额/配额与扣费分开读写，并发可超额；free runs 也可竞态。 | quota reservation、usage claim、credit balance/ledger/event 收敛进 Firestore transaction；所有 AI handler 先 claim 后外部调用。 | concurrency contract/callable specs；真实 Firestore 待 emulator。 |
| BE-04 已修 | Active-job cap 先 count 后写，多个请求可同时越限。 | job posting create/update 在权威计数/租约事务中执行；请求字段和 role/plan 再验证。 | jobPosting tests 已扩展；emulator 待执行。 |
| BE-05 已修 | Stripe checkout 重试可创建多个 Session；旧订阅删除事件可撤销新订阅；webhook 重放缺持久 ledger。 | `billing_checkout_intents` + client operation ID + Stripe idempotencyKey；webhook event durable claim；subscription identity/version guard；invoice failure状态处理。 | 4 files / 17 pure tests，Stripe callable specs；真实 Stripe 待外部。 |
| BE-06 已修 | 删除账户后延迟 Checkout/webhook 可能重建 billing/profile/BYOA。 | `account_deletion_requests/{uid}` tombstone 在 checkout create、entitlement activation 和 credential store fail closed；删除前检查 recurring billing，retry 有 lease/checkpoint。 | account deletion/tombstone tests；真实 open Session reconciliation 仍需上线操作。 |
| BE-07 已修 | Admin user report 直接 spread `users/{uid}`，会泄漏 BYOA key、resume 和未来 PII。 | `functions/src/admin/userReportProjection.ts` 使用严格 allowlist；普通 admin 只收到 UI 所需 identity/role/plan/credit/created fields。 | redaction tests 2/2；全仓 raw spread 指纹清零。 |
| BE-08 已修 | Generic admin identity failure回退 admin；model/prompt/credit 调整有 split saga 或未审计重试。 | admin fail closed；model/prompt runtime+metadata 事务化；credit adjustment 单事务 + operation ID + audit；role permissions centralized。 | admin atomic/model/prompt/credit tests；emulator 路径待执行。 |
| BE-09 已修，待迁移 | BYOA raw key 存在 owner-readable `users/{uid}.custom_provider`。 | 新 canonical `private_custom_provider_configs/{uid}`，客户端 Rules deny-all；callable 只返回 masked projection；legacy transactionally lazy migrate/delete。 | 4 files / 20 tests；**生产 migration 未运行**。 |
| BE-10 已修 | 自定义 OpenAI-compatible base URL 可 SSRF/DNS rebinding 到 metadata/private networks。 | `safeHttpsTransport.ts` 强制 HTTPS/443、解析全部 DNS、拦 IPv4/IPv6 reserved、pin 已批准 IP、每次新连接、逐跳重验证 redirect、10MB cap。 | 3 files / 9 tests + Functions tsc。 |
| BE-11 已修但非完整擦除 | 旧 `adminDeleteUser` 只删 Auth 和 parent profile，遗留 shared/finance/Storage/Stripe；UI 可能称完整删除。 | durable cleanup manifest、billing/tombstone guard、private credential scrub；Admin UI 与 `ADMIN_TAB_HELP.users` 明示 access removal、retained items、not full erasure。 | deletion tests + UI copy tests。完整 retention/anonymization 仍待法务/产品。 |
| BE-12 已修 | Firestore client 可直接修改 server-owned fields/业务集合。 | `firestore.rules` deny direct business mutations、pin role/credits/subscription/created_at，owner-only PII，private config deny-all。 | rules source tests；实际 Rules emulator 未执行。 |
| BE-13 新增 P0 已修 | 浏览器可在 `users/{uid}` create 时自选 `role=employer/agency`，或伪造过去/未来 `created_at` 影响角色注册新鲜度判断。 | `firestore.rules` create 明确要求 `role == "candidate"`、`created_at` 为 server timestamp 且等于 `request.time`，并拒绝客户端创建 `organization_verified/role_provenance/role_provisioned_at`；这些信任字段之后也不可由 owner 修改。 | source contracts 纳入 922 个 pure tests；candidate allow、employer/agency/future timestamp deny 的 Rules cases 已写，因本机无 Java 尚未运行 emulator。 |
| BE-14 已修，待 IAM | Storage 原规则边界不足，可能跨用户读写、MIME/扩展错配、嵌套逃逸。 | `storage.rules` 按 owner/product role/path shape/MIME/extension/size fail closed；application snapshot 冻结；unknown path deny。 | 26 logical Rules cases已写；生产 Storage service-agent IAM 和 emulator 未执行。 |
| BE-15 已修 | Cookie“拒绝”只是 UI；Sentry/Stripe 可在同意前 import/初始化。 | `lib/consent.ts` 单源 unknown/accepted/declined；Sentry consent 后 dynamic import；Stripe 用 `@stripe/stripe-js/pure`，只在显式 checkout 动作加载。 | consent integration tests；网络级浏览器验证待外部。 |
| BE-16 已修 | onboarding 在用户同意前上传原始 resume；skip/profile 失败可能留 orphan PII。 | file 保持内存；同意后 commit；上传成功但 profile 失败回滚对象；in-flight/retry 去重。 | onboarding resume commit tests；Storage emulator 待执行。 |
| BE-17 已修 | Password reset action 页面验证 code 后无设置密码表单；mode 与 action code operation 可错配；continue URL 可被滥用。 | `completeAuthAction.ts` 绑定 operation；`AuthActionPage.tsx` 调 `confirmPasswordReset`、清 query；canonical ActionCodeSettings；adapter 保留网络/配置错误。 | auth 7 files / 42 tests；真实邮件未执行。 |
| BE-18 已修，有浏览器边界 | 多 tab 可同时发 verification email；same-realm Promise 不能协调独立 JS realm。 | UID-scoped Web Locks exclusive + accepted-state re-read；localStorage pending lease fallback/expiry/owner cleanup；只有 SDK resolve 后写 cooldown。 | cross-tab 10/10；不支持 Web Locks/禁 storage 时仅 best effort，未承诺 universally exactly-once。 |
| BE-19 已修 | UI 接受 200k resume，但 generic/cover/career/interview/coach server 仅 100k，合法文件在扣费前后不一致失败。 | `runtimeLimits.ts` 单源 `MAX_RESUME_TEXT_CHARS=200_000`、semantic envelope 300k；所有 handler 先类型/长度验证且不静默截断。 | 4 files / 24 tests、两包 tsc。 |
| BE-20 已修 | 工具请求字段、AI JSON、nested arrays/URLs/数字可恶意或畸形，造成 crash、XSS-adjacent link 或资源放大。 | client/server schema validation、有限字符串/数组、finite numbers、meaningful output gate、safe URL；server output token/content caps。 | tool residual/contracts/backend scale tests。 |
| BE-21 已修 | `EmailCrafter` 切换场景后把隐藏旧字段整个发送，造成无关 PII 泄漏。 | 仅从 active scenario `requiredDetails` 构造 payload；handoff scenario allowlist。 | tool safety tests 锁定 payload。 |
| BE-22 已修 | `CoverLetterGenerator` handoff timer 自动执行，可在用户未点击时生成并扣费。 | handoff 只 prefill/reset stale state；只有 submit/regenerate 调用；saved hydration 不覆盖新 handoff。 | prefill/actions/tool contract tests。 |
| BE-23 已修 | Company review 全量拉取/内存 aggregate，规模增长会超时；分页可能泄露 UID 型 doc ID。 | newest-first 有界分页，最多 20×50；稳定 `created_at + documentId` 排序；不返回 cursor/doc ID；`AggregateField.average/count` 精确聚合。 | backend scale + UI tests；索引 READY 待生产。 |
| BE-24 已修 | 月度积分 scheduler 全表串行、无 checkpoint/硬上限，重试/并发风险高。 | recurring plan 过滤、稳定分页、`credit_renewal_runs/{period}` CAS checkpoint、有界并发/页数/运行时。 | pure bounds tests；scheduled Firestore behavior 待 emulator。 |
| BE-25 已修，待生产 rollout | API usage recent query 先取 100 再内存排序；summary 全量；90 天 retention 只有文案。 | database `orderBy timestamp desc limit`；32 sharded summary；`expires_at` 写入和 TTL field config；guarded backfill + second no-change run。 | 6 files / 41 tests + script syntax；backfill/TTL 未执行。 |
| BE-26 已修 | Public API docs 双源、jobs/usage 查询语义/重试成本不准确。 | `docs/api.md` canonical，`sync-api-docs.mjs` 生成/check public mirror；文档明确 language、page count、quota 重试/成本。 | API docs parity/check tests。 |
| BE-27 已修 | 可预测/重复 client IDs、重复 signup completion、sample account production exposure、trigger 重放。 | `secureRandomId`、idempotent onboarding/signup completion、server-env sample gate、trigger durable idempotency keys。 | corresponding pure tests；trigger runtime 待 emulator。 |
| BE-28 已修 | 外部/打印/Web3 URL 与 portfolio preview 可能注入危险 scheme 或超权 iframe。 | `safeHttpUrl`、Web3 allowlist、portfolio preview sandbox/normalization、same-origin/blocked-window failure handling。 | safe URL/web3/portfolio security tests。 |
| BE-29 已修 | 前端虽然要求验证邮箱，但后端只检查登录态时，未验证或不受支持的身份仍可直接调用 AI、招聘和 admin 产品能力。 | `functions/src/middleware/auth.ts` 将 `requireAuth` 收紧为 `email_verified === true`；产品 callables 与 admin role boundary 统一使用该入口。`requireAnyAuth` 只保留给账户 bootstrap、套餐选择、checkout/billing management/recovery，避免把未验证用户锁死在验证前。 | `verifiedAuth.test.ts` 4/4，包含 verified allow、missing/false claim fail-closed、窄例外与无 auth；两包 TypeScript 通过。 |
| BE-30 已修，待 emulator | Auth `onCreate` 与业务注册 callable 并发写 `users/{uid}` 时，晚到的默认 candidate 写可能覆盖 employer/套餐；浏览器 profile repair 也可能成为第二个角色来源；未来创建时间可能绕过“新账户”业务角色注册边界。 | `onUserCreated.ts` 改为 Firestore transaction：不存在才创建默认 candidate；已存在只补缺口，永不覆盖 role/subscription。`setSubscriptionStatus.ts` 使用 Auth Admin SDK 的 `metadata.creationTime` 作为独立服务端权威时间，同时验证 auth/doc age 均为非负且小于 2 分钟，并写 `role_provenance/role_provisioned_at/organization_verified=false`；浏览器不再 upsert trusted fields。 | signup completion、future timestamp、role provenance contracts 已纳入 141 files / 922 tests；真正的 trigger/callable race 仍需 emulator。 |
| BE-31 已修，待 emulator | Talent Discovery 曾可能扫描默认加入的人才或把姓名、邮箱、电话、简历、学校/雇主/链接交给企业浏览器或模型；短姓名及敏感词数量上限可能留下可重识别信息。 | `talent_profiles.discoverable` 默认 false 且可逆，关闭发现使用独立最小写入并绕过无关表单校验；`discoverTalent.ts` 只查询显式加入且 complete 的 profile，构造去标识化 context。脱敏保留全部有界敏感词，不再截断到前 160 项，并覆盖 1/2 字符姓名和短 ASCII token 边界。联系资料须走逐企业同意。 | consent/privacy pure regressions 已纳入 922 tests，包括短姓名与超过 160 个标识符；`discoverTalent.callable.test.ts` 待 Firestore emulator。 |
| BE-32 已修，待 TTL/emulator | 候选人一次接受外联若直接开放 live profile，会让企业看到后续编辑内容且授权无期限、不可真正撤销；读取资料包时若分步读取，撤销竞态可能短暂放行。 | `sourcingOutreach.ts` 在 accept 事务中仅按白名单冻结最小资料包到 server-only `sourcing_candidate_packets`，不复制 raw `talent_profile`/references，有效期固定 30 天；每次读取在同一事务校验 outreach 与 packet 的 owner/status/expiry。revoke 同事务删除资料包并清 expiry；重开请求先删旧包；TTL 配置已落盘。 | source/normalization/minimal packet contracts 已纳入 source gate；callable/Rules specs 待 emulator，生产 TTL policy active 证据仍是外部门禁。 |
| BE-33 已修，待 live smoke/运营审核 | 企业自报名称或完成付款可能被错误提升为“已验证组织”，并传播到职位与外联记录。 | `organization_verified` 为 server-owned、默认 false，付款不升级信任；`jobPostings.ts` 与 `sourcingOutreach.ts` 从服务端用户档案冻结 `verified` 或 `unverified_self_reported`，绝不相信请求字段；未知 legacy 值在客户端也按未验证显示。 | normalization/provenance contracts 已纳入 922 tests；真实 Firebase job/sourcing live smoke 与组织审核流程仍待执行。 |
| BE-34 已修，待 Stripe/emulator | Stripe 已完成付款但 entitlement metadata 无效、账户已删除或永久激活失败时，旧逻辑可能只记日志并让付费用户既未获权益也没有退款/取消工单；未知错误若立即或永不排队都会产生误报或永久丢单。 | `stripeBilling.ts` 以 Checkout Session ID 幂等写 `billing_fulfillment_reviews`；确定性失败立即入队，普通未知错误只有在同一事件至少 5 次 delivery 且跨度至少 30 分钟后才进入 durable queue。重放只增加尝试，绝不重开 resolved 工单；队列写失败继续抛错让 ledger 可重试。 | Stripe recovery pure contracts 已纳入 922 tests；Firestore-backed callable 与真实 Stripe 退款/取消仍须外部验证和运营闭环。 |
| BE-35 已修，待 emulator/调度部署 | AI 失败后的 inline 积分退款若因 Firestore 瞬时错误失败，可能静默丢失等价资金；旧的固定前 100/200 条查询会让早期 pending 项长期饥饿；并发 worker 可能重复处理。 | `credit_refund_reviews` 初始化 `next_attempt_at`；worker 按 `status + next_attempt_at + documentId` 公平取到期项，以 lease/owner fencing 防并发抢占，失败采用有界指数退避，确定性错误和达到上限转 `manual_review`，退款仍以原 usage event/ledger 幂等。 | source gate、index contract 与 recovery pure contracts 已通过；调度器实际租约/并发行为仍待 emulator 与部署后 heartbeat。 |
| BE-36 已修工具，待生产审计 | 新合同无法证明历史 employer/agency 是否由可信服务端路径产生；把付费记录等同组织身份还会错误授予 verified。 | `functions/scripts/auditBusinessRoleProvenance.js` 只读扫描明确的 production project，校验 trusted provenance 或 exact business billing proof，并把组织验证/样例账户作为独立 findings；输出仅 aggregate 与 SHA-256 短引用，不打印姓名、邮箱、UID、公司或 billing ID，也不自动修改数据。 | provenance pure contracts 已纳入 922 tests；生产运行、逐项仲裁与签字证据未执行，因此正式上线仍 NO-GO。 |
| BE-37 已修，待 emulator/生产配额观察 | 人才外联列表固定 `limit(200)` 会漏掉较早但仍有效的 pending/accepted 项；企业状态不是实时；同一企业可对同一候选人重复轰炸或绕过 inactive job。 | candidate actionable inbox 使用 100 条 cursor pages 读取全部未过期 pending/accepted 并去重；employer history 保持有界但通过 snapshot 实时刷新。创建请求时在事务内重新验证业务角色、候选 discoverable、owned active job，使用 deterministic pair guard、7 天 cooldown、14 天 pending TTL 和 UTC 日配额（未验证组织 5、已验证组织 30）。 | 包括超过 200 项分页的 pure regressions 已纳入 141 files / 922 tests；真正的事务竞争、TTL 和配额统计仍待 emulator/生产监控。 |
| BE-38 已修，待最终 CI/live smoke | 人才外联写 TTL 时使用旧式 `admin.firestore.Timestamp.fromMillis`；TypeScript 可编译，但当前 Functions runtime 中该命名空间属性为 `undefined`，真实 callable 返回 internal。 | `sourcingOutreach.ts` 按本机 `firebase-admin/firestore` 声明直接导入 `Timestamp`，5 处 TTL/request/packet timestamp 全部改为 `Timestamp.fromMillis`；同类旧式调用全仓清零。 | Functions build 通过；CI `createSourcingOutreach` 原始 stack 已锁定该行，最终 runtime smoke 等待报告所在提交复验。 |
| BE-39 已修前向语义，待生产日计数对账 | AI 失败退款会恢复余额和写退款 ledger，但旧实现不冲销 `usage_counters.credits`；用户已拿回 credits，日 credit quota 和 Admin 统计却仍按 gross spend，且 counter 缺失时还会漏算 free claim、超过 2,000 条的 fallback 可截断后 fail open。异常 counter 若直接夹到 0 还会删除其他请求的净支出。付费计划和 global run cap 默认 0 时，退款失败还可能无限消耗 provider。 | 单源计量语义固定为：`deducted/free` 均保留一次 metered attempt，只有未退款 `deducted` 计入 net credits；退款与余额、源事件、ledger 在同一事务冲销原 UTC 日 global/user credits，counter 缺失用源事件净额 fallback，超界 fallback fail closed。下溢或未知日期保留限制性 counter、正常完成用户退款，并写 server-only `usage_counter_reconciliation_reviews`；Admin 显示待对账告警。无论 configurable quotas 是否关闭/为 0，服务端始终保留 10,000 platform / 500 per-user UTC-day attempt safety ceilings。今日/7 日/用户报告和帮助文案同步，截断读取改为 limit+1。 | 新增并发重复退款、跨日、缺 counter、下溢持久复核、schema-invalid provider、run-cap 不释放、credit-cap 释放和 free fallback 回归，但最后静态补丁按用户要求未复跑。历史同日已退款事件不会被相对重放；启用 live AI 前仍须配置更严格的非零 global/plan attempt caps，启用非零 daily credit caps 前须绝对重算并二次 no-change，或等新 revision 后下一个完整 UTC 日。 |

## 7. 发布配置、运维与供应链

| ID / 状态 | 问题 | 修复/当前实现 | 验证或限制 |
|---|---|---|---|
| OPS-01 已修 | 缺 Firebase env、placeholder/demo/emulator 值也能产 production artifact；`VITE_*` 可能误带 secret。 | `vite.config.ts` build 前 fail closed 校验 required public config、生产 project/domain、secret-like name/value、emulator disabled；source maps off，分块显式。 | CI-shaped synthetic public Firebase 配置下最新本地 build PASS：3,607 modules / 12.47s / 0 source maps；synthetic 配置不可用于部署。 |
| OPS-02 已修 | Canonical origin 在 TS、MJS、dotenv/runbook 多源漂移。 | `config/site-origin.mjs` 单源；`config/site.ts` re-export；Stripe env、SEO、Auth action URL和 deploy docs 使用同契约。 | site/release config tests。 |
| OPS-03 已修 | Hosting headers/CSP 不完整或与 fonts/privacy scripts 冲突。 | `firebase.json` 增加 CSP、HSTS、frame/referrer/permissions 等；移除 Google Fonts remote import，privacy script same-origin。 | hosting security tests + static HEAD check。 |
| OPS-04 已修 | release 命令散落、可跳过、结果不落盘。 | `run-release-gate.mjs` 提供 source/emulator/browser/artifact/all；Node `spawn`、结构化 JSON/log、secret redaction、child exit/flush fail closed。 | release composition tests；`all` 因外部证据/Java未执行。 |
| OPS-05 已修门禁，待真实证据 | Stripe env checker 可让 test key/simulation/错误 Price 通过。 | Secret Manager single-source；拒绝 dotenv secret 副本、test/demo、非 canonical origin；`check-stripe-live.mjs` 校验 9 个 live CAD Price 的金额/lookup/type/Product 和 6 个 webhook events。 | pure fixtures/parity tests；真实 API 未调用。 |
| OPS-06 已修门禁，待真实证据 | Signed webhook secret/endpoint/replay 只有文字检查，可能假绿。 | `record-stripe-webhook-evidence.mjs` 验证 clean approved SHA、live event/endpoint、两份 root-sealed delivery/Firestore ledger artifact；release gate重算 recorder/validator/source/config hash。 | 没有本次 live event，因此保持 NO-GO。 |
| OPS-07 已远端执行，待最终全绿/branch protection | 仓库此前无 CI/required checks，“every deploy gated”无证据。 | `.github/workflows/ci.yml`：Node22 static/unit、Temurin21+Firebase emulator、built-artifact browser jobs；current official checkout/setup/upload actions；最终 aggregate job。 | GitHub Actions 已真实执行并产出 source/emulator/browser artifacts 与失败 traces；最终修复提交仍须全绿，并把 aggregate job 配成 branch protection required check。 |
| OPS-08 已修结构，待浏览器 | E2E 只跑 dev server，curl 不能证明 production artifact hydration。 | `playwright.release.config.ts` + `e2e/release/artifact-smoke.spec.ts` 针对 sealed `STATIC_ROOT`，覆盖 1440/768/320、routes、runtime/console/resource errors、overflow、broken images 和禁用 footer copy。 | in-app Browser 插件 setup 两次失败；Playwright CLI 未获授权，未执行。 |
| OPS-09 已修 | 发布过程中二次 build、artifact 可改写、symlink 切换/失败回滚不完整。 | runbook build-once；manifest/hash；root seal 0555/0444；runtime readability；同 filesystem atomic rename；root flock；失败自动切回 previous，manual rollback 校验 artifact root/manifest。 | Bash fences `bash -n` 和 runbook contract tests；真实 VM 未执行。 |
| OPS-10 已修 | Functions deploy/rollback 手写目标可能漏部署或误删 legacy exports。 | `validate-function-targets.mjs` 对编译 index export 校验 sorted ASCII target file；deploy与rollback复用同一审阅文件，禁止裸 `--only functions`。 | function target evidence tests；真实 deploy 未执行。 |
| OPS-11 已修 | Seed/admin/migration 脚本默认项目/host可被环境覆盖到生产；日志可能打印密码/token；secret file可被 symlink 替换。 | 统一 Firebase production guard、project allowlist、typed confirmation、emulator loopback、symlink/permission checks、aggregate-only logs；25 个脚本逐项审查。 | script safety 43/43、19 个 MJS syntax checks；远端写未执行。 |
| OPS-12 已修文档/工具，待生产 | Rules/TTL先部署会阻断 legacy data；Storage跨服务权限易漏。 | 唯一顺序：query-only indexes READY → compatibility Functions → BYOA/usage backfills+second zero run → full index/TTL → reader → strict Firestore/Storage Rules + IAM smoke。 | `docs/deployment/README.md`/checklist tests；生产证据为空。 |
| OPS-13 已修 | Windows package script 外层 shell 解析引号/环境变量，emulator 命令不便携。 | `scripts/run-with-env.mjs` 以 shell-free wrapper 传 env/argv，Windows `.cmd` 明确处理；package scripts 改用 wrapper。 | portable scripts tests；Firebase runtime未执行。 |
| OPS-14 已修 | `.only` 可在本地通过；Playwright可复用 stale server。 | Vitest `allowOnly:false`；Playwright `forbidOnly:true`；只有显式 `PW_REUSE_EXISTING_SERVER=1` 才复用；test set composition自动检查。 | static scans/tests。 |
| OPS-15 已修 | localization/API docs 手抄 mirrors易漂移。 | canonical source + sync/check；`prebuild` 与 source gate调用同一脚本。 | 7 locales、API byte parity、sync script self-tests通过。 |
| OPS-16 风险待办 | Functions `lint` 脚本存在但仓库无 ESLint依赖/config，名义门禁不可用。 | 正式发布前应固定 ESLint + TS plugin/config，或删除误导命令并在风险接受中说明暂以 tsc/contract tests代替。 | 当前不宣称 lint 通过。 |
| OPS-17 风险待办 | 没有 SBOM/签名 provenance；SHA manifest只能防意外改动，不能证明构建者。 | 后续生成 CycloneDX/SPDX 和受信构建 provenance；VM只接收 approved SHA artifact。 | 不阻塞最终本地门禁通过后的代码候选 push，阻塞高保证供应链声明。 |
| OPS-18 风险待办 | 超大组件/handler增加 review与回归成本。 | 优先拆 `AdminPortal.tsx`、`AgencyHub.tsx`、`ApplicantFunnel.tsx`、`InterviewSimulator.tsx`、`CareerApp.tsx`、server `adminPortal.ts`；一次一个模块，保持测试基线。 | 架构债，不应在本轮大变更后继续无测试重构。 |
| OPS-19 已修证据链，待真实 Firebase 状态确认 | 新增 scheduler、复合查询或 TTL 字段若未进入部署 target/index 配置，会出现“源码存在、线上不运行”。 | function target evidence 强制包含 `processCreditRefundReviews`；`firestore.indexes.json` 增加退款公平队列、人才外联 candidate/employer/actionable 查询索引，以及 `sourcing_outreach`、candidate packets、daily quotas 等 TTL field configs；测试校验 target、fixture、heartbeat 与 stale pending 语义。 | source gate 中 function-target/index contracts 通过；正式上线仍须确认真实 Firebase Functions 已部署、indexes READY、TTL policies ACTIVE，并完成 live smoke。 |
| OPS-20 已修，待最终 CI | `emulator-contracts` 会运行 6 条 Playwright 驱动的 runtime smoke，却只在隔离的 `browser-e2e` job 安装 Chromium；GitHub job 文件系统不共享，导致 6 条 smoke 同时在 `browserType.launch` 假红。 | `.github/workflows/ci.yml` 让两个需要浏览器的 job 都使用 lockfile 中 `@playwright/test 1.60.0` 对应的 `npx playwright install --with-deps chromium`，不依赖另一个 job 的磁盘。 | CI `1e2c1ee` 的 6 条失败共享完全相同的 missing executable 指纹；工作流静态计数由 1/2 改为 2/2，最终 Actions 复验待完成。 |
| OPS-21 已修，待最终 CI | E2E LLM stub 声称生成 schema-valid 结果，却只按字段名决定数组长度并忽略 `minItems/maxItems/enum/minimum/maximum`；简历分析因此得到 1/1/1 项而违反 4/4/8 合同，后端正确退款，happy-path 等待余额变化 60 秒后假红。 | `stubProvider.ts` 统一从实际 schema 合成受约束的数组、枚举和数值，不为简历字段写特例；happy-path 改为同时验证精确 `90 CR`、分析结果标题和 strengths section，区分成功、退款与空导航。 | 新增 provider regression 直接用 `ANALYSIS_SCHEMA` 做全结果校验，并用任意嵌套 schema 固定数组/枚举/数值边界；最终 Actions 复验待完成。 |
| OPS-22 已修，待最终 CI | 三处 Web3 seed/smoke 各自手抄简历分析，全部违反 4/4/8 schema，其中两处还把 ISO 字符串写入要求 Firestore Timestamp 的 `created_at`；Admin SDK 会绕过 Rules，坏 fixture 可静默进入隔离环境。 | 新建 `scripts/lib/resume-analysis-fixtures.mjs` 单源 builder，三个脚本统一引用并传真实 Timestamp；fixture 直接对生产 `ANALYSIS_SCHEMA` 做回归，固定 4 strengths、4 个结构化 improvements、8 keywords。 | MJS/TS 导入合同已覆盖；Web3 runtime smoke 等待最终 CI。 |
| OPS-23 已修文档/检查工具，待真实 Firebase | 部署 runbook 仍写 3 个 TTL、只展示 22 个 canonical composite 中的 6 个且把本地 Java 暗示为推送前置；私有仓库当前计划也无法证明 required check protection。 | `print-firestore-index-plan.mjs` 从 canonical JSON 生成 22 composite/5 TTL 清单；runbook/checklist 改为 CI emulator 必须、开发机 Java 非前置、真实 Firebase live smoke 才是上线证据，并增加五 TTL、日计数 reconciliation 与无 branch protection 时 exact-SHA 双人 change-record 控制。 | runbook contract 直接从 `firestore.indexes.json` 校验 22/5、五个 TTL 名称、计数对账顺序与二次 no-change；生产 index/TTL/保护策略仍须上线操作留证。 |
| OPS-24 已修进程清理，按用户要求未复跑 | CI `b781f52` 的 sourcing runtime smoke 已打印最后一个成功断言，却在 41 分钟内无任何新输出，直到 45 分钟 job 被取消；`npx vite` wrapper 被终止后可能留下持有管道的 Vite 子进程，Firebase Admin app 也未显式释放。 | 全仓九个 smoke 的 Vite 启动统一改为用当前 Node 直接运行本机真实 `node_modules/vite/bin/vite.js`，不再产生 `npx` 中间进程；sourcing smoke 额外等待 TERM/KILL 退出并删除 client/Admin Firebase apps。 | GitHub 原始日志精确固定“最后断言成功后 cleanup 挂起”的指纹；同类 `npx vite` 启动全仓静态清零。应用户要求未重新运行 emulator/runtime smoke。 |

## 8. 本轮统一验证结果

以下记录最近一次完整门禁由协调器实际执行得到的证据；该门禁发生在最后的 smoke 进程清理、计数器异常复核和 stub primitive 健壮性补丁之前。应用户要求，最后静态补丁当时未复跑；2026-07-14 已完成补充复验并修复所暴露问题，过程与证据见 §8.1。synthetic public Firebase 配置只用于 build 形状验证，不作为 production credential 或 live Firebase 证据。

| 门禁 | 实测结果 | 能证明 | 不能证明 |
|---|---|---|---|
| Root TypeScript | **PASS，0 diagnostics** | 前端/共享 TS 类型与接线 | 浏览器运行时、Firebase行为 |
| Functions TypeScript | **PASS，0 diagnostics** | Functions 源码、exports、SDK types | deploy/冷启动/Firestore事务 |
| Localization | **PASS：7 locales；tests 4/4** | canonical/public mirrors 与 locale contracts | 真实浏览器里所有文案的视觉适配 |
| API docs / functional scan / Stripe env check | **PASS** | 文档镜像同步、已知功能指纹扫描、发布环境合同 fail closed | live Stripe Price/webhook 或真实生产配置 |
| 全量 Pure Vitest | **2026-07-14 复跑：141 files / 923 tests，922 通过、1 失败（runbook 短语断言，已修，见 §8.1）** | 截至复跑时的 source/UI/业务逻辑/script contracts 回归 | Firestore 真实事务、浏览器和外部服务 |
| Production-shaped Vite build | **PASS：3,607 modules / 12.47s / 0 source maps** | bundling、生产 env fail-closed、artifact source-map policy | synthetic Firebase 配置不可部署，也不证明 live Firebase |
| Dependency audits | **Root：0；Functions：11 moderate，0 high/critical** | 当前 lockfile advisory 快照 | moderate 风险接受、SBOM 或构建 provenance |
| Firebase CI 隔离合同 | **`f548592`：Rules 88/88、23 个 callable 文件全部 PASS；runtime smokes 8/10，两个 smoke 契约缺陷已修（§8.1）** | Firestore/Storage Rules 与 callable transaction 的隔离回归 | 不证明生产 Rules/Indexes/TTL/Functions 已发布；本地没有启动 Java emulator |
| Static artifact HTTP/CSP | **PASS** | 9050 的 `/`、`/workspace`、`/pricing`、`/privacy` 均 200+CSP | 页面交互、真实 Auth/Firestore、跨浏览器视觉 |
| Browser/real-device | **CI `f548592` browser gate 4/4 全绿（stub/schema 假红链路已闭合）** | Admin、Web3 完整状态链、happy path 精确扣费（100→90 CR）与 artifact smoke | 本地 in-app Browser 因 `Cannot redefine property: process` 阻塞；真人跨设备/辅助技术仍未完成 |

补充说明：本机没有安装或启动 Java/Firebase emulator；隔离合同由 GitHub Actions 执行。该覆盖是提交级回归证据，不替代真实 Firebase 的 Rules、Indexes、TTL、Functions 状态及 live smoke。

### 8.1 2026-07-14 复验与修复

上一轮最后静态补丁按用户要求未复跑。本轮用捆绑 Node v24.14.0 在本机复跑 source 门禁等价项，并核对 `f548592` 的 GitHub Actions 结果（run 29307856845），发现并修复三个问题：

| 问题 | 根因 | 修复 |
|---|---|---|
| 本地与 CI 单测 1/923 失败（`tests/deploymentRunbook.test.ts`） | `docs/deployment/README.md` 的硬换行把 "nonzero global" 拆到两行，且 "nonzero per-plan" 从未在正文中相邻出现——该断言自写入起就不可能通过，未复跑掩盖了它 | README 改写为两个显式短语；断言改为容忍 markdown 换行的 `\s+` 正则（与同文件既有 `current\s+UTC-day` 写法一致） |
| CI emulator gate：`web3-preview` smoke 恒超时 | smoke 等待文本 "Verified Identity"，该文案在 `118a376` 品牌措辞加固时已从 UI/localization 全部移除，全仓库只剩 smoke 自己引用；disabled 的 `detached` 断言因元素从不存在而恒真，enabled 断言恒超时 | 改用与已跑绿的 `e2e/web3-credential.spec.ts` 相同的稳定钩子：禁用态等 `[data-qa="web3-preview-notice"]` detached，启用态等同一选择器附带 Sepolia 文案可见，再等 `[data-qa="web3-credential-offer"][data-state="eligible"]` 后点击 Issue credential |
| CI emulator gate：`resume-preview` smoke console-error 失败 | 整页导航中断在途 localization fetch（`TypeError: Failed to fetch`），应用按设计回退英文并记录 console.error；smoke 的零 console-error 合同把这次已恢复的降级判为失败 | 新增 `scripts/lib/smoke-console-filters.mjs`，resume/web3 两个 smoke 仅豁免该条精确消息；文件缺失走 `Could not load` 分支，仍然阻塞 |

复跑证据（本机无 Java/Firebase CLI，emulator/browser 面仍以 CI 为准）：

- localization 7 locales + tests 4/4、API docs 镜像同步、functional bug scan、根项目与 Functions TypeScript 0 diagnostics：全部 PASS。
- 全量 pure unit：修复前 141 files / 922 passed / 1 failed（唯一失败即上表第一项）；修复后受影响的 `deploymentRunbook` 与 `scriptSafety` 合同共 57/57 复跑通过。
- `check:stripe-env` 本机预期失败：`functions/.env.career-copilot-a3168` 是等待客户付费的 live 配置，本机不存在且被 gitignore；这是已知外部 NO-GO 项，不是代码回归，不以伪造值跑绿。
- CI `f548592` 实测：browser gate 首次 4/4 全绿（含此前 stub/schema 假红链路）；emulator gate Rules 88/88、23 个 callable 文件全部通过、runtime smokes 8/10（两个失败即上表，属 smoke 契约缺陷而非产品缺陷）；static-and-unit 失败点与本地复跑一致。`b781f52` 的 emulator job 为 45 分钟超时（npx 进程残留），`f548592` 的 execPath 直启修复使 smoke 结果首次真实暴露——此前任何一次 CI 都未真正跑完这两个 smoke。
- 第二轮 CI `e826fcb`（run 29310322624）：static-and-unit 与 browser gate 双绿，resume-preview/web3-preview 两个 smoke 修复得到实证；同类噪音漂移到另外两个 smoke——auth-routing 命中同一个翻译中断竞态、navigation-ui 命中 Firestore SDK 首连失败后自愈的 `Connection failed 1 times` 瞬态日志（两者功能断言均已通过，只败在零 console-error 合同）。处置：把非阻塞噪音判定收敛到 `scripts/lib/smoke-console-filters.mjs`，九个带 console 合同的 smoke 统一在采集点过滤且仅豁免这两条精确消息；持续性 Firestore 断连（计数 ≥2）与翻译文件缺失仍然阻塞。
- 第三轮 CI `559d252`（run 29310855830）：runtime-critical 首次 10/10 全绿，门禁推进到从未执行过的 `smoke:tool-execution` 阶段并暴露 Resume Formatter 的两处时序死契约——该工具的保存版本库在删除最后一个版本时会清空内存结果回到 input 态（`components/tools/ResumeFormatter.tsx` 的 `onClearSaved`），而 smoke 在 remove-saved 之后仍等待仅存在于 result 态的 readiness 面板，且通用恢复 helper 的 post-clear "Not saved" 读取假设结果保持挂载（其余全部工具确为该标准语义，已逐一核对）。处置：readiness 断言移到结果仍在时，删除后改断言回到 input 态；`runResumeFormatter` 改用符合版本库语义的专用序列。附带完成两个未执行 smoke 的 225 个 data-qa 选择器与应用源码的交叉核对，无其他缺失引用。
- 第四轮 CI `5aa1b97`（run 29311703338）：runtime-critical 连续第二次 10/10；tool-execution 越过两处 resume-formatter 修复点后，暴露最后一类问题——14 处保存状态徽标断言全部使用单次立即 `innerText` 读取，与客户端订阅同步存在竞态（linkedin-optimizer 处 `waitForToolResultWrite` 已证明 Firestore 文档写入成功，仅徽标文本尚未刷新）。处置：新增轮询式 `expectSaveStatus` helper（大小写敏感的 `/Saved/`、`/Not saved/` 正则防止互相误配），14 处读取全部替换；真实的保存失败仍会在 10 秒后带实际徽标文本失败。
- 第五轮 CI `69caa93`/`96e0451`（runs 29312285227、29313679704）：保存徽标修复实证通过（cover letter/email/career path/resume formatter/linkedin 五条 save-restore 流程全绿）；mock interview 在"生成后进入 interviewing 阶段"处 60 秒超时，callable 两次 ~20ms 静默返回、无结构化结果日志。为 smoke 加入诊断输出后，`96e0451` 运行给出精确根因：页面 alert 显示 **"model must be a string of at most 200 characters."** —— 这是一个真实 P1 产品缺陷：`services/aiClient.ts` 有 8 处 callable 调用无条件传 `model: currentModelId`，平台托管模式下该值为 `undefined`，而 Firebase callable 编码器把 `undefined` 序列化为 `null`；加固后的 `mockInterview` handler 严格校验只放行 `undefined`，因此**所有未选 BYOA 模型的用户都无法开始模拟面试**（其余 handler 容忍 null 所以未爆）。处置：新增 `modelPayload()` helper，8 处全部改为字段级省略（与 `callAiProxy` 既有写法一致），并在 `dedicatedAiClientIdempotency.test.ts` 增加"平台托管模式 payload 不得含 model 字段"回归用例；修复后全量 pure unit 141 files / 924 tests 全绿。
- 第六轮 CI `576978c`→`1efb297`（runs 29314555982、29315342933、29316143780）：model 修复实证生效（`mockInterview.generate`/`evaluate_session` 均 outcome=success）；smoke 随之暴露两个后续问题并修复——(a) smoke 仍假设 stub 只生成 1 题即出报告，已改走真实 "End interview early" 早退确认流程；(b) 服务端 `evaluate_session` 在结构化校验后还要求 `perQuestion.length === qa.length`，而静态 `SESSION_EVAL_SCHEMA` 的 `minItems:"1"` 让 stub 只合成 1 项、早退提交 8 题必然失配 → 新增 `sessionEvalSchemaFor(qa.length)` 把覆盖数钉进每次请求的 schema（对真实模型同样是更严的生成时契约），`llmStubProvider.test.ts` 增加 1/8 题覆盖回归用例。修复后全量 pure unit 141 files / 925 tests 全绿。browser gate 在 `576978c` 出现一次 admin-keys-recovery `aria-pressed` 偶发失败，`99ae4e4`/`1efb297` 两轮复绿，按环境抖动记录观察。
- 第七轮 CI `3c0da96`→`56289fd`（runs 29318060365、29318893665）：grounded 工具与 opportunity handoff 修复实证通过，tool-execution **全部功能流程首次跑完**（英语教练、学习计划、组合站等全绿），只剩收尾的零 console-error 总契约拦下两个真实产品缺陷并已修复：(a) `CoverLetterGenerator` 在 `setLib` 的 state updater 内调用 `persist()`，构成 setState-in-render（React 对 `ToolResultsProvider` 的跨组件更新告警 ×3）——改为 `libRef` 镜像 + 在 updater 外计算并持久化；(b) English Pro 连胜保存被 Firestore 拒绝：客户端写 `english_pro_last_practice` 为 YYYY-MM-DD 字符串而 `validUser` 要求 timestamp（rules 第 40 行早有"confirm real writes validate"的存疑注释），且富档案文档使全量 `validUser()` 复验超出 rules 表达式求值上限、静默拒绝所有小更新——新增窄 delta 校验器 `validEnglishProStreakUpdate` 置于 OR 链首位短路重校验，全量校验器兼容日期字符串/timestamp 双形态，新增"富文档 streak 可保存 / streak 更新不可夹带角色提升"两条 rules 用例。残余风险已记录：其他经 `validUser` 全量路径的富文档客户端更新仍可能逼近求值上限，建议团队后续把更新面全部迁移到 delta 校验器。
- 第八轮 CI `eaa5aca`→`4368964`（runs 29320174266、29321056750、29364626367、29365572567）：streak 拒绝的完整因果链分三步收口——delta 校验器先是复核了未触碰的合并文档 `updated_at`（真实文档是遗留 ISO 字符串）、随后发现 `profiles.update` 会自动附加 `updated_at`、最终定位 `sanitizeProfileForFirestore` 把 `english_pro_last_practice` 与 `updated_at` 都转成 Firestore Timestamp 上线——校验器改用 `optionalClientTimestamp` 双形态并把两种真实线形（当前客户端 Timestamp / 遗留字符串）都锁进 rules 回归用例。**run 29365572567（提交 `4368964`）四个 job 全部 SUCCESS：release gate 体系建立以来首次完整绿灯**（source + emulator 全阶段 rules/callables/10 smokes/tool-execution/account-profile + browser 4/4 + Require-every-gate）。据此关闭 SCRUM-84（RC 全量回归门禁）、SCRUM-67（可观测与发布门禁）、SCRUM-68（安全与负载基线），证据评论已随票落盘。上表"本地 source gate/emulator/browser"各行的"最近一次"状态自本轮起以该 CI run 为准。

这些项目不是“建议优化”，而是正式客户流量前的明确证据要求。

1. **真实 Firebase 配置与集成验证**
   - 将批准 SHA 的 Firestore/Storage Rules、复合索引、TTL 与 Functions 发布到受控 Firebase 环境，等待索引 `READY`、TTL policy `ACTIVE`，再执行使用专用测试账号的 live smoke。
   - 特别验证：`users/{uid}` 只能由 client 创建 candidate；业务注册与 Auth trigger 并发不覆盖角色/套餐；discoverable=false 不进入人才池；人才资料包 accept/revoke/expiry；`billing_fulfillment_reviews` replay；`credit_refund_reviews` 幂等恢复与 manual-review 上限。
   - Java/Firebase emulator 是最终提交在 CI 中必须通过的隔离回归，但不是开发机提交、推送或正式运行环境的前置条件；不得用 emulator 结果替代真实 Firebase 状态证据。

2. **真实 Stripe 与签名 webhook**
   - 对批准 SHA 运行 live preflight；核对 9 个 Price、金额、CAD、lookup key、recurring/payment、active Product。
   - 核对 live webhook exact URL/API version/6 events；产生真实签名 event。
   - 保留首次投递与同一 event replay 的 HTTP/Workbench 证据，以及 Firestore ledger“只生效一次”的 root-sealed 证据。
   - 对所有 `billing_fulfillment_reviews.status=pending` 建立具名 owner、退款/取消决定和 resolved 证据；不得让“支付成功但权益失败”只停留在队列。
   - 未取得 `STRIPE_LIVE_EVIDENCE` 和 `STRIPE_WEBHOOK_EVIDENCE` 时，`gate:release all` 应继续失败。

3. **事务邮件与 DNS**
   - 永久 production domain、Firebase Auth templates/sender/action URL、authorized domains。
   - SPF/DKIM/DMARC；consumer + representative corporate mailbox；Inbox/Spam、到达时间、expiry/reuse、resend/rate-limit、typo/bounce/recovery。
   - Trigger Email/SMTP 的招聘通知要另做投递、退信、reply-to smoke。

4. **生产数据与规则 rollout**
   - 受限 Firestore export/change ticket。
   - BYOA legacy field migration，要求残留 0；第二次 apply 要求 migrated/updated 0。
   - API usage log expiry 与 summary shards backfill，invalid/residual 0，第二次 no-change。
   - Query indexes全部 READY 后才 full index/TTL；确认 `api_usage_logs.expires_at`、`api_usage_summary_shards.expires_at`、`sourcing_candidate_packets.expires_at`、`sourcing_outreach.expires_at`、`sourcing_outreach_daily_quotas.expires_at` 五个 TTL policy active 后部署 reader；最后 strict Rules。
   - 启用任何非零 daily credit cap 前，对部署当日 `usage_counters` 按源事件做绝对净额重算并第二次 no-change；若没有审核过的重算操作，则保持 credit caps 为 0 到新 revision 后下一个完整 UTC 日，run caps 可继续启用。
   - Storage Rules service agent 的 Firebase Rules Firestore Service Agent IAM，以及 candidate/employer/no-profile 正反 smoke。

5. **历史业务角色与组织信任审计**
   - 在受控生产只读身份下运行 `cd functions && npm run audit:business-roles -- --project=career-copilot-a3168`，保存命令、approved SHA、project、时间和完整脱敏 JSON 证据。
   - `review_required` 必须为 0；或逐项证明角色来源、移除样例账户并完成批准的组织审核。脚本退出码 2 是发布阻塞，不得自动写数据“修绿”。
   - 付款只可证明 exact entitlement，不等于组织身份已验证；`organization_identity_unverified` 必须由独立运营审核关闭。

6. **真实浏览器/设备/辅助技术**
   - 先修复或绕过经批准的 in-app Browser 插件问题；本轮具体错误为两次 `Cannot redefine property: process`。
   - 320×568、390×844、768×1024、1440×900；Chrome/Firefox/Safari/WebKit策略；中文、德语/法语长文案、Arabic RTL。
   - 匿名 marketing/pricing/privacy、登录/注册/验证/重置、candidate/employer/admin、所有关键工具、结算确认、long AI output、dark mode、offline/retry/cancel。
   - Keyboard-only、focus trap/restore、screen reader live regions、mobile keyboard visual viewport。

7. **账户删除与合规**
   - 产品/法务/财务确定每类 shared hiring、finance/audit、Storage、Stripe 数据的 retention/anonymization/evidence-of-erasure。
   - 当前功能是“移除 Auth/profile访问 + 输出 retained cleanup manifest”，不是用户自助完整法定擦除；manifest 已包含 `billing_fulfillment_reviews`、`credit_refund_reviews` 与 `usage_counter_reconciliation_reviews`。

8. **真实 AI、可观测性与滥用控制**
   - 真实 provider 的质量/延迟/费用/失败恢复；不要把 stand-in eval 或 emulator latency当 production SLO。
   - Sentry consent 后初始化、alerts、incident owner、budgets；App Check/rate abuse；上传恶意文件/病毒扫描策略。

9. **CI 与供应链**
   - 提交后真实运行 `.github/workflows/ci.yml`；上传失败 trace/evidence；最终 release aggregate 必须绑定 exact SHA。当前私有仓库计划无法证明 required check protection；若不升级计划，正式发布 change record 必须记录成功 aggregate URL、exact SHA 和双人批准。emulator job 是 CI 隔离回归，不是生产 Firebase 已验证的证明。
   - 处理 Functions 8 个 production moderate advisories；记录升级、不可升级原因或风险接受。
   - 补 lint、SBOM/provenance；核对 runner使用 Node22而不是仅本地 Node24。

## 10. 代表性优化代码

完整优化代码已经落在上述路径，以下只展示关键不变量，避免在报告复制第二份业务源。

### 10.1 精确套餐授权

```ts
return data?.active === true &&
  data.status === "active" &&
  data.plan === requestedPlan &&
  data.audience === contract.audience &&
  data.mode === contract.mode;
```

权威实现：`functions/src/billing/entitlement.ts`。任何仅检查 `billing.active` 的授权回退都应视为回归。

### 10.2 Consent 后才加载可选第三方集成

```ts
const [stripeJs, react] = await Promise.all([
  import('@stripe/stripe-js/pure'),
  import('@stripe/react-stripe-js'),
]);
```

权威实现：`contexts/SubscriptionCheckoutContext.tsx`；Sentry 同样在 `lib/observability.ts` consent 后 dynamic import。

### 10.3 Resume 单源字符合同

```ts
export const MAX_RESUME_TEXT_CHARS = 200_000;
export const MAX_AI_TOOL_PAYLOAD_CHARS =
  MAX_RESUME_TEXT_CHARS + MAX_AI_TOOL_NON_RESUME_CONTENT_CHARS;
```

权威实现：`functions/src/utils/runtimeLimits.ts`；浏览器从 `lib/resumeFileValidation.ts` re-export，不再手抄 100k/200k。

### 10.4 Client self-provisioning fail closed

```rules
allow create: if isOwner(userId)
  && validUser(request.resource.data)
  && request.resource.data.role == "candidate"
  && request.resource.data.credits <= 150
  && createSubscriptionAllowed(request.resource.data);
```

权威实现：`firestore.rules`。Employer/agency 角色只能由 server-side Admin SDK provisioning。

### 10.5 用户要求删除的 footer

`SiteFooter.tsx` 现在只保留品牌、产品/公司/联系导航、copyright 和语言切换。运行时已明确移除“Beta 预览版。功能和数据可能会在正式发布前调整。”以及“渥太华大学 · ELG 5902 — 王凯尔、许敬轩、张晓艺、毕骄阳、赵翔、杨晓燕”；七语言 canonical/public mirror 中对应 `footer_beta_notice`、`footer_academic_credit` keys 也已删除。负面测试保留原句只为防回归，不会渲染给用户。

### 10.6 后端邮箱验证边界

```ts
export function requireAuth(request: CallableRequest): string {
  const uid = requireAnyAuth(request);
  if (request.auth?.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verify your email address before using Career CoPilot features.");
  }
  return uid;
}
```

权威实现：`functions/src/middleware/auth.ts`。任何新增产品 callable 若改用 `requireAnyAuth`，必须能证明属于账户 bootstrap、billing 或 recovery 的窄例外。

### 10.7 人才发现与限时同意

```ts
const profileQuery = await db.collection("talent_profiles")
  .where("discoverable", "==", true)
  .limit(CANDIDATE_SCAN_LIMIT)
  .get();

export const SOURCING_PACKET_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
```

权威实现：`functions/src/handlers/discoverTalent.ts`、`functions/src/utils/talentProfile.ts` 与 `functions/src/handlers/sourcingOutreach.ts`。discoverable 只允许去标识化匹配；联系资料仍须逐企业同意，且 accept 只生成 30 天冻结快照，revocation/expiry 必须 fail closed。

### 10.8 资金等价失败必须进入持久闭环

Stripe 支付成功但权益无法激活时，以 Checkout Session ID 写 `billing_fulfillment_reviews`；inline credit refund 未完成时，以原 usage event ID 写 `credit_refund_reviews`，再由 `processCreditRefundReviews` 定时幂等恢复；退款完成但派生计数器异常时写 `usage_counter_reconciliation_reviews`，要求绝对重算而不是重放退款。三个集合均为 server-only；队列存在只证明“没有静默丢失”，不等于运营已经退款、取消或完成对账。

## 11. 交付与上线口径

- 当前可以说：**“本轮源码施工与审查已完成；最近一次完整门禁通过 141 files / 922 tests、根项目/Functions TypeScript、依赖高危门禁和 production-shaped build；最后静态补丁按用户要求未复跑；远端 CI 已把 Rules/callables 跑绿并产出精确浏览器/runtime 回归证据。”**
- Push 后可以说：**“工程源码交付完成，等待自行搭建和正式上线。”** 这不等于同一提交 CI 或生产门禁全绿。
- 现在不可以说：**“已正式上线”“生产门禁全绿”“真实邮件/Stripe/Firebase 已验证”“历史业务角色已审计”“七语言所有工具均完整本地化”“完整数据擦除已实现”。**
- Push/commit 是源码交付动作，不会自动关闭第 9 节的 Stripe、SMTP/DNS、Firebase/IAM/TTL、历史角色、真实设备与合规门禁。
- 正式上线批准必须绑定同一个 approved SHA、同一个 sealed artifact、完整 gate evidence、所有资金补偿队列的运营处置状态，以及具名发布/回滚负责人。
