# dsh-workspace-only-plugin 对标 MiMo-Code 优化任务书

> **用途**：本文档自包含，供独立编码代理直接实施。背景、动机、契约、验收全部在内，不依赖任何对话上下文。
> **基线**：`docs/increment-plan.md` 的五项增量（E1/A/B/D + 风险退役）已完成（见其 §6.1 实施记录），本任务书是第二批：与 MiMo-Code `external_directory` 权限门禁逐项对照后的差距修复。
> **仓库**：`D:\Code\Nodejs\dsh-workspace-only-plugin`（branch `main`）。MiMo-Code 参考实现在 `D:\Code\Nodejs\MiMo-Code`（**只读参考，严禁改动**）。
> **日期**：2026-10-21。对照的 DSH 版本：0.2.1-rc.2。

---

## 0. 任务概览

| # | 优先级 | 任务 | 一句话 | 改动文件 |
|---|---|---|---|---|
| T1 | **P0** | 升权跳过收紧 | `sandbox_permissions` 跳过门禁可被"重复升权"绕过 | `lib/index.js`、`scripts/check-compat.mjs` |
| T2 | **P0** | always 批量解锁 pending | 选"总是允许本目录"后同目录其他挂起调用直接放行 | `lib/ask.js`、`lib/index.js` |
| T3 | **P0** | home 形态统一展开 | `~`/`$HOME`/`%USERPROFILE%` 三重不对称修复 | `lib/scanner.js`、`scripts/verify-scanner.mjs` |
| T4 | P1 | 敏感文件工作区内询问 | 读 `*.env` 等敏感文件即使在工作区内也弹三键 | `lib/index.js`、`lib/scanner.js`、`lib/ask.js`、`lib/client.js` |
| T5 | P1 | deny 黑名单 | `Config.deny` 命中直接拒绝、不弹窗、最高优先级 | `lib/index.js`、`lib/client.js` |
| T6 | P1 | 非交互快速 fail-closed | 后台/无 UI 调用秒级拒绝，不挂 120s | `lib/ask.js`、`lib/index.js` |
| T7 | P1 | shell 扫描 `=` 形态 | `FOO=/etc/x`、`--out=C:\x` 当前完全漏扫 | `lib/scanner.js`、`scripts/verify-scanner.mjs` |
| T8 | P1 | 全工具参数形状扫描（opt-in） | 白名单 8 工具之外的工具默认不设防 | `lib/scanner.js`、`lib/index.js` |
| T9 | P2（可选） | 白名单作用域 | `Config.always` 全局共享 → 可选"仅当前工作区根" | `lib/index.js`、`lib/client.js` |
| T10 | P2（可选） | 并发卡片合并 | 一次调用多处越界合并为一张卡 | `lib/ask.js`、`lib/client.js` |
| T11 | P2（可选） | symlink 残余面 | 文档化 + 可选 realpath 复核 | `README.md`（+可选 `lib/index.js`） |

**实施顺序**：T1 → T2 → T3 → T7（以上四个互相独立、每个都可单独提交）→ T4 → T5 → T6 → T8 →（P2 按需）。

**每完成一项**：`node scripts/verify-scanner.mjs`、`node scripts/check-compat.mjs`、`node tmp/smoke/run.mjs`（若存在）三件套全绿，单独一个 commit（`git commit -F tmp/commit-msg.txt`，见 §6 约定）。

---

## 1. 背景：与 MiMo-Code 的对照结论

MiMo-Code 的"读工作区外文件需审批"能力 = 工具层权限门禁 `external_directory`（非 OS 沙箱）：各文件工具执行前经 `assertExternalDirectoryEffect` 判定路径是否在 `Instance` 边界（启动目录 ∪ git worktree 根）内，越界则经 `ctx.ask` 走规则评估 + 人工审批，默认 `ask`，用户可答 `once/always/reject`，`always` 写入 glob 规则持久化并**顺带放行同会话所有已匹配的挂起请求**。

本插件是该能力在 DSH 上的复刻（`tools/pre-execute` 门禁 + 三键卡片 + 目录白名单 + 会话放飞）。逐项对照后的差距即本任务书 T1–T11。MiMo 对照物（编码代理需要核对语义时**只读**查阅）：

