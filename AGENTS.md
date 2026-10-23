# AGENTS.md

DeepSeek Harness (dsh) 0.2.x 插件：在工具层把任意沙箱模式下的文件访问限制在会话工作区内，越界走三键裁决。源码在 `src/`（host 侧纯 ESM JS、client 侧 React JSX），pnpm + Vite 构建、产物在 `lib/`；**无测试框架、无 lint/format/typecheck**。行为矩阵与配置字段表见 `README.md`，本文件不重复。

## 命令

```sh
pnpm install                      # 装 vite/react 开发依赖（pnpm-lock.yaml 入库）
pnpm build                        # src/host + src/client → lib/（产物入库，与 src/ 同 commit）；两侧都走 build.minify:"oxc" 全量压缩（与官方 tsdown 产物同形态，不为看守保留字面形态）
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX+Windows），直测 src/host/scanner.js，不依赖构建与本机 dsh
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检（看守发布产物 lib/client.js）；--asar <app.asar> 或 DSH_HOME/DSH_ASAR 指定来源
node tmp/smoke/run.mjs            # 端到端 smoke（stub dsh 包 + 真 schemastery 校验写回）；tmp/ 不入库，缺失则跳过
```

- 改 `src/host/scanner.js` 或 shell 扫描行为 → 必跑 `verify-scanner.mjs`，新用例加进它的 `cases` 数组。
- 改任何 DSH 契约耦合面（审批词汇、pre-execute、插件记录、问答通道、client `require()`）→ 必跑 `check-compat.mjs`；它无 dsh 安装时 exit 1，属环境问题不是代码问题。
- smoke 的 settings stub 对每次写回跑真 `Config(patch)` 校验（schemastery 转发自 `tmp/asar` 提取物，缺了要先提取 asar）——配置形状失配在 smoke 就报红。改会话状态 API、UI 文案或 Config 形状时同步 smoke 的断言与硬编码值：断言落后 API 曾让 smoke 整段烂掉（`setBypass`→档位三态），T9 批次的回归因此漏网。smoke 直测 `src/host/**`，但对 `lib/client.js`（构建产物）做 bundle 断言，跑它前先 `pnpm build`。bundle 断言必须**压缩形态容错**（`\s*` 量词 + 不假设标识符/引号形态）——T18 起 `lib/client.js` 是 oxc 全压缩产物（标识符 mangle、单参箭头括号被去掉 `(scope) =>`→`scope=>`、普通字符串变反引号），写死源码形态的正则会整段假红；**smoke 既有 bundle 断言待按此适配**（T18 切换时 smoke 不在工作区，未同步）。
- **`lib/` 下的文件是编译产物，不要主动去修改**——所有改动写进 `src/`，再 `pnpm build` 重新生成。
- 构建产物 `lib/` 必须随 `src/` 一起提交：安装走 git 源（`github:...`）取仓库内容、不跑构建，`prepare` 之类安装期脚本禁止出现（只允许 `prepack: "pnpm build"`）。
- **任务完成后不要主动安装到本机 dsh**（`dsh plugin add`、往 profile 写 `cordis.patch.yml`、拷贝 `lib/` 进安装目录等都算）——构建与自检通过即止，安装/升级留给用户自己做。

## 提交约定

