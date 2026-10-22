# dsh-workspace-only-plugin 增量改造任务书

- 日期：2026-10-21
- 状态：计划已获批准，待编码实施
- 目标环境：DeepSeek Harness Desktop **0.2.1-rc.2**（Windows，`web` profile，`desktop` profile）
- 本仓库上游：`github:CsBpRd/dsh-workspace-only-plugin`（main 分支停在 2026-08-16，此后无更新；本计划所有增量均不与上游重复）
- 本文读者：接手编码的代理。本文自包含，不需要其他会话上下文。

---

## 0. 任务概览

在现有插件上做 5 项增量（用户已逐条确认）：

| # | 任务 | 一句话 |
|---|---|---|
| E1 | 配置通道迁移 | 开关/白名单从 0.1 遗留的 settings 通道迁到 DSH 0.2 插件 Config（B/D 的前置） |
| A | 补 Windows 扫描 | `shellReason`/`INTERIOR_PATH` 增加盘符（`[A-Za-z]:[\\/]`）与 `..\` 逃逸判定（现为实打实的绕过 bug） |
| B | 三键弹窗 + allow-always | 越界弹「仅此一次 / 总是允许本目录 / 拒绝」自定义对话框；pattern→allow 持久缓存 |
| D | 会话级自动放行 | 「这个会话放飞，别的会话照常」：per-session bypass，session 事件持久 |
| C | 治 ACL | 用直通 runner（`runnerCommand`）顶掉 `dsh-sandbox-windows-acl`，保留 `dsh-fs-sandbox` 进程内写围栏 |
| E2/E3 | 风险点退役 | `patch-core.mjs` 两处 node_modules 补丁退役；绕过 `ApprovalService` 的耦合面压缩 + 升级自检 |

实施顺序：**E1 → A → B → D → C → E2/E3**（E1 先行，B/D 的状态存储依赖它；其余相对独立）。

设计意图的来源：这组改造本质上是把 MiMo-Code（`D:\Code\Nodejs\MiMo-Code`）的 `external_directory` 权限门禁经验移植到 DSH 插件。MiMo-Code 的参考实现在：
- `packages/cli/src/tool/external-directory.ts` —— 越界门禁（`assertExternalDirectoryEffect`：路径在 `Instance.containsPath` 边界外 → `ctx.ask({permission:"external_directory", patterns:[dirname/*], always:[...]})`）
- `packages/cli/src/permission/index.ts` —— 审批引擎（`always` 回复 → glob 规则持久化 = allow-always 的语义来源；`FORCED_ASK` 不可被通配 allow 预授权）
- `packages/cli/src/tool/bash.ts` —— bash 命令的 tree-sitter 路径扫描（本插件用词法扫描近似）

---

## 1. 本插件现状（机制拆解）

### 1.1 Host 侧（`lib/index.js`，217 行）

- **门禁**：`ctx.on("tools/pre-execute", …)`。命中越界的调用改写为用户审批；`args.sandbox_permissions !== undefined` 的调用跳过门禁（已有升权审批，避免双弹窗）；`exec.agent === undefined` 直接 deny。
- **边界**：`root = exec.agent.session.header.cwd`；`lexicallyWithin(target, root)`（`normalize`+`relative`+`..`/`isAbsolute` 判定）。
- **工具覆盖**：
  - `PATH_TOOLS = { read: "file_path", write: "file_path", edit: "file_path", read_image: "file_path" }`
  - `SEARCH_TOOLS = {glob, grep}`：检查 `path` 参数 + 绝对/逃逸 `pattern`
  - `SHELL_TOOLS = {bash, pwsh}`：检查 `workdir` + `command` 词法扫描
- **shell 扫描**：`shellTokens`（引号感知分词）→ 逐 token 剥离引号/反斜杠转义/重定向前缀（`2>`、`&>>`…）→ `~`/`$HOME` 判定 → 绝对路径判定 → `..` 逃逸判定 → `INTERIOR_PATH` 正则匹配 token 内嵌路径（`node -e "…'/etc/passwd'…"` 场景）；`/dev/null` 豁免。
- **审批派发（现状）**：手写审计对 `session.append("approval/asked", …)` → 直接 `ctx.waterfall(scopeTarget(…), "approval/request", request, …)`（**刻意绕过 `ApprovalService.request()` 的 `never` 策略短路**，Full access 会话也弹窗）→ `session.append("approval/decided", …)` → 结果映射 `{kind:"allow"}` / `{kind:"deny", reason}`。
- **其他**：`permissionPresets.presets["workspace-write"].name = "Write Only"` 永久改名；`systemPrompt.context`（order 116）注入开关叙事；settings 开关经 `installSettingsSection(settingsNamespace("workspace-only"))`（0.1 遗留通道）。

### 1.2 Client 侧（`lib/client.js`，282 行，浏览器 bundle 格式）

- `WorkspaceOnlySettingsController`：`api.settings.describe/mutate`（ns=`"workspace-only"`）读写开关，快照 store + 乐观更新。
- `settings.general.item` 槽位渲染设置行；composer 快捷按钮：MutationObserver 找 aria-label 匹配 `/(?:访问模式|Access mode)/i` 的按钮，在 `.tools` 行 `.modes` 组后插入。

### 1.3 安装与补丁（`install.sh`、`scripts/patch-core.mjs`）

`install.sh`：`dsh plugin add` + 打两处 node_modules 补丁 + 重启 dsh web。补丁（E2/E3 要退役的对象）：
1. `@deepseek-ai/dsh-host-apiproxy/lib/index.js` 的 `WEB_SETTINGS_NAMESPACES` 白名单加 `"workspace-only"`（0.1 时代 Web 客户端可写设置命名空间的硬编码白名单，插件无法自行注册）；
2. `@nanmicoder/dsh-auto-mode/lib/client.js` 的 `REQUIRED_PERMISSION_LABELS` 里 `"Workspace Write"` → `"Write Only"`（本插件改名预设的连带伤害）。

### 1.4 已知缺陷（本次要修/要做的动机）

1. **Windows 扫描缺口（bug，任务 A）**：`shellReason` 绝对路径判定是 `t.startsWith("/")`、`INTERIOR_PATH` 只匹配 `/`/`~/` 开头、逃逸判定是 `t.includes("/../")` —— bash/pwsh 命令里的 `C:\...`、`..\` **完全绕过扫描**。工具层的 `pathReason`（走 `isAbsolute`）不受影响。另外 `lexicallyWithin` 依赖平台默认 `path`，跨平台语义不稳。
2. **无 allow-always（任务 B）**：审批结果只有 `allowed-once`，一次批准只放行一次调用，批量越界操作连环弹窗。
3. **ACL 后端痛点（任务 C，用户实测）**：win32 ACL 受限令牌 runner 在用户机器上「误拒绝正常文件访问」「性能/兼容性差」。
4. **无会话级放飞（任务 D）**：开关是全局 settings（`enabled`），所有会话一起生效。
5. **升级脆弱点（任务 E）**：两处 node_modules 补丁在 dsh 升级后失效需重打；手写 `approval/asked`/`approval/decided` 事件格式直接依赖 `dsh-user-approval` 内部约定。

---

## 2. DSH 运行时契约（已验证事实，实现依据）

以下均核对自本机 `D:\Programs\DeepSeek Harness\resources\app.asar` 内打包源码（`dsh/node_modules/@deepseek-ai/*`）。需要再查时用 §2.8 的提取脚本。

### 2.1 `tools/pre-execute` 钩子（`@deepseek-ai/dsh-tools`）

- 形态：`ctx.on("tools/pre-execute", async (exec, next) => …)`。
- `exec`：`{ name, arguments, agent?, callId?, signal? }`；`exec.agent.session.header.cwd` 是会话工作区根。
- 返回值词汇：`{ kind: "allow" }` 放行；`{ kind: "deny", reason }` 拒绝（reason 会作为工具结果给模型）；`next()` 继续默认流水线。

### 2.2 审批（`@deepseek-ai/dsh-user-approval`，导出 `APPROVAL_POLICIES / ApprovalRequestId / ApprovalService / setApprovalPolicy`）

- **结果词汇封闭**：`OUTCOMES = ["allowed-once", "rejected", "cancelled", "unavailable"]`。**没有 `allow-always`**——「总是允许」必须由本插件自己实现（任务 B 的存在理由）。
- **waterfall**：应答者注册在 `approval/request` 事件链上，请求对象 `{ agent, toolName, callId?, reason, signal? }`，返回一个 OUTCOMES 值即作答，否则 `next()` 委托；无应答者 → `unavailable`（fail closed）。
- **`ApprovalService.request()` 的行为**（插件目前绕过它的原因）：
  1. `hasOpenTurn(session)` 前置（审计对必须落在 turn 内，否则 throw）；
  2. 写审计对 `approval/asked { id, toolName, callId?, reason? }` + `approval/decided { id, outcome }`；
  3. `decide()` 中 **`effectivePolicy(session) === "never"` 直接返回 `"rejected"`**（不派发 waterfall）——这正是 Full access 会话不弹窗的原因，插件为「Full access 也弹」而手写审计 + 直接 waterfall。
- **策略**：词汇 `ask | never`（`never` = 自动**拒绝**，不是自动放行）；per-session 覆盖是 `approval/policy` 事件（`setApprovalPolicy(session, policy)` 是官方导出），fold 跨重启保留。
- GUI 审批弹窗由 web answerer 按 `callId` 配对渲染（消费 `approval/asked` 事件）——**写了 `approval/asked` 就会触发 GUI 弹窗**，任务 B 的自定义弹窗路径必须避免写该事件（改为自有事件），否则双弹窗。

### 2.3 沙箱（`@deepseek-ai/dsh-sandbox` / `dsh-sandbox-local` / `dsh-fs-sandbox`）

- **`runnerCommand` 覆盖（任务 C 的关键）**：`dsh-sandbox-local` 的 Config 字段 `runnerCommand: string[]` + `runnerFailureSignatures: string[]`（两者必须同时配，否则加载报错）。存在时**跳过内置 runner 链（win32 = ACL 受限令牌 runner）与功能探测**，也**不注册 ACL 诊断技能**。语义是「操作方断言 full enforcement」。
- **argv 契约**：`confine()` 返回 `[...runnerCommand, ...bwrapProfileArgs(policy), …, "--", <cmd>, <args...>]`。bwrap profile 参数形如 `--ro-bind <path> <path>`、`--bind <root> <root>`（`workspace-write` 时多一条工作区 bind）。runner 以 `--` 为分隔符，之后是真实命令。参考内置 runner（`dsh-sandbox-windows-acl/lib/runner.js`）的解析方式。
- runner 自身故障应打印带固定前缀的 stderr 行（如 `workspace-only-passthrough: <detail>`），与 `runnerFailureSignatures` 对应，便于区分「runner 坏了」与「命令失败」。
- **`dsh-fs-sandbox`（保留）**：`ctx.fs` 的进程内写围栏（`writeText`/`editText` 上的规范化包含检查），与 shell runner/ACL **无关**。`workspace-write` 模式下写越界返回结构化 `FS_SANDBOX_DENIED` → 工具渲染 `[sandbox: file access denied under <mode> mode]` + `sandbox_permissions` 升权提示。换掉 ACL 后它照常工作。
- 模式语义：`read-only` 拒绝一切变更；`workspace-write` 允许写工作区根 + 平台临时区；`danger-full-access` 无围栏。逐会话模式与工作区根由 `dsh-sandbox-policy` 解析（`sandbox/mode` 事件 + `SessionHeader.cwd`）。

### 2.4 配置模型（DSH 0.2；本机 0.2.1-rc.2）

- 插件声明 `export const Config = z.object({…})`（schemastery），表单编辑用 `@deepseek-ai/dsh-settings` 的 `.volatile()` 字段声明；持久化落在当前 profile 的 `cordis.patch.yml` 条目 `config`，**无需任何 node_modules 补丁**。
- 设置卡片槽位：DSH 0.2 用 `plugins.bundle.config`（key = 包名）；0.1 遗留的 `settings.plugin.item` 已迁移。参考实现：`github:timeance/dsh-approve-for-me`（其 0.2 适配 commit「fix: support DSH 0.2 framework APIs while retaining legacy compatibility」，兼容清单含 0.2.1-rc.1）。
- 旧通道 `installSettingsSection(settingsNamespace("workspace-only"))` + apiproxy `WEB_SETTINGS_NAMESPACES` 白名单是 0.1 遗留（0.2 已把 `settings.yaml` 一次性导入 profile 条目）——任务 E1 就是把开关状态迁出它。
- Config override 语义：cordis patch 的「matching override replaces the complete config」——override 某行 config 时必须带全字段。

### 2.5 会话事件模式（任务 D 的先例）

会话级持久状态的官方模式：`session.append(<type>, data)` 追加事件 + 读取时 fold。先例：`sandbox/mode`（每会话沙箱模式，「切换记录在会话日志中，通过回放跨重启保留，每个会话保持自己的模式——两个会话绝不会看到彼此状态」）、`approval/policy`、`permission/preset`。任务 D 的 bypass 状态照此实现。

### 2.6 Client 插件能力

- `ctx.slots.inject/register` 注册 React 组件；已用槽位：`settings.general.item`、composer（DOM 注入）；可用 overlay 槽位 `shell.overlay`（「Use `shell.overlay` only when the request needs an overlay」——适合任务 B 的三键对话框）。
- 模块格式：`window.__ModuleLoader__.load({ id, factory })`；React 从浏览器模块表取（不自带 React）；资源注册在 `apply` 内用 `ctx.effect`/`ctx.on` 并返回清理。
- client↔host 通信：`ctx.get("connection").api`（现有 settings controller 用它）+ `ctx.remote.$on(<event>)`（现有 invalidation 用它）。三键对话框的请求/响应用同一 remote 通道（host 发起、client 应答）。
- 文本一律走 Client locale 服务（现有 `zh`/`en` 字典模式保留）。

### 2.7 权限预设（背景，非本期改动对象）

`@deepseek-ai/dsh-permission-presets`：预设 = {sandbox 模式, approval 策略} 捆绑；**per-session 选择**（`/permission` 命令、`permission/preset` 事件）；插件可在 Config `presets` 表加自定义预设（保留名 `custom`/`auto`）。本插件的「Write Only」改名即作用于此表。dsh-approve-for-me 以「为目标 Agent 或会话选 Access preset」接入——若未来想把「放飞」做成具名预设，走这条路（本期任务 D 用 session 事件实现，不依赖预设）。

### 2.8 如何再查 DSH 源码（app.asar 提取）

DSH 打包在 `D:\Programs\DeepSeek Harness\resources\app.asar`，包源码在 `dsh/node_modules/@deepseek-ai/<pkg>/{lib,README.zh.md,package.json}`。提取脚本（node ≥22，本机亦有 `D:\Developer\nodejs\node.exe`）：

```js
// usage: node extract-asar.mjs <asar> <outDir> <path/in/asar...>
const fs = require("fs"), path = require("path");
const [asar, outDir, ...wanted] = process.argv.slice(2);
const fd = fs.openSync(asar, "r");
const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0);
const sz = b.readUInt32LE(4);
const h = Buffer.alloc(sz); fs.readSync(fd, h, 0, sz, 8);
const sl = h.readUInt32LE(4);
const idx = JSON.parse(h.toString("utf8", 8, 8 + sl));
const dataStart = 8 + sz;
for (const p of wanted) {
  let node = idx;
  for (const part of p.split("/")) { node = (node.files || {})[part]; if (!node) break; }
  if (!node || node.files) { console.log("SKIP " + p); continue; }
  const buf = Buffer.alloc(node.size);
  fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset));
  const dest = path.join(outDir, p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log("OK " + p + " (" + node.size + " bytes)");
}
```

常用路径前缀：`dsh/node_modules/@deepseek-ai/`。重点包：`dsh-tools`（pre-execute 契约）、`dsh-user-approval`、`dsh-sandbox-local`、`dsh-sandbox-windows-acl`、`dsh-fs-sandbox`、`dsh-settings`、`dsh-permission-presets`、`dsh-agent-preset/skills/cordis-plugin-development/`（插件开发 skill + references）。注意：shell 命令与 ripgrep 读不了 asar 内文件，须先提取。

---

## 3. 增量任务详述

### E1. 配置通道迁移（先行）

**动机**：B/D 需要持久状态（`always` 白名单、开关、`renamePresetLabel`），继续用 0.1 settings 通道就离不开 apiproxy 白名单补丁；迁到 0.2 插件 Config 后补丁退役。

**改动**：`lib/index.js`、`lib/client.js`、`package.json`、`README.md`。

1. `Config` schema：`{ enabled: boolean（默认 false）, always: string[]（默认 []，目录/glob 白名单）, renamePresetLabel: boolean（默认 false，任务 E2）, dialogTimeoutMs?: number }`。运行时会被写的字段（`enabled`、`always`）用 `.volatile()` 声明（`dsh-settings` 表单可编辑 + 插件可写回）。
2. `WorkspaceOnlySettingsController` 改走 0.2 通道（`plugins.bundle.config` 槽位/共享 settings schema service，照 dsh-approve-for-me 的 0.2 做法）；保留现有 store 接口使 UI 行/快捷按钮代码几乎不动。
3. 删除 `scripts/patch-core.mjs` 的 apiproxy 补丁（E2 一并处理脚本退役）。

**验收**：开关状态经设置卡片读写并**跨重启保留**；`dsh --profile web --dump-config` 可见配置；不再需要 apiproxy 补丁即全功能可用。

### A. Windows 扫描修复

**动机**：`bash`/`pwsh` 命令中的 Windows 路径现在完全绕过门禁（实测级 bug）。

**改动**：`lib/index.js`、`scripts/verify-scanner.mjs`。

1. `INTERIOR_PATH`：`/(?:^|['"`\s(])((?:~[\\/]|[A-Za-z]:[\\/]|\\\\|/)[^'"`;|&<>()]*)/g`（增加盘符与 UNC 起始）。
2. `shellReason`：
   - 绝对路径判定 `t.startsWith("/")` → 增加 `/^[A-Za-z]:[\\/]/`（盘符，大小写均可）与 `^\\\\`（UNC）；
   - `..` 逃逸判定 `t.includes("/../")` → `/(\.\.[\\/])/`，并覆盖 `t === ".."`、`t.startsWith("../")`、`t.startsWith("..\\")`；
   - `$HOME`/`~` 判定保留（`~\` 也认）。
3. `lexicallyWithin`：按目标形态选路径语义——盘符/反斜杠目标用 `path.win32`（含大小写不敏感比较），否则 `path.posix`/平台默认。目标：在任何宿主平台上对 Windows 形态路径判定正确。
4. `glob/grep` 的 `pattern` 绝对/逃逸判定同步加盘符/UNC/反斜杠形态。
5. `verify-scanner.mjs` 新增 Windows 用例（全部用合成路径）：盘符独立 token、内嵌盘符（`node -e "…'C:\\tmp\\example'…"`）、`..\`/`../`/混合分隔符逃逸、UNC `\\\\server\\share\\x`、重定向前缀（`> C:\tmp\example.txt`）、引号包裹、误报对照（`src\x`、普通词内子串**不得**触发）。

**验收**：`node scripts/verify-scanner.mjs` 全绿（含既有用例回归）。

### B. 三键弹窗 + allow-always（自定义弹窗形态，用户已选定）

**动机**：补上与 MiMo-Code `external_directory` 最大的差距——`always` 持久授权；并解决批量越界连环弹窗。DSH 审批结果词汇封闭（只有 `allowed-once`），故采用**自定义三键对话框**。

**改动**：新 `lib/ask.js`（host 侧询问会合点）、`lib/index.js`、`lib/client.js`（overlay 对话框）。

**拦截流**（pre-execute 命中越界后）：

1. `always` 白名单命中（目录前缀包含，判定语义与 `lexicallyWithin` 一致）→ `next()`，不弹窗；
2. 否则发 remote 请求到 client `shell.overlay` 三键对话框，展示 `toolName`、目标路径、`reason`；
   - **仅此一次** → 本次放行（`{kind:"allow"}`）；
   - **总是允许本目录** → 目录写入 `Config.always`（持久化）+ 本次放行；后续同目录直接命中白名单；
   - **拒绝** / 超时（`dialogTimeoutMs`，默认建议 120s）/ 取消（联动 `exec.signal`）→ `{kind:"deny", reason}`；
3. **无 client 兜底**（headless/TUI 或 overlay 无应答）→ 回退现状 `approval/request` waterfall 官方弹窗（保留 `approval/asked`+`approval/decided` 写法）；waterfall 也无应答者时 deny（fail closed，与现状一致）。

**审计**：

- 三键路径写自定义事件对 `workspace-only/asked` + `workspace-only/decided`（含 path/choice/toolName），**不写 `approval/*`**（避免触发 GUI 官方弹窗二次询问，见 §2.2）。
- waterfall 兜底路径保持现状写法不变。
- 白名单变更在事件里留痕（`workspace-only/always-added`）。

**白名单管理**：设置卡片列出/删除已允许目录；显示「最近弹窗目录」一键加白（上限 ~20 条，只存展示用元数据）。

**验收**：Windows dsh web 手动——read/write/bash 越界弹三键且三路行为正确；`always` 后同目录不再弹、设置卡片可见可删、重启后白名单仍在；headless 场景回退官方弹窗。

### D. 会话级自动放行（放飞）

**动机**：「这个会话放飞，别的会话照常」。现状开关是全局的，无法只放行单个会话。

**改动**：`lib/index.js`、`lib/client.js`、`README.md`。

1. 状态：`session.append("workspace-only/bypass", { enabled })` + fold（照 §2.5 的 `sandbox/mode` 先例）——per-session、跨重启保留、会话间隔离。
2. 语义：bypass 开启 → 本会话 pre-execute 门禁直接 `next()`（不弹三键、不走 waterfall 兜底、不查白名单）；其他会话照常。优先级高于全局 `enabled`。
3. 入口：
   - composer 快捷按钮加长按（或右键）菜单：「放飞本会话 / 恢复本会话」；放飞激活时按钮高亮、文案显示「本会话放飞」；
   - 设置卡片显示当前会话 bypass 状态（只读 + 取消按钮）。
4. `systemPrompt.context` 叙事同步：bypass 开启时注入「Workspace Only is bypassed for this session」，让模型知情（保持现有 order 116 条目风格）。

**验收**：A 会话放飞、B 会话照常弹窗；重启 dsh 后 A 仍放飞；全局开关关着时放飞会话依旧放行。

### C. 换掉 ACL 后端（直通 runner）

**动机**：用户实测 ACL 受限令牌 runner「误拒绝正常文件访问」「性能/兼容性差」。`runnerCommand` 是官方支持的替换点（§2.3），无需改 DSH 本体。

**改动**：新 `scripts/passthrough-runner.mjs`、`cordis.patch.yml`（或 install.sh 写入 profile config）、`README.md`。

1. 直通 runner（Node ESM）：按 §2.3 argv 契约解析，**丢弃 `--` 之前全部 bwrap profile 参数**，`child_process.spawn(<cmd>, <args>, { stdio: "inherit" })`，透传退出码与信号；自身故障打印 `workspace-only-passthrough: <detail>` 到 stderr。
2. bundle config override `sandbox` 行（`dsh-sandbox-local`；注意 override 替换完整 config）：
   - `runnerCommand: ["node", "<插件绝对目录>/scripts/passthrough-runner.mjs"]`
   - `runnerFailureSignatures: ["workspace-only-passthrough: "]`
3. 效果：win32 ACL runner 不再被选中（误拒、AppContainer 读限制、受限令牌开销一并消失）；`dsh-fs-sandbox` 写围栏与 escalation 流程**不变**；shell 侧防线 = 词法门禁 + 三键弹窗。
4. 回退：清空 `runnerCommand`（恢复内置 runner 链）。README 写明取舍：**shell 无内核隔离**，威胁模型为工具层门禁（与 MiMo-Code 同级）。

**验收**：bash 越界操作不再出现 ACL 误拒/受限令牌异常；`workspace-write` 下 fs 工具写越界仍被 `FS_SANDBOX_DENIED` 拦截并走原 escalation；`runnerFailureSignatures` 注入测试（人为报错）能被正确归类。

### E2/E3. 风险点退役与耦合压缩

**改动**：`lib/index.js`、新 `lib/approval-compat.js`、`scripts/patch-core.mjs`（退役）、新 `scripts/check-compat.mjs`、`install.sh`、`README.md`。

1. **auto-mode 标签补丁退役（E2）**：`renamePresetLabel` 改为 Config 可选项（默认 `false`）。默认不改名 → 不需要 patch `@nanmicoder/dsh-auto-mode`；开启时 README 说明与 auto 插件的潜在标签冲突。
2. **`patch-core.mjs` 退役**：两处补丁分别被 E1（配置通道）和 E2（默认不改名）消除。脚本删除或降级为只读诊断；`install.sh` 移除打补丁步骤（仅 `dsh plugin add` + runner 配置写入 + 可选重启）。
3. **审批耦合压缩（E3）**：新 `lib/approval-compat.js` 封装 waterfall 派发与审计写入（使用官方导出 `ApprovalRequestId`）；三键路径的自定义事件已减少对 `approval/*` 格式的依赖（任务 B）。新增 `scripts/check-compat.mjs` 升级自检：
   - 探测 `dsh-user-approval` 结果词汇（`OUTCOMES`）与审计字段形状；
   - 探测 `dsh-tools` 的 `pre-execute` 返回词汇；
   - 不一致时输出人可读的差异报告（不静默失败）。
   - README 写明：**升级 dsh 后跑一次 `node scripts/check-compat.mjs`**。

**验收**：全新安装（不打任何 node_modules 补丁）全部功能可用；`check-compat.mjs` 在 0.2.1-rc.2 通过；`renamePresetLabel: false` 时与 auto 插件零冲突。

---

## 4. 总验收清单

1. `node scripts/verify-scanner.mjs` 全绿（Windows 用例含误报对照）。
2. Windows dsh web 手动：越界 read/write/bash 三键弹窗三路正确；`always` 白名单持久、可管理。
3. 会话放飞：双会话对照（A 放飞、B 照常），重启后保留。
4. ACL 移除：无误拒/受限令牌异常；fs 写围栏与 escalation 不变。
5. 回归：Full access（`never`）会话仍弹窗（保留绕过语义）；headless/TUI 回退官方弹窗；未开 `renamePresetLabel` 时与 auto 插件零冲突；`sandbox_permissions` 升权调用仍跳过门禁（不双弹）。
6. `node scripts/check-compat.mjs` 通过；`dsh --profile web --dump-config` 显示期望配置。

## 5. 设计决策记录（用户已拍板）

| 决策点 | 结论 |
|---|---|
| 「会话级自动放行」归属 | **DSH 插件侧**（本仓库 per-session bypass），不动 MiMo-Code |
| allow-always 交互形态 | **自定义三键弹窗**（仅此一次/总是允许本目录/拒绝），非「白名单+设置管理」简化版 |
| ACL 处理 | 换掉 ACL 后端，**保留 `dsh-fs-sandbox` 软围栏**（用户原话「想保留软围栏就留着它」） |

## 6. 假设、取舍与风险

- **假设**：0.2.1-rc.2 的 `tools/pre-execute`、`approval/request`、`session.append`、`ctx.slots`、Config/dsh-settings 契约与 §2 一致（已核对打包源码）；实现中如遇出入，以提取的本机 asar 源码为准并更新本文。
- **取舍**：三键 overlay 依赖 web client；headless/TUI 回退官方弹窗（不劣于现状）。直通 runner 后 shell 无内核隔离（换取无 ACL 误拒）。`workspace-write` 下越界**写**仍是双重确认（三键 + fs 围栏 escalation），本期不动官方 escalation 流程。
- **风险**：DSH 升级可能改变 `approval/*` 事件格式、`pre-execute` 词汇或 settings 通道——`check-compat.mjs` 是防线；上游（CsBpRd）若更新需 rebase 本 fork 的增量；`shell.overlay` 槽位与 composer DOM 启发式（aria-label 正则）属客户端脆弱点，升级后先跑手动回归（§4.5）。
- **行为兼容**：全局开关默认 `enabled: false`（现状默认关）；三键弹窗引入后旧「waterfall 官方弹窗」仅作兜底——如需旧行为开关，可加 `Config.useSystemDialog: boolean`（可选项，非必须）。

## 6.1 实施记录：与本计划的出入（2026-10-21，已按本机 asar 源码修正）

实现按 §6 的约定以本机 0.2.1-rc.2 打包源码为准，以下出入已核实并按修正后的方案落地（对应模块在括号内）：

1. **自定义会话事件 type 不可用**（影响 §2.5、任务 B 审计、任务 D 状态）。`dsh-session` 的持久化读取路径**拒绝** `KNOWN_SESSION_EVENT_TYPES` 之外且信封无 `ignorable: true` 的事件，而 `Session.append()` 无法设置该标记（`known-event-types.js` 头注释、`surfaceOpOf`、practices.md「Session would refuse to reopen」）。修正：状态与审计改走 `appendPluginRecord()` 的 ignorable `plugin:` 记录（`plugin:workspace-only/{asked,decided,always-added,bypass}`，`lib/session-state.js`）；turn 外写入可能被视为 crash tail，因此 bypass 另有进程内权威 + 下一次 turn 内补写（`ensureBypassPersisted`），记录丢失时门禁自动恢复（fail-safe）。
2. **插件自定义 remote 事件往返不可用**（影响 §2.6、任务 B 的三键弹窗形态）。`ctx.remote.$on` 的合法 key 就是 `dsh-api-remotes` 编译进包内的 `API_REMOTE_FORWARDED_EVENTS` 白名单（「Forwarding one more event requires one entry in that array」），插件无法添加。终版方案（用户选定「像权限提升面板」的形态后实施）：**三键卡片**照 `@deepseek-ai/dsh-client-ui-approval`（权限提升面板）的形态自绘——`uiSession.registerPendingInteraction` 接管 `conversation.composer`，警示条 + 工具/路径/原因 + 三按钮行（Enter=仅此一次、Esc=拒绝）；传输走「`settings/document-updated` 通知（白名单内）携带 `ask` 负载唤起 + `workspaceOnly/decide` RPC 应答」，`announce` 现身握手区分有无 Web 客户端。未现身则回退 `ctx.userQuestions` 通用问题卡（TUI 等）→ 官方 `approval/request` 弹窗（保留绕过 `never` 语义）→ 拒绝（fail closed）。早期的 user-questions generic 问题流形态（选择框+确认按钮）已被此方案替换。
3. **apiproxy 白名单补丁已无处可打**（影响 §1.3、E1）。0.2.1-rc.2 中 `WEB_SETTINGS_NAMESPACES` 不复存在（asar 全文检索 0 命中），E1 的迁移是唯一出路；`patch-core.mjs` 两处补丁就此退役（E2 的 auto 标签补丁随 `renamePresetLabel` 默认 false 一并消失）。
4. **`tools/pre-execute` 词汇比 §2.1 宽**：除 `allow`/`deny` 外还有 `ask`（转 `ApprovalService.request()`，仍受 `never` 短路，故不用于本插件主路径）与 `cancel`。`check-compat.mjs` 已按四词汇探测。
5. **client↔host 调用信封与 §2.6 的旧写法不同**：0.2 的 `ctx.remote.<ns>.<method>(...)` 直接返回 `{ ok, value | error }`（非 `{result:{...}}`），`settings/mutate` 为位置参数 `(ns, ops, expectedRevision)` 且返回刷新后的 namespace view；`settings/describe` 无参。`lib/client.js` 已改用 0.2 通道并保留原 store 接口。
6. **client→host 管理通道**（任务 B 白名单管理、任务 D 放飞切换）分两半落地。Host 侧是 Typert **source-mode** Remote service（`lib/remote-service.js`）：Gateway 从 `ctx.reflect.props` 发现带 `typertRemote` 绑定与类原型 Remote 方法标记的服务（`resolveSrcDescriptor`），参数按 SRC JSON 传递；为避免多余依赖，binding 与方法标记按 `dsh-typert-protocol` 的字面结构手写，不 import 该包。Client 侧**不能**用 `ctx.remote.workspaceOnly`：`remote.<namespace>` accessor 只在挂载生成的 Typert contribution（`$mount` → `installNamespace`）时创建，第三方命名空间没有 accessor，属性访问即抛 `cannot get property "remote.<ns>" without inject`。管理调用因此走 Gateway 的公开 unary RPC——`connection.rpc.call("/api", "workspaceOnly/<method>", { args })`（与 `ClientRemoteService.invoke()` 内部同一载荷形状）。另外 `ctx.remote.settings` 属已挂载的贡献，fiber 的 `inject` 须显式声明 **`"remote.settings"`**（dotted key，官方 client 同款）方可访问，否则同样的 inject 门禁错误；其连带症状是设置行加载失败后 `writable=false`、按钮点击被静默忽略。
7. **runner 覆盖写法**（任务 C）：Loader patch 方言中「带 `id` 而无 `insert` 的 mapping 即整行 override，`config` 整体替换」。base bundle 的 `sandbox` 行无 config，故覆盖块只需 `runnerCommand` + `runnerFailureSignatures` 两字段，由 `scripts/configure-runner.mjs` 幂等写入 profile 的 `cordis.patch.yml`（带标记注释，`--remove` 回退）；runner argv 契约与 `dsh-sandbox-windows-acl/lib/runner.js` 一致（第一个 `--` 之后为命令，runner 故障打前缀行并以 127 退出）。
8. **三键选项文案**为 host 侧中文 label（`仅此一次 / 总是允许本目录 / 拒绝`），答案按 label 匹配，label 需保持稳定（`lib/ask.js` 的 `LABELS`）。
9. **pending 投影必须携带 `requestId`**（presence 握手契约）。composer 的 pending-interaction 投影（`PendingApproval` 形状）只含 `kind`/`key`/`sessionId`/`result`/`answer` 等字段，卡片上报 `announce` 用的 `requestId` 必须显式放进投影对象；早期实现漏了它，`announce(undefined)` 被 Host 判为不匹配，presence 3 秒超时后降级 `ctx.userQuestions`，出现**三键卡片与通用问题卡双面板**。修复同时加固竞态：presence 超时保留 pending 席位等迟到的 `decide`（迟到的卡片点击胜过并撤回降级问题），`announce` 与超时同 tick 时按 `entry.announced` 兜底判定。
10. **`install.sh` 整体退役**（2026-10-21，用户决定）。0.2 的 `dsh plugin add` 与 web GUI「插件」页本身就是完整安装器（来源解析 github:/git/registry/路径/tarball、pnpm 依赖安装、`dsh.bundle` 校验、版本兼容预检与回滚），安装脚本只剩一条命令包装与重启辅助，已删除（package.json `files` 同步移除）；README 安装节改为「GUI 安装 / 一行 CLI」两条路径。§1.3、§2.4 等历史章节中对 `install.sh`、`scripts/patch-core.mjs` 的描述保留为当时的计划记录，以本条为准。
11. **`registerPendingInteraction` 返回撤座函数**（实测暴露）。平台 `answerApproval` 在 `pending.result` settle 的 `finally` 里调用返回的 `remove()` 撤座；漏掉它时卡片点击后只置灰、永不从 composer 消失。另：presence `announce` 已提前到 ask 负载到达时同步发出（不再等 React mount 卡片），卡片 mount 的 announce 保留为幂等二次机会——presence 窗口不再与渲染周期竞速；降级 `ctx.userQuestions` 时 Host 打 `[workspace-only]` warn 便于定位。
12. **composer 快捷按钮改为会话级开关**（用户决定，2026-10-21）。点击 = 放飞/恢复**本会话**（`setBypass(sessionId, …)`），不再是全局开关的镜像；全局开关关闭或未打开会话时按钮隐藏；悬停 tooltip 说明作用域。会话 id 取 `localStorage["dsh.sessions.current"]`（web shell 持久化的当前会话）为主、composer 选举入参 `ComposerChainProps.sessionId` 为兜底；右键/长按会话菜单删除（放飞中的会话仍可在设置页查看并撤销）。

验收状态：`node scripts/verify-scanner.mjs` 50/50 全绿（含 Windows 用例与误报对照）；`node scripts/check-compat.mjs` 对本机 0.2.1-rc.2（app.asar + desktop profile）10/10 通过；Config 在真 schemastery 下构造与解析验证通过（`.step(1).min(...)` 替代 zod 专属的 `.int()`；volatile 字段解析为 `.get()` 引用）。任务 B/D 的交互面（三键卡片三路行为、白名单持久、双会话放飞对照）需在 Windows dsh web 按 §4 手动验收。**任务 C（直通 runner）已按用户决定整体退役**（2026-10-21）：`scripts/passthrough-runner.mjs`、`scripts/configure-runner.mjs` 及 install.sh 的 runner 步骤全部移除，沙箱永远使用官方内置后端（含 win32 ACL runner）；§4.4「ACL 移除」验收项作废。

---



- 本仓库上游：<https://github.com/CsBpRd/dsh-workspace-only-plugin>（main 停在 2026-08-16）
- 参考实现（0.2 配置通道 + answerer + 预设接入）：<https://github.com/timeance/dsh-approve-for-me>
- DSH 权限预设子系统：<https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/subsystems/permission-presets.md>
- DSH 插件开发 skill（本机 asar 内）：`dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（SKILL.md + references/host-plugin.md、ui-plugin.md、practices.md、user-actions.md）
- MiMo-Code 参考实现（设计意图来源）：`D:\Code\Nodejs\MiMo-Code\packages\cli\src\tool\external-directory.ts`、`packages\cli\src\permission\index.ts`、`packages\cli\src\tool\bash.ts`
- 提醒（来自官方插件开发 skill）：安装用 `plugin_manager` `install_bundle` 或 `dsh plugin add`，不要手写 profile 的 `package.json`/`cordis.patch.yml`；插件资源（locale、icon）按 host-plugin.md 检查单补齐（本仓库已有 README 与基础结构，增量时同步更新 `files` 字段与 locale 文案）。