| 语义 | MiMo-Code 位置 |
|---|---|
| 越界门禁与豁免（memory 子树 / 受信 worktree） | `packages/cli/src/tool/external-directory.ts:21-67` |
| 统一写门（新写工具"忘记接线"不可表达） | `packages/cli/src/tool/external-directory.ts:92-141` |
| `always` 回复写规则 + **批量解锁同会话匹配 pending** | `packages/cli/src/permission/index.ts:480-520` |
| 非交互（`interactive:false`）直接 `DeniedError`，不挂起 | `packages/cli/src/permission/index.ts:335-343` |
| 默认敏感文件规则：`read: {"*.env": "ask", "*.env.*": "ask", "*.env.example": "allow"}` | `packages/cli/src/agent/agent.ts:127-146` |
| deny 优先级最高、`FORCED_ASK` 不可预授权 | `packages/cli/src/permission/index.ts:205-206, 266-272` |
| bash tree-sitter 路径解析、`~`/`$HOME` 展开后判定、命令词表 | `packages/cli/src/tool/bash.ts:74-141, 540-646` |

**已验证不需要追的差距**（不要做）：
- `run_code` 子工具调用经 `scheduler.prepare` → `runGuard` → 同一条 `tools/pre-execute` 瀑布（`dsh-tools` lib/index.js:1431→3321），本插件门禁天然覆盖，**不是洞**；
- MiMo 的 `bash_delete`/`GIT_DESTRUCTIVE` 强制确认属"不可逆操作确认"维度，不是工作区边界问题，留给官方 approval 流程；
- tree-sitter 级 shell 解析成本/收益不成比例，词法扫描 + T3/T7 补强后残余面可控。

---

## 2. 插件现状代码地图（精确到行，行号以本仓库当前 HEAD 为准）

- `lib/index.js`（233 行）：门禁装配。`Config`（46-55：`enabled`/`always`/`renamePresetLabel`/`dialogTimeoutMs`，均 schemastery）；`tools/pre-execute` 处理器（144-173）：检查顺序 = `sandbox_permissions` 跳过（**146，T1 修这里**）→ `ensureBypassPersisted` → `isBypassed` → `isEnabled` → `outsideTargets(...).filter(!alwaysAllows)` → `askFlow.askOutside` → `once|always` 放行 / 其余 deny。Remote service 装配（177-209）。
- `lib/scanner.js`（221 行）：纯词法扫描。`lexicallyWithin`（36-45，`HOME_PREFIX` 短路 **39，T3 修这里**）；`INTERIOR_PATH`（76，前缀字符类 `['\"``\s(]`，**T7 加 `=`**）；`shellTargets`（119-155，`$HOME` 整命令拒绝 **122-125，T3 修这里**）；`outsideTargets`（171-195）；工具白名单 `PATH_TOOLS`/`SEARCH_TOOLS`/`SHELL_TOOLS`（217-221，**T8 扩展**）；`directoryOf`（207-214）。
- `lib/ask.js`（364 行）：三键会合点。`createAskFlow`（87-185）：panel（`settings/document-updated` ask 载荷 + presence 握手 + 迟到卡片保留席位）→ `userQuestions` → `approval/request` 瀑布 → deny。`decide`（104-110，**T2 批量解锁**）；`askOutside` 的 `grant()`（133-143，always 持久化）。
- `lib/session-state.js`：会话放飞 + `plugin:workspace-only/*` 审计记录（`recordAsk`/`recordDecision`/`recordAlwaysAdded`）。
- `lib/remote-service.js`：`workspaceOnly/*` RPC（snapshot/setBypass/addAlways/removeAlways/clearRecent/announce/decide/pendingList）。
- `lib/client.js`：composer 三键卡片 + 会话级快捷按钮（当前会话 id 取 `localStorage["dsh.sessions.current"]`，composer 选举入参兜底）+ 设置面板。
- `scripts/verify-scanner.mjs`：扫描器独立用例（当前 50/50）。
- `scripts/check-compat.mjs`：对本机 dsh 安装的契约探针（当前 10 项）。
- `tmp/smoke/run.mjs`：带 stub 的装配冒烟（当前 16/16）。

---

## 3. DSH 运行时契约（实现依据，均已验证）

### 3.1 升权词汇（T1 的核心依据，引自 `@deepseek-ai/dsh-sandbox` README）

