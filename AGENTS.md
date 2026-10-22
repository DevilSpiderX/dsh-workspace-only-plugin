# AGENTS.md

DeepSeek Harness (dsh) 0.2.x 插件：在工具层把任意沙箱模式下的文件访问限制在会话工作区内，越界走三键裁决。源码在 `src/`（host 侧纯 ESM JS、client 侧 React JSX），pnpm + Vite 构建、产物在 `lib/`；**无测试框架、无 lint/format/typecheck**。行为矩阵与配置字段表见 `README.md`，本文件不重复。

## 命令

```sh
pnpm install                      # 装 vite/react 开发依赖（pnpm-lock.yaml 入库）
pnpm build                        # src/host + src/client → lib/（产物入库，与 src/ 同 commit）
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX+Windows），直测 src/host/scanner.js，不依赖构建与本机 dsh
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检（看守发布产物 lib/client.js）；--asar <app.asar> 或 DSH_HOME/DSH_ASAR 指定来源
node tmp/smoke/run.mjs            # 端到端 smoke（stub dsh 包 + 真 schemastery 校验写回）；tmp/ 不入库，缺失则跳过
```

- 改 `src/host/scanner.js` 或 shell 扫描行为 → 必跑 `verify-scanner.mjs`，新用例加进它的 `cases` 数组。
- 改任何 DSH 契约耦合面（审批词汇、pre-execute、插件记录、问答通道、client `require()`）→ 必跑 `check-compat.mjs`；它无 dsh 安装时 exit 1，属环境问题不是代码问题。
- smoke 的 settings stub 对每次写回跑真 `Config(patch)` 校验（schemastery 转发自 `tmp/asar` 提取物，缺了要先提取 asar）——配置形状失配在 smoke 就报红。改会话状态 API、UI 文案或 Config 形状时同步 smoke 的断言与硬编码值：断言落后 API 曾让 smoke 整段烂掉（`setBypass`→档位三态），T9 批次的回归因此漏网。smoke 直测 `src/host/**`，但对 `lib/client.js`（构建产物）做 bundle 断言，跑它前先 `pnpm build`。
- **`lib/` 下的文件是编译产物，不要主动去修改**——所有改动写进 `src/`，再 `pnpm build` 重新生成。
- 构建产物 `lib/` 必须随 `src/` 一起提交：安装走 git 源（`github:...`）取仓库内容、不跑构建，`prepare` 之类安装期脚本禁止出现（只允许 `prepack: "pnpm build"`）。

## 提交约定