- 提交信息写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`——PowerShell 下 `-m` 会毁掉引号。
- 提交信息类型前缀用英文（`feat:`/`fix:`/`docs:`/`build:` 等），正文中英文均可，可带任务编号（T1 起连续编号，现状已到 T16+）；一个任务一个 commit。
- README/docs/代码注释均写中文（提交信息前缀仍用英文）。
- **缩进用 4 个空格，禁止 tab**（`src/`、`scripts/`、vite 配置、YAML 全适用）；仓库无 formatter 兜底，新代码靠自觉。

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

- `src/client/*.jsx` 是源码；`lib/client.js` 由 `vite.client.config.mjs` 生成：banner/intro/footer 三段式外壳（DSH 官方 tsdown 同款配方）包住 CJS bundle，`id` 必须是包名。顶部 `require()` 是平台模块表查询——**require 白名单 = vite external 白名单**（`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`），改一处必须同步另一处。产物不携带注释：host/client 都走 `build.minify: "oxc"` 全量压缩（T17/T18），**与官方 tsdown 产物同形态、不为任何看守保留字面形态**（T18 起 `mangle.reserved`、`normalizeRequireQuotes` 与 `require()` 双引号契约均已移除）：`factory: (require) =>` 会被 mangle 成 `e=>`，require 调用形态与字符串引号由 minify 器自选——`check-compat` 探测 7 的文本提取在压缩产物上取空集、**空真通过**（看守降级为 external 白名单自律 + 运行时加载即炸）；`Symbol.toStringTag` 不做任何处理（官方 intro 只有 module/exports 两行，bundler 追加的标记任其存在），**别写正则在压缩产物上做删除手术**（T18 该正则曾两次留下非法 token 序列 `,let`/`)let` 炸掉整个 bundle）。client 侧 `plugins: [inlineCssAsset]`（`inline-css-asset` 必须最后）。产物字符串的引号形态（`"`/`'`/`` ` ``）由 minify 器自行选择，**不作契约、不归一**。**样式走 CSS Modules**（`src/client/*.module.css`，官方 ui-primitives 同款 `import css from "./X.module.css"` + `css.xxx`）：构建期 `inline-css-asset` 把 css asset 拼进 `styles.js` 的 `__WORKSPACE_ONLY_CSS__` 占位符并删掉 asset（DSH 加载器只吃单文件 JS），运行时 `installStyles` 幂等注入 `<style>`——它的 `generateBundle` 必须 `order: "post"`（vite css-post 的 asset 晚进 bundle，普通时机看不见、会静默漏注入）；`generateScopedName` 用函数拼 `文件名__类名`（`[name]` 模板在 vite 管线里恒解析成 `module`、跨文件撞名）；`build.cssMinify: true` 负责剥 CSS 注释（`/*$vite$:N*/` 标记由内联插件顺手剥）。src 模块拆分**不得引入 import 环**——factory 形态的 CJS 循环依赖是致命错误。构建顺序：host 先（清 `lib/`）、client 后（`pnpm build` 的 `&&` 保证）。
- `docs/increment-plan.md` / `docs/optimization-plan.md` 是自包含任务书（含契约出入教训），改门禁语义前值得读；`docs/*migration*` 记录 src/+Vite 迁移的计划与现场修正（含 vite 配置陷阱）。
- `cordis.patch.yml` 只挂 host 插件行；**patch 的 `config` override 是整体替换**，写 override 要带全字段。

## 关键契约（不读源码/多文件推不出来）

- **会话持久化**：DSH 拒绝未知事件类型（除非 `ignorable: true`），而 `Session.append()` 不能设置该标记 → 插件状态一律走 `appendPluginRecord` 的 `plugin:` 记录（`session-state.js` 的 `RECORD`），不能用裸自定义事件。进程内 map 是权威，丢记录 fail-safe 回**初值**（普通会话=最严档位；子代理会话=父档位快照，见下条）。
- **审批绕过 `ApprovalService`**：`approval-compat.js` 直接 `ctx.waterfall("approval/request")`，刻意不走 `ApprovalService.request()` 的 `never` 策略短路——Full access 会话也要弹窗，这是插件的核心价值。改这里会破坏核心语义。
- **升权跳过门禁**仅当 `sandbox_permissions` 目标模式**严格宽于**会话当前模式（官方升权弹窗必现时，避免双弹窗）；重复/畸形升权在官方侧零弹窗，必须照走三键。
- **client `require()` 白名单**：只允许平台 module table 已有模块；T18 全压缩后 `check-compat` 探测 7 的文本提取取空集、空真通过（**不再抓越界**），约束靠 vite external 白名单自律 + 运行时加载即炸。0.2 已无 `@deepseek-ai/dsh-client-runtime`，所以自带 ~15 行 snapshot store，别改回官方 store。
- **`remote-service.js` 刻意不 import** `@deepseek-ai/dsh-typert-protocol`，binding/descriptor 字面复刻——保持在缺该包的 composition 上可加载。
- **不声明 `peerDependencies` 是有意的**：DSH 内部包以 prerelease（`0.2.1-rc.2`）演进，任何 semver 范围都会误报不兼容；兼容性只信 `check-compat.mjs`。
- **`.volatile()` 配置字段**（`enabled`/`always`/`sensitiveAlways`/`deny`）与设置表单共享同一实时引用，运行时写回走设置服务——别深拷贝。**集合元素的形状必须被 Config schema 收纳**：`always` 三种条目（字符串=全局、`{session, dir}`=T20 会话级绑主会话血缘根、`{root, dir}`=T9 旧项目级仅保留接受、匹配与展示软忽略）都在 `z.union` 里；只声明过 `z.string()` 的那版会让每次对象条目写回被 schemastery 打回，症状极具误导性——卡片「总是允许该目录」静默降级为仅此一次（`grant()` 的 catch 吞掉错误）、白名单视图添加无反应，而设置页的全局添加（字符串）照常工作。新增条目形状先改 schema（`tmp/probe-always-schema.mjs` 守 round-trip）。
- **`LABELS.*` 既是文案又是匹配键**（`src/host/ask.js`）：回退问答 `choiceFromAnswer` 按 label 反查 choice——改文案只动常量即自洽，别把匹配逻辑改成硬编码字符串；smoke 的 `questionChoice` 引 `LABELS.always`。
- **平台 pending 投影每 session 只有一个席位**（`ui-session` 的 `publishPendingInteractions` 按 `sessionId` 取胜者）：同 session 并发多个 pending interaction 会互相遮蔽，答掉可见的那张只是让下一张补位——用户看到的正是「三键卡片点了不关」。子代理并行工具调用天然同 session 并发，所以 `ask.js` 的 `askOutside` **按 session 串行**（队列 + 出队白名单重查，承接 T2 批量放行语义）；且 Host 结算（超时/批量放行/多端作答）后必须广播 `askDone`（仍走 `settings/document-updated` 白名单事件）让各端 `closePanel` 撤卡，否则残留卡片永远留在 composer。客户端席位按 `requestId` 去重——重复 ask 负载会撞平台的 `duplicate pending interaction key`。**撤卡还要防 askDone 丢失与回退问答卡残留**（T16）：`askQuestion` 的本地超时/迟到决策后必须 `aborter.abort()`（平台按 `request.signal` 撤 question 卡；不 abort 则问答卡永远留在 composer——「超时了卡片也不消失」的根因）；客户端消费 `announce` 返回值 `{ok:false}`（Host 已结算）立即 dismiss 迟到卡，并有 `dialogTimeoutMs`+15s 自毁计时兜住 askDone 丢失——本地撤卡不发 `decide`、不改裁决（Host 超时本来就拒，fail-closed）。
- **Windows 一等公民**：路径包含判定对 win 形态用 `path.win32` 语义（大小写不敏感）；盘符、UNC、`..\`、反斜杠转义、`%USERPROFILE%`/`$env:USERPROFILE` 都要扫到。**正则/注释碎片不是路径**（T15，`isRegexOrCommentSlash`）：`/\*`、`//`、`/*` 形态豁免（`//server/share` UNC 斜杠写法因带 share 段仍报；bare `/*` 保留 glob 语义），三处判定点（INTERIOR_PATH 前瞻、shell token 级、pattern 判定）必须同步该语义——`-Pattern '^\s*(//|/\*|\*)'` 曾被扫成 `//` 越界而误弹审批。Windows 斜杠开关（`findstr /R`）与单段绝对路径词法不可分，保留保守误报。改扫描先看 `verify-scanner.mjs` 的 false-positive 对照组。
- **失败方向永远 fail-closed**：超时=拒、无应答渠道=拒（`fastDenyMs>0` 时秒拒）、档位记录丢失=回初值（普通会话=最严档；子代理会话=父档位快照）。别改成 fail-open。
- **子代理档位继承是快照、不是联动**（`session-state.js` 的 `scopeOf`）：子会话（header `parentSession`）无自有档位记录时继承父会话当前档位，并立即写 `{ scope, inherited: true }` 记录**定格**——之后改父不影响子、改子不影响父（`subagent_fork` 的日志前缀自带 fork 时刻快照，`foldScopeEntry` 直接命中、不走继承分支）。血缘行走必须防环（平台测试里有 loop-a↔loop-b 环状 `parentSession` 用例）+ 深度上限，父不可解析/成环回默认最严档。bare session id 没有 header 不能继承（`sessionScope` 的 id 路径只读 live 值）。调用点必须传 `resolveParent`（index.js 四处：systemPrompt、pre-execute、snapshot 的 sessions 映射与顶层 scope）；snapshot 顶层 scope 用 `resolveSession(ctx, id) ?? id` 对象优先。T20 白名单的血缘根解析 `rootSessionIdOf` 同款防环 + 深度上限，但失败方向是**停在最后解析成功的节点**（退回自身 id = 收紧多问），与档位的「回最严默认档」同为 fail-closed。
- **T13 徽章 / T19 行黄点的挂载面**：徽章挂在 `conversation.session.header.actions`（session-scoped list slot，`inject: (sessionId) => props`，组件 props 另带平台的 `useSessions`）——标题旁动作列表，官方「N 个子智能体」下拉 `SubagentCatalogAction`（id `subagent-catalog`，order 10）就在这个槽位，徽章 order 11 紧随其后。**选槽位先看 `kind`**：`header.lineage` 是 `single` 且 `shadows-shipped-ui`（顶掉官方面包屑标题），`header.utilities` 虽是 list 但渲染在标题栏最右——都不是「下拉旁」。**跳子代理必须传 `SubagentAddress`**（`{parentSessionId, childSessionId, mode}`）：裸 SessionId 会被当普通会话打开、历史加载报 `subagent/not-found`。**`useSessions` 的 `byId` 行不带 `subagent.address`**（那是 per-Session `useSession` 快照的形状）——读错字段过滤永远不命中（卡片在、徽章无）。列表行用 `SessionSummary.parentId` 识别父子；点跳时基于 `parentId` 拼 `{parentSessionId, childSessionId, mode: "unknown"}`，`openPending` 内再经 `sessions.subagentAddress(childId)` 把 mode 精确化。徽章只在**父会话**显示（T21 起优先判 ask 载荷的 `parentSessionId === 当前视图 id`，`byId[entry.sessionId].parentId` 仅兜底——刚启动的子代理还没进 `byId` 快照时，只靠它过滤会让徽章在最需要的时候消失），别用「排除自己」的宽过滤——任何无关会话都会挂出「待审批 N」。**notice 状态的清理必须在结算同步路径做**（`settle`/`dismiss` 里直接清 `pendingStore` 与 `rowNotices` 影子），只挂 `completion.promise.then` 会让全部审批后徽章/黄点仍残留计数；`then` 仅留幂等兜底 + 撤席位。**T19 行黄点是 precedence -1 的影子 pending 交互**（T21 起与卡片**同一个** pending 域：`registerPendingInteraction` 的 precedence 函数按 `source` 动态给分——卡片 0、影子 -1；key `workspace-only-notice:<requestId>`，挂 ask 载荷的 `parentSessionId`）：平台赢家规则 `precedence >= previous` 后到赢，官方卡与本插件卡片（0）永远压过影子——绝不遮蔽真实卡片。**别再为影子单独注册第二个 `registerPendingInteraction` 域**——T19 首版如此，与「三键卡片/徽章/黄点一齐消失、全部回退 user-question/官方卡」的整批失效时间点吻合（首要嫌疑面），合并单域后不再有该风险。影子 `source: "workspace-only-notice"`（不是 "workspace-only"，composer 链无人认领、不渲染卡片）、非官方类实例，delegate 空转。**`closePanel` 撤卡调 `seats.get(requestId)?.()`**——`seats` 存的就是 dismiss 函数本体；曾误写 `?.dismiss()`，TypeError 会把 askDone 撤卡整个炸掉（卡片/黄点残留，tmp/probe-client-apply.mjs 实锤）。**T19 已移除 toast**（`shell.overlay` 槽位、`WorkspaceOnlyToast`、`pending.toast` 均删，`check-compat` 探测 13 不再看守 `shell.overlay`）——别加回来：主会话 ask 的卡片就在 composer 里，toast 文案曾把主会话 ask 误报成「子代理请求」。`ui-primitives` 仍被控件/图标 require（探测 14 按「shipped bundle 是否 request 该 id」验证该包在冻结模块表里以 shell seed 形态内联，app.asar 的 node_modules 里没有独立包）。提示面只读插件自身 ask 生命周期（`seats`/`askDone`/`rowNotices`），影子是唯一碰官方 pending 域的点（precedence -1，见上）。
- **自带 snapshot store 的 `update` 浅草稿对数组不安全**（`{...state}` 会把数组对象化、丢 `Array.prototype`）：集合状态用对象包裹（`{ entries: [...] }`）走草稿模式，或整替返回新数组；别对裸数组状态用草稿 mutator。
- 环境变量 `WORKSPACE_ONLY_PRESENCE_WAIT_MS` 缩短 presence 等待（smoke 用）。

## 环境

- 开发机是 Windows + PowerShell；DSH Desktop 的 asar 通常在 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`。
- Node `^22.19.0 || >=24.0.0`。`@deepseek-ai/*` 由 dsh 宿主提供、构建时一律 external——源码 import 过的宿主包（`@deepseek-ai/cordis`、`dsh-session`、`dsh-scope`、`dsh-user-approval`、`dsh-client-ui-primitives`、`schemastery`）已钉进 `devDependencies`（版本对齐本机 asar 的 `0.2.1-rc.2` / 稳定版），**仅供 IDE/本地解析与 smoke stub 对照，绝不进产物**；react 仅供 JSX 解析。产物不得引用这些包以外的任何运行时依赖。本地跑 `src/host/index.js` 需要 stub（参考 `tmp/smoke/run.mjs`）。