- 被围栏拒绝的调用可**原样重试一次**，携带 `sandbox_permissions`（封闭 enum：`workspace-write` / `danger-full-access`）+ `justification`（成对必填，"Callers validate the `sandbox_permissions`/`justification` pairing first"）。
- **关键语义**：`approveEscalation` "returns the current mode **without approval when it is repeated**, rejects narrower or unsupported targets, and requests approval for wider modes"；"A wider mode requires approval and applies to that one call only. **Repeating the call's effective mode succeeds without approval**; narrower targets remain invalid."
- 升权阶梯（封闭表）：`read-only` → `workspace-write` | `danger-full-access`；`workspace-write` → `danger-full-access`。即"目标模式严格宽于会话当前模式"⇔"官方必弹人审"；等于当前模式（repeated）⇔ **无审批放行**。
- 会话当前模式由 `@deepseek-ai/dsh-sandbox-policy` 按会话提供（`read-only` / `workspace-write` / `danger-full-access`）。服务注入名/取值 API 需在实施时探查（提取物在 `tmp/asar/dsh/node_modules/@deepseek-ai/dsh-sandbox-policy/lib/index.js`）。

### 3.2 `tools/pre-execute`（`@deepseek-ai/dsh-tools`）

waterfall 决策词汇：`{kind:"allow"}` / `{kind:"deny", reason}` / `{kind:"ask"}` / `{kind:"cancel"}`。**pre-execute 在参数 schema 校验之前执行**（`scheduler.prepare` 先跑 runGuard 瀑布，`tool.execute` 内才 validateArgs）——门禁看到的 `exec.arguments` 是 JSON 归一化但未经 schema 校验的原始形状。

### 3.3 审批与三键通道（沿用上一批的既有实现，勿破坏）

- `approval/request` 瀑布结果封闭词汇 `allowed-once | rejected | cancelled | unavailable`；面板路径**不写** `approval/asked`/`approval/decided`（防 GUI 双弹），走 `settings/document-updated` 的 ask 载荷 + `workspaceOnly/decide` RPC。
- composer pending 投影必须携带 `requestId`；卡片 mount 后 `registerPendingInteraction` 返回撤座函数 `remove()`，result settle 后必须调用；`announce` 在 ask 负载到达瞬间同步发出（presence 握手与渲染周期解耦）。详见 `docs/increment-plan.md` §6.1 第 9/11 条。
- 审批结果只有 `allowed-once`——"记住授权"完全由本插件 `Config.always` 承担。

### 3.4 配置模型

schemastery（**不是 zod**）：整数用 `z.number().step(1).min(n)`（无 `.int()`）；运行时可写字段用 `.default(x).volatile()`，读取经 `readVolatile()`（`.get()`）；写回经 `settings.update("workspace-only", patch)`。`cordis.patch.yml` 的 override 是**整体替换** `config`。

### 3.5 兼容性防线

`peerDependencies` 对 prerelease 版本恒误报，**不声明**；真实兼容性由 `scripts/check-compat.mjs` 探测（asar 读取器内嵌，探针模式见其 10 项现有条目）。

---

## 4. 任务详述

### T1（P0）. 收紧 `sandbox_permissions` 跳过条件

**动机 / 根因**（实锤绕过）：`lib/index.js:146` 一行 `if (args.sandbox_permissions !== void 0) return next();`，假设"带升权字段的调用必有人审"。但 §3.1 的 repeated 语义击穿该假设：模型给 `bash`/`pwsh`（或任何声明了该字段的工具）附带 `sandbox_permissions: "<当前模式>" + justification: "..."` → 本插件跳过门禁 → 官方 `approveEscalation` 判定 repeated → **无任何弹窗** → 命令里的越界路径静默执行。`danger-full-access` 会话下连写都静默放行；`workspace-write` 下 shell 越界读静默（`dsh-fs-sandbox` 只拦写不拦读）。调用形态完全合法（字段是工具 schema 的正规参数），无需伪造。

**目标行为**：只有当"官方升权流程**一定**会弹人审"时才跳过门禁；其余情况照走三键。