- 提交信息写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`——PowerShell 下 `-m` 会毁掉引号。
- 提交信息类型前缀用英文（`feat:`/`fix:`/`docs:`/`build:` 等），正文中英文均可，可带任务编号（T1–T13）；一个任务一个 commit。
- README/docs 写中文，代码注释写英文。

## 结构

| 路径 | 角色 |
|---|---|
| `src/host/index.js` | cordis 插件入口（`export name/inject/Config/apply`）；门禁装配、Config 定义 |
| `src/host/scanner.js` | 纯词法路径扫描 + 读写口径（`toolAccessKind`），无依赖，可独立测 |
| `src/host/ask.js` | 三键会合点、presence 握手、回退链 |
| `src/host/approval-compat.js` | 官方 `approval/request` 瀑布封装（回退通道） |
| `src/host/session-state.js` | 会话档位三态与审计记录 |
| `src/host/remote-service.js` | client→host 管理 RPC（`workspaceOnly/*`） |
| `src/client/**` | Web 端 UI 源码（JSX；`index.jsx` 装配 `apply`/`inject`，见下） |
| `lib/` | **构建产物**（`pnpm build` 生成，入库 git、与 `src/` 同 commit）：host 6 文件 + `client.js` bundle |
| `scripts/` | 自检脚本（随 npm 包发布，`package.json.files` 已包含） |
| `docs/` | 任务书与迁移记录，**已入库** |
| `tmp/` | gitignored 工作区：smoke、探针、`commit-msg.txt` |

- `src/client/*.jsx` 是源码；`lib/client.js` 由 `vite.client.config.mjs` 生成：banner/intro/footer 三段式外壳（DSH 官方 tsdown 同款配方）包住 CJS bundle，`id` 必须是包名。顶部 `require()` 是平台模块表查询——**require 白名单 = vite external 白名单**（`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`），改一处必须同步另一处，`check-compat` 探测 7 看守；`require()` 必须是双引号（构建配置里的 `normalize-require-quotes` 负责归一化）。src 模块拆分**不得引入 import 环**——factory 形态的 CJS 循环依赖是致命错误。构建顺序：host 先（清 `lib/`）、client 后（`pnpm build` 的 `&&` 保证）。
- `docs/increment-plan.md` / `docs/optimization-plan.md` 是自包含任务书（含契约出入教训），改门禁语义前值得读；`docs/*migration*` 记录 src/+Vite 迁移的计划与现场修正（含 vite 配置陷阱）。
- `cordis.patch.yml` 只挂 host 插件行；**patch 的 `config` override 是整体替换**，写 override 要带全字段。

## 关键契约（不读源码/多文件推不出来）

- **会话持久化**：DSH 拒绝未知事件类型（除非 `ignorable: true`），而 `Session.append()` 不能设置该标记 → 插件状态一律走 `appendPluginRecord` 的 `plugin:` 记录（`session-state.js` 的 `RECORD`），不能用裸自定义事件。进程内 map 是权威，丢记录 fail-safe 回最严档位。
- **审批绕过 `ApprovalService`**：`approval-compat.js` 直接 `ctx.waterfall("approval/request")`，刻意不走 `ApprovalService.request()` 的 `never` 策略短路——Full access 会话也要弹窗，这是插件的核心价值。改这里会破坏核心语义。
- **升权跳过门禁**仅当 `sandbox_permissions` 目标模式**严格宽于**会话当前模式（官方升权弹窗必现时，避免双弹窗）；重复/畸形升权在官方侧零弹窗，必须照走三键。
- **client `require()` 白名单**：只允许平台 module table 已有模块（`check-compat` 探测 7 会抓越界）；0.2 已无 `@deepseek-ai/dsh-client-runtime`，所以自带 ~15 行 snapshot store，别改回官方 store。
- **`remote-service.js` 刻意不 import** `@deepseek-ai/dsh-typert-protocol`，binding/descriptor 字面复刻——保持在缺该包的 composition 上可加载。
- **不声明 `peerDependencies` 是有意的**：DSH 内部包以 prerelease（`0.2.1-rc.2`）演进，任何 semver 范围都会误报不兼容；兼容性只信 `check-compat.mjs`。
- **`.volatile()` 配置字段**（`enabled`/`always`/`sensitiveAlways`/`deny`）与设置表单共享同一实时引用，运行时写回走设置服务——别深拷贝。**集合元素的形状必须被 Config schema 收纳**：`always` 两种条目（字符串=全局、`{root, dir}`=会话级）都在 `z.union` 里；只声明过 `z.string()` 的那版会让每次 `{root, dir}` 写回被 schemastery 打回，症状极具误导性——卡片「总是允许该目录」静默降级为仅此一次（`grant()` 的 catch 吞掉错误）、白名单视图添加无反应，而设置页的全局添加（字符串）照常工作。新增条目形状先改 schema。
- **`LABELS.*` 既是文案又是匹配键**（`src/host/ask.js`）：回退问答 `choiceFromAnswer` 按 label 反查 choice——改文案只动常量即自洽，别把匹配逻辑改成硬编码字符串；smoke 的 `questionChoice` 引 `LABELS.always`。
- **平台 pending 投影每 session 只有一个席位**（`ui-session` 的 `publishPendingInteractions` 按 `sessionId` 取胜者）：同 session 并发多个 pending interaction 会互相遮蔽，答掉可见的那张只是让下一张补位——用户看到的正是「三键卡片点了不关」。子代理并行工具调用天然同 session 并发，所以 `ask.js` 的 `askOutside` **按 session 串行**（队列 + 出队白名单重查，承接 T2 批量放行语义）；且 Host 结算（超时/批量放行/多端作答）后必须广播 `askDone`（仍走 `settings/document-updated` 白名单事件）让各端 `closePanel` 撤卡，否则残留卡片永远留在 composer。客户端席位按 `requestId` 去重——重复 ask 负载会撞平台的 `duplicate pending interaction key`。
- **Windows 一等公民**：路径包含判定对 win 形态用 `path.win32` 语义（大小写不敏感）；盘符、UNC、`..\`、反斜杠转义、`%USERPROFILE%`/`$env:USERPROFILE` 都要扫到。改扫描先看 `verify-scanner.mjs` 的 false-positive 对照组。
- **失败方向永远 fail-closed**：超时=拒、无应答渠道=拒（`fastDenyMs>0` 时秒拒）、档位记录丢失=最严档。别改成 fail-open。
- **T13 徽章/toast 的挂载面**：徽章挂在 `conversation.session.header.actions`（session-scoped list slot，`inject: (sessionId) => props`，组件 props 另带平台的 `useSessions`）——标题旁动作列表，官方「N 个子智能体」下拉 `SubagentCatalogAction`（id `subagent-catalog`，order 10）就在这个槽位，徽章 order 11 紧随其后。**选槽位先看 `kind`**：`header.lineage` 是 `single` 且 `shadows-shipped-ui`（顶掉官方面包屑标题），`header.utilities` 虽是 list 但渲染在标题栏最右——都不是「下拉旁」。**跳子代理必须传 `SubagentAddress`**（`{parentSessionId, childSessionId, mode}`）：裸 SessionId 会被当普通会话打开、历史加载报 `subagent/not-found`。**`useSessions` 的 `byId` 行不带 `subagent.address`**（那是 per-Session `useSession` 快照的形状）——读错字段过滤永远不命中（卡片在、徽章无）。列表行用 `SessionSummary.parentId` 识别父子；点跳时基于 `parentId` 拼 `{parentSessionId, childSessionId, mode: "unknown"}`，`openPending` 内再经 `sessions.subagentAddress(childId)` 把 mode 精确化。徽章只在**父会话**显示（过滤 `byId[entry.sessionId].parentId === 当前视图 id`），别用「排除自己」的宽过滤——任何无关会话都会挂出「待审批 N」。**notice 状态的清理必须在结算同步路径做**（`settle`/`dismiss` 里直接清 `pendingStore`），只挂 `completion.promise.then` 会让全部审批后徽章仍残留计数；`then` 仅留幂等兜底 + 撤席位。`shell.overlay` 是官方明示的全局浮层 add-only 槽位，Toast 用 `ui-primitives` 的共享原语——**该包在冻结模块表里以 shell seed 形态内联**（`PLATFORM_MODULES` + `seed.ts`），app.asar 的 node_modules 里没有独立包，包路径探测会把活模块误报为 gone，`check-compat` 探测 14 改按「shipped bundle 是否 request 该 id」验证。探测 13 看守挂载面（header.actions / shell.overlay / openSession）。提示只读插件自身 ask 生命周期（`seats`/`askDone`），不碰官方 pending 投影。
- **自带 snapshot store 的 `update` 浅草稿对数组不安全**（`{...state}` 会把数组对象化、丢 `Array.prototype`）：集合状态用对象包裹（`{ entries: [...] }`）走草稿模式，或整替返回新数组；别对裸数组状态用草稿 mutator。
- 环境变量 `WORKSPACE_ONLY_PRESENCE_WAIT_MS` 缩短 presence 等待（smoke 用）。

## 环境

- 开发机是 Windows + PowerShell；DSH Desktop 的 asar 通常在 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`。
- Node `^22.19.0 || >=24.0.0`。`@deepseek-ai/*` 由 dsh 宿主提供、构建时一律 external——`node_modules` 只装 vite/react 开发依赖（react 仅供 JSX 解析，绝不进产物），产物不得引用它们以外的任何运行时依赖。本地跑 `src/host/index.js` 需要 stub（参考 `tmp/smoke/run.mjs`）。