**实现要点**：
1. `lib/index.js` pre-execute 里把跳过条件改为**同时满足**：
   - `args.sandbox_permissions` ∈ {`"workspace-write"`, `"danger-full-access"`}（封闭 enum）；
   - `typeof args.justification === "string" && args.justification.trim() !== ""`（成对校验）；
   - `args.sandbox_permissions` **严格宽于**会话当前模式（读 §3.1 阶梯；`read-only`→`workspace-write` 可跳、`read-only`→`danger-full-access` 可跳、`workspace-write`→`danger-full-access` 可跳，其余一律不跳）。
2. 会话当前模式的获取：探查 `dsh-sandbox-policy` 的服务/注入名（`tmp/asar/.../dsh-sandbox-policy/lib/index.js`），按会话取值。**若探查不到可靠 API，采用兜底方案：完全不跳过**（任何 `sandbox_permissions` 调用都照走门禁，接受合法升权时的双弹窗），并在代码注释与 README 边界节写明取舍。宁可双弹，不可绕过。
3. 保留原有设计意图的注释：跳过是为了避免"插件三键 + 官方升权弹窗"双弹，前提是官方弹窗必现。
4. `scripts/check-compat.mjs` 加第 11 项探针：在 `dsh-sandbox` README/源码中探测 repeated 语义的关键句（如 `"succeeds without approval"`），语义消失或变化时打印差异告警。

**验收**：
- 构造 `bash` 调用，参数含 `sandbox_permissions: "<当前会话模式>"` + `justification: "x"`，命令含越界路径 → **仍弹三键**（修复前静默放行）；
- `sandbox_permissions` 为非法值 / 缺 `justification` / narrow 或 repeated 目标 → 均照走门禁；
- （若拿到模式 API）合法宽升权调用 → 不弹三键，只走官方升权弹窗。

### T2（P0）. "总是允许本目录"批量解锁挂起调用

**动机**：MiMo 的 `always` 回复在写入规则后，遍历同会话 pending，所有 patterns 已被新规则放行的请求**立即以 `always` 放行**（`permission/index.ts:507-520`）。插件当前 `decide`（`lib/ask.js:104-110`）只 settle 单个 `requestId`——批量操作（一个 turn 内多个工具越界同一目录）连环弹 N 张卡，第一张选了"总是允许"后其余照样问。

**目标行为**：一次"总是允许本目录"后，同会话所有目标已落入新白名单目录的挂起调用立即放行、卡片撤座。

**实现要点**：
1. pending entry 增加字段 `sessionId`（ask 负载已有，entry 存一份）与 `targets: string[]`（`outsideTargets` 的原始 path 列表，经 T3 的 home 展开后存）。
2. `createAskFlow` 的 options 增加 `isAlwaysAllowed(path)` 回调（由 `lib/index.js` 传入现有 `alwaysAllows`，注意它内部用 `lexicallyWithin`）。
3. `askOutside` 的 `grant()` 成功写入白名单后，调用新增的 `askFlow.releaseMatching(sessionId)`：遍历 `pending`，对 `sessionId` 相同且 `entry.targets.some(isAlwaysAllowed)` 的条目以 `CHOICE.always` resolve（走既有 `entry.resolve`，让对应 pre-execute 返回 `{kind:"allow"}`；client 侧撤座契约已由 result settle 触发 `remove()`，无需额外处理），并补一条 `recordDecision`（`channel: "always-batch"` 或既有词汇，保持审计完整）。
4. 同步给 `pendingList()` 输出加 `sessionId` 字段（诊断用）。

**验收**：smoke 新用例——两个并发越界调用（同目录），第一个答"总是允许"，第二个不弹卡直接放行；不同目录的挂起调用不受影响。回归全绿。

### T3（P0）. home 形态统一展开（三重不对称修复）

**动机**：同一台 Windows 上三个方向的偏差——
| 形态 | 现状 | 问题 |
|---|---|---|
| `~/x`、`~\x` | `lexicallyWithin` 短路 `false`（`scanner.js:39`） | 一律判越界；**白名单永远盖不住**（`alwaysAllows` 同样短路） |
| `$HOME` / `${HOME}` | `shellTargets` 整条命令一刀切拒绝（`scanner.js:122-125`） | `echo '$HOME'` 字符串也弹；过度保守 |
| `%USERPROFILE%` / `%HOMEPATH%` / `$env:USERPROFILE` / `$env:HOMEPATH` | **完全不识别** | Windows 形态漏扫（欠保守），与盘符支持不对称 |

MiMo 的做法是展开后按真实路径判定（`bash.ts` 的 `home()`/`expand()`）。

**目标行为**：所有 home 形态先展开为真实路径（`process.env.USERPROFILE` / `os.homedir()`），展开后走统一的 `lexicallyWithin` 判定；展开不出来（env 缺失）保持 fail-safe 判越界。

**实现要点**：
1. `lib/scanner.js` 新增 `expandHomeSpelling(value, env)`：识别并替换前缀 `~`、`~/`、`~\`、`$HOME`、`${HOME}`、`%USERPROFILE%`、`%HOMEPATH%`、`$env:USERPROFILE`、`$env:HOMEPATH`（后四者注意 PowerShell 形态后直接跟 `\` 或 `/`）。返回展开后的路径或 `undefined`（未识别/无法展开）。
2. 接线点：
   - `pathTarget`（`scanner.js:95-100`）：先尝试展开，展开成功按展开值判 `lexicallyWithin`，reason 里保留原始拼写（用户看得懂）；展开失败且以 home 前缀开头 → 保持现状（判越界，fail-safe）。
   - `shellTargets`：删除 122-125 的整命令短路，改为 token 级展开判定（`tokenCandidates` 之后、`isAbsoluteToken` 之前插入展开尝试）；`%...%` 形态 token 也要过 `isAbsoluteToken`/展开逻辑（当前完全不进 INTERIOR_PATH 匹配）。
   - `lexicallyWithin` 的 `HOME_PREFIX` 短路**保留**（对未展开 `~` 的 fail-safe），但所有调用方（含 `alwaysAllows`）先过展开。
3. `alwaysAllows`（`lib/index.js:109-111`）对展开后的路径判定——白名单 `C:\Users\me` 从此能盖住 `~/x`。
4. `scripts/verify-scanner.mjs` 增用例（POSIX + Windows 各一组）：`~/x` 展开等价 `HOME/x`；白名单盖住 `~/x`；`%USERPROFILE%\secret` 越界/白名单正确；`$env:USERPROFILE\x` 同；`echo '$HOME'` **不再**整命令拒绝但 `cat $HOME/secret` 报警（展开后越界）；`HOME` 缺失时 fail-safe 报警。

**验收**：上述用例全绿，50+ 用例无回归。

### T4（P1）. 敏感文件在工作区内也询问

**动机**：MiMo 默认 `read: {"*.env": "ask", "*.env.*": "ask", "*.env.example": "allow"}`（`agent.ts:140-145`）——防泄露 `.env` 是与越界正交的维度。插件当前工作区内一切静默。

**目标行为**：新增敏感文件维度：命中敏感 basename 的路径（无论工作区内/外）都弹三键；与越界判定正交（一次调用既越界又敏感时只弹一次）。

**实现要点**：
1. `Config` 新增：
   - `sensitivePatterns: z.array(z.string()).default(["*.env", "*.env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*"])`（对**basename** 做 glob 匹配，glob→RegExp 自实现，无新依赖）；
   - `sensitiveAllowPatterns: z.array(z.string()).default(["*.env.example", "*.env.sample", "*.env.template", "*.env.defaults"])`（豁免，优先于 `sensitivePatterns`）；
   - `sensitiveAlways: z.array(z.string()).default([]).volatile()`（"总是允许此类文件"的 pattern 持久化）。
2. 判定函数放 `lib/scanner.js`（纯函数可测）：`sensitiveReason(value, config)` → reason | undefined。对 `outsideTargets` 的全部目标（含工作区内）以及 shell 扫描到的路径目标统一判定。
3. 门禁接线（`lib/index.js` pre-execute）：先收集目标 → 过 `sensitiveAllowPatterns`/`sensitiveAlways` 豁免 → 命中敏感且未豁免 → 走 `askFlow` 三键（reason 注明"敏感文件"）。与越界命中合并为一次弹窗（reason 拼接）。
4. 三键语义：`once` 放行本次；`always` 写入 `sensitiveAlways`（**pattern 级**，不是目录级——不要复用 `Config.always`，语义不同）；`deny` 拒绝。`lib/client.js` 的卡片按钮文案对敏感命中改为"总是允许此类文件"（字典键 `alwaysSensitive`，locale en/zh 各加一条）。
5. `ask.js` 的 `grant()` 扩展一个 `grantKind`（`"dir"` | `"pattern"`）以支持两种 always。

**验收**：工作区内读 `.env` 弹三键；`.env.example` 不弹；选"总是允许此类文件"后同类文件（其他目录的 `.env`）不再弹；越界读 `.env` 只弹一次；smoke + verify-scanner 加护栏。

### T5（P1）. deny 黑名单

**动机**：MiMo 的 deny 规则优先级最高，连 `skipAll`/approved 都压不过（"Deny rules and forced-ask permissions still apply"）。插件只有放行方向，用户无法标记"这里永远不许碰"。

**目标行为**：`Config.deny`（目录或 glob 列表）命中 → 直接 `{kind:"deny"}`，**不弹窗**，优先级最高（压过白名单、压过会话放飞、压过总开关关闭——见 §5 决策 D4）。

**实现要点**：
1. `Config` 新增 `deny: z.array(z.string()).default([])`；匹配语义：条目以 `/` 或 `\` 结尾按目录前缀包含（`lexicallyWithin`），否则按 glob（复用 T4 的 glob→RegExp，对完整路径匹配）。
2. pre-execute 检查顺序改为：**deny 命中** → `sandbox_permissions` 跳过（T1 收紧后）→ bypass → enabled → always → 敏感（T4）→ 越界三键。deny 命中的 reason 明确写 `[workspace-only] denied by deny rule: <条目>`。
3. `lib/client.js` 设置页加 deny 列表管理（增删展示，复用 always 列表的既有 UI 模式）；Remote service 加 `addDeny`/`removeDeny`。
4. README"行为矩阵 · 通用规则"补一条：deny 规则在任何模式/任何开关下都拒绝，且不可被放飞/白名单覆盖。

**验收**：白名单目录同时出现在 deny 里 → 直接拒绝不弹；放飞的会话访问 deny 目录 → 拒绝；总开关关 + deny 命中 → 拒绝。

### T6（P1）. 非交互调用快速 fail-closed

**动机**：MiMo 对 `interactive: false` 的后台 agent 直接 `DeniedError` 而非挂起（`permission/index.ts:335-343`），否则后台 checkpoint 类任务在无人应答时死锁/拖满超时。插件当前对无 UI 调用走完整链路：panel presence 3s → question 最长 `dialogTimeoutMs`（120s）→ systemDialog → deny。

**目标行为**：无应答渠道的调用秒级拒绝，不占用 120s 等待。

**实现要点**（按探查结果二选一，或组合）：
1. **先探查**：`exec.agent` / `exec.agent.session` 上有无"非交互/后台/无 UI"可靠标志（查 `tmp/asar` 内 `dsh-tools`、`dsh-agent-preset`、`dsh-user-approval` 的类型定义；`userQuestions` 的失败码 `NO_PROVIDER`/`DELEGATED_CALLER`/`CALLER_NOT_LIVE` 已在 `lib/ask.js:343` 使用，可作为"无应答者"信号之一）。
2. **方案 A（有可靠标志）**：pre-execute 识别到非交互调用 → 直接返回 `{kind:"deny", reason:"[workspace-only] non-interactive call cannot be approved"}`，不再进 askFlow。
3. **方案 B（无可靠标志）**：`Config` 新增 `fastDenyMs: z.number().step(1).min(0).default(0)`（0 = 现状）；设为如 5000 时，askFlow 的 presence 窗口超时且 `userQuestions` 报 `NO_PROVIDER`/`CALLER_NOT_LIVE` 类错误 → 立即 deny（跳过 systemDialog 兜底）。保留 env 覆盖 `WORKSPACE_ONLY_PRESENCE_WAIT_MS` 供测试。
4. 无论 A/B：`recordDecision` 里标注快速拒绝来源，便于诊断。

**验收**：无 UI 场景（或 `fastDenyMs` 生效场景）下越界调用在数秒内返回 deny；有 Web 卡片时行为不变（卡片正常弹、120s 超时语义不变）。

### T7（P1）. shell 扫描补 `=` 赋值/选项形态

**动机**：`INTERIOR_PATH`（`scanner.js:76`）的前缀字符类 `['\"``\s(]` 不含 `=`，token 级 `isAbsoluteToken` 又只认 token 开头——于是 `FOO=/etc/secret`、`--out=C:\x`、`--out=/etc/x` 这三种形态**完全漏扫**。

**实现要点**：
1. 前缀字符类加 `=`：`(?:^|['\"``\s(=])`。注意反引号转义与现有正则逐字符对齐。
2. `scripts/verify-scanner.mjs` 加用例：`FOO=/etc/secret node app.js` 报警、`tool --out=C:\x` 报警、`tool --out=/etc/x` 报警；误报对照：`awk '{print $1}'`、`echo a=b`、`curl -d a=b https://x/y` 不报警（URL 形态不受影响）。
3. 取舍说明写进注释：`cmd -d a=/etc/x`（值在独立 token 的 `=` 后）会报警，属保守方向的可接受误报。

**验收**：新增用例全绿，无既有用例回归。

### T8（P1）. 全工具参数形状扫描（opt-in）

**动机**：`PATH_TOOLS`/`SEARCH_TOOLS`/`SHELL_TOOLS`（`scanner.js:217-221`）是硬编码的 8 个工具名；DSH 工具集可扩展（插件注册工具、MCP 工具），新工具的路径参数默认不设防。MiMo 的对应防线是统一写门 `assertWriteAllowed`（"忘记接线"不可表达）。

**目标行为**：`Config.scanAllTools`（默认 `false`，opt-in）开启时，对**未被精确定义覆盖的工具**递归收集 `arguments` 全部字符串叶子值，凡"绝对路径形状/`..` 逃逸/`~` 形状"（复用 `isAbsoluteToken`/`isEscapeToken`/`HOME_PREFIX` + T3 展开）的值都按目标路径判定并入 `outsideTargets`。

**实现要点**：
1. `lib/scanner.js` 新增 `genericTargets(exec, root)`：深度遍历 arguments 字符串值，长度 > 4096 的跳过（防把长文本当路径），只对"路径形状"值判越界（相对普通文本不判）。
2. `lib/index.js`：`scanAllTools` 开启且 `exec.name` 不在三个已知集合时改走 `genericTargets`。
3. `Config` 新增 `scanIgnoreTools: z.array(z.string()).default([])`（误报豁免工具名）。
4. README"边界与残余面"更新：默认仍是 8 工具精确定义（误报低）；`scanAllTools` 是全量保守模式，可能对含路径样文本的参数误报，配合 `scanIgnoreTools` 使用。
5. smoke/verify-scanner 各加一条：开启后未知工具 `file_path: "C:\\outside\\x"` 被拦；长文本参数不误报。

**验收**：默认关闭时行为与现状完全一致；开启后未知工具越界路径被拦。

### T9–T11（P2，可选批次）

- **T9 白名单作用域**：`Config.always` 现为 profile 全局（A 项目批准的目录 B 项目也放行），MiMo 的 approved 是项目（Instance）级。加 `alwaysScope: z.enum? → z.union?`（schemastery 无 enum 时用 `z.string()` + 校验）取值 `"global" | "workspace"`，`"workspace"` 时白名单条目存 `{root, dir}`，`alwaysAllows` 先比 root 再比 dir。设置页展示作用域。迁移：旧字符串条目视为 `"global"`。
- **T10 并发卡片合并**：一次 `askOutside` 多个目标时 reason 拼接为"N 处越界"，`dir` 显示首个；三键任一决策覆盖整次调用。改 `lib/index.js` 传 `targets` 全集 + `lib/client.js` 卡片展示多行。
- **T11 symlink 残余面**：词法围栏不查 realpath（MiMo 的 `AppFileSystem.contains` 同为词法，一致）。最小动作：README"残余面"补一条"工作区内符号链接指向区外不拦截"。可选增强：命中"工作区内"后加一次 `fs.realpath` 复核（性能代价，`Config.realpathCheck` 默认关）。

---

## 5. 设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | T1 宁可双弹窗、不可绕过：拿不到会话模式 API 时**完全不跳过** | 安全 > 体验；repeated 绕过是实锤洞 |
| D2 | T2 批量解锁只对**同 session**生效 | 对齐 MiMo `permission/index.ts:507` 的 session 过滤 |
| D3 | T3 展开失败（env 缺失）保持 fail-safe 判越界 | 与插件既有"fail closed"哲学一致 |
| D4 | T5 deny 压过会话放飞（bypass） | 对齐 MiMo："Deny rules ... still apply"（skipAll 不豁免 deny） |
| D5 | T4 敏感 always 存 pattern（`sensitiveAlways`），不混入目录白名单 | 两种语义正交，混用会让"总是允许本目录"意外放行敏感文件 |
| D6 | T8 默认关闭（opt-in） | 全量扫描对文本参数有误报面，不改变默认行为最稳 |
| D7 | 不引入 MiMo 式 tree-sitter 级 shell 解析（2026-10 评估：能做但没必要） | ①误报=多问一次是刻意保守（`never a silent miss`），tree-sitter 的收益主要是降误报；②动态构造漏报 tree-sitter 无解——MiMo 的 `argPath` 对 dynamic 也不询问；③MiMo 的精度大头来自 FILES 命令白名单 + 权限 pattern 体系（命令级权限系统的语义），围栏无此需求；④wasm 依赖（web-tree-sitter + bash/powershell grammar，MB 级）破坏零依赖、scanner 纯词法可独立测的架构基石，且 MiMo 的 Bun 式 `import(…wasm)` 在 DSH 的 Electron/Node（asar）下要改运行时加载。许可无障碍（MIT + USE_RESTRICTIONS 不碍开发用途）。若 shell 误报成为实操痛点：先收紧词法规则（verify-scanner 对照组先行），仍不足再 opt-in `Config.shellParser`（懒加载 wasm、解析失败回退词法层、移植段带 MIT notice） |

## 6. 约定、风险与回归

**开发约定**（沿用仓库既有实践）：
- 提交信息写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`（PowerShell 直接 `-m` 会毁掉引号）。
- `docs/` 被 gitignore（`docs/.gitignore: *`），任务书不进 git 属正常。
- 若开发会话装着本插件（gate ON），shell 命令里的工作区外字面路径（如 app.asar 路径）会被**本插件自己**拦；用已提取的 `tmp/asar/**` 做研究，或临时会话放飞。
- 注释/用例用合成值（`/tmp/example`、`C:\example\file`、`test/model`），不留机器特定值。
- schemastery：无 `.int()`，整数 `z.number().step(1).min(n)`；运行时可写字段 `.volatile()` + `readVolatile()`。

**风险**：
1. T1 需要会话当前模式——探查不到就走 D1 兜底，**不要**猜服务名硬连。
2. T3 展开改动动到 `lexicallyWithin` 调用链（白名单也用），回归重点是 verify-scanner 全量 + 白名单盖住 `~` 的新用例。
3. T4/T5 新配置字段记得进 README 配置表与设置页（`lib/client.js` + locale en/zh）。
4. `check-compat.mjs` 探针新增后跑一次真机（对本机 dsh 安装）确认 11/11。

**总验收清单**：
- [ ] `node scripts/verify-scanner.mjs` 全绿（含 T3/T7/T8 新用例）
- [ ] `node scripts/check-compat.mjs` 全绿（含 T1 新探针）
- [ ] `node tmp/smoke/run.mjs` 全绿（含 T2/T4 新护栏）
- [ ] T1 攻击路径实测：`sandbox_permissions=<当前模式>` 的越界 bash 仍弹三键
- [ ] T2 实测：同目录并发两调用，一次"总是允许"全放行
- [ ] T4/T5 实测：工作区内 `.env` 弹、`.env.example` 不弹、deny 目录任何情况拒
- [ ] README 配置表、行为矩阵、残余面三节同步更新
- [ ] 每个任务独立 commit，工作树最终干净

## 7. 参考

- MiMo-Code 参考实现（只读）：`D:\Code\Nodejs\MiMo-Code\packages\cli\src\{tool/external-directory.ts, tool/bash.ts, permission/index.ts, agent/agent.ts}`。
- 本仓库既有任务书：`docs/increment-plan.md`（含 §6.1 契约教训：pending 投影 `requestId`、`remove()` 撤座、announce 提前、`settings/document-updated` 面板通道、schemastery 语义）。
- DSH 契约提取物：`tmp/asar/dsh/node_modules/@deepseek-ai/{dsh-sandbox, dsh-sandbox-policy, dsh-tools, dsh-user-approval, dsh-fs-sandbox}/`。
