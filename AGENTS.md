# AGENTS.md

DeepSeek Harness (dsh) 0.2.x 插件：在工具层把任意沙箱模式下的文件访问限制在会话工作区内，越界走三键裁决。纯 ESM JS，**无构建、无测试框架、无 lint/format/typecheck**。行为矩阵与配置字段表见 `README.md`，本文件不重复。

## 命令

```sh
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX+Windows），不依赖本机 dsh 与 tmp/
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检；--asar <app.asar> 或 DSH_HOME/DSH_ASAR 指定来源
node tmp/smoke/run.mjs            # 端到端 smoke（stub dsh 包 + 真 schemastery 校验写回）；tmp/ 不入库，缺失则跳过
```

- 改 `lib/scanner.js` 或 shell 扫描行为 → 必跑 `verify-scanner.mjs`，新用例加进它的 `cases` 数组。
- 改任何 DSH 契约耦合面（审批词汇、pre-execute、插件记录、问答通道、client `require()`）→ 必跑 `check-compat.mjs`；它无 dsh 安装时 exit 1，属环境问题不是代码问题。
- smoke 的 settings stub 对每次写回跑真 `Config(patch)` 校验（schemastery 转发自 `tmp/asar` 提取物，缺了要先提取 asar）——配置形状失配在 smoke 就报红。改会话状态 API、UI 文案或 Config 形状时同步 smoke 的断言与硬编码值：断言落后 API 曾让 smoke 整段烂掉（`setBypass`→档位三态），T9 批次的回归因此漏网。
- 无 build/test/lint 脚本，别发明。

## 提交约定

- 提交信息写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`——PowerShell 下 `-m` 会毁掉引号。
- 提交信息用英文 `feat:`/`fix:`/`docs:` 前缀，可带任务编号（T1–T9）；一个任务一个 commit。
- README/docs 写中文，代码注释写英文。

## 结构

| 路径 | 角色 |
|---|---|
| `lib/index.js` | cordis 插件入口（`export name/inject/Config/apply`）；门禁装配、Config 定义 |
| `lib/scanner.js` | 纯词法路径扫描 + 读写口径（`toolAccessKind`），无依赖，可独立测 |
| `lib/ask.js` | 三键会合点、presence 握手、回退链 |
| `lib/approval-compat.js` | 官方 `approval/request` 瀑布封装（回退通道） |
| `lib/session-state.js` | 会话档位三态与审计记录 |
| `lib/remote-service.js` | client→host 管理 RPC（`workspaceOnly/*`） |
| `lib/client.js` | Web 端 UI，**手写浏览器 bundle**（见下） |
| `scripts/` | 自检脚本（随 npm 包发布，`package.json.files` 已包含） |
| `docs/` | 本地任务书，**gitignored**（`docs/.gitignore` 是 `*`），不入库 |
| `tmp/` | gitignored 工作区：smoke、探针、`commit-msg.txt` |

- `lib/client.js` 不是由源文件拼出来的：整文件手工编辑，`//#region lib/types/client/*.js` 只是区块标记，对应源文件不存在。它用 `window.__ModuleLoader__.load` 包裹，顶部 `require()` 是平台模块表查询。
- `docs/increment-plan.md` / `docs/optimization-plan.md` 是自包含任务书（含契约出入教训），改门禁语义前值得读；clone 里没有它们。
- `cordis.patch.yml` 只挂 host 插件行；**patch 的 `config` override 是整体替换**，写 override 要带全字段。

## 关键契约（不读源码/多文件推不出来）

- **会话持久化**：DSH 拒绝未知事件类型（除非 `ignorable: true`），而 `Session.append()` 不能设置该标记 → 插件状态一律走 `appendPluginRecord` 的 `plugin:` 记录（`session-state.js` 的 `RECORD`），不能用裸自定义事件。进程内 map 是权威，丢记录 fail-safe 回最严档位。
- **审批绕过 `ApprovalService`**：`approval-compat.js` 直接 `ctx.waterfall("approval/request")`，刻意不走 `ApprovalService.request()` 的 `never` 策略短路——Full access 会话也要弹窗，这是插件的核心价值。改这里会破坏核心语义。
- **升权跳过门禁**仅当 `sandbox_permissions` 目标模式**严格宽于**会话当前模式（官方升权弹窗必现时，避免双弹窗）；重复/畸形升权在官方侧零弹窗，必须照走三键。
- **client `require()` 白名单**：只允许平台 module table 已有模块（`check-compat` 探测 7 会抓越界）；0.2 已无 `@deepseek-ai/dsh-client-runtime`，所以自带 ~15 行 snapshot store，别改回官方 store。
- **`remote-service.js` 刻意不 import** `@deepseek-ai/dsh-typert-protocol`，binding/descriptor 字面复刻——保持在缺该包的 composition 上可加载。
- **不声明 `peerDependencies` 是有意的**：DSH 内部包以 prerelease（`0.2.1-rc.2`）演进，任何 semver 范围都会误报不兼容；兼容性只信 `check-compat.mjs`。
- **`.volatile()` 配置字段**（`enabled`/`always`/`sensitiveAlways`/`deny`）与设置表单共享同一实时引用，运行时写回走设置服务——别深拷贝。**集合元素的形状必须被 Config schema 收纳**：`always` 两种条目（字符串=全局、`{root, dir}`=会话级）都在 `z.union` 里；只声明过 `z.string()` 的那版会让每次 `{root, dir}` 写回被 schemastery 打回，症状极具误导性——卡片「总是允许该目录」静默降级为仅此一次（`grant()` 的 catch 吞掉错误）、白名单视图添加无反应，而设置页的全局添加（字符串）照常工作。新增条目形状先改 schema。
- **`LABELS.*` 既是文案又是匹配键**（`lib/ask.js`）：回退问答 `choiceFromAnswer` 按 label 反查 choice——改文案只动常量即自洽，别把匹配逻辑改成硬编码字符串；smoke 的 `questionChoice` 引 `LABELS.always`。
- **Windows 一等公民**：路径包含判定对 win 形态用 `path.win32` 语义（大小写不敏感）；盘符、UNC、`..\`、反斜杠转义、`%USERPROFILE%`/`$env:USERPROFILE` 都要扫到。改扫描先看 `verify-scanner.mjs` 的 false-positive 对照组。
- **失败方向永远 fail-closed**：超时=拒、无应答渠道=拒（`fastDenyMs>0` 时秒拒）、档位记录丢失=最严档。别改成 fail-open。
- 环境变量 `WORKSPACE_ONLY_PRESENCE_WAIT_MS` 缩短 presence 等待（smoke 用）。

## 环境

- 开发机是 Windows + PowerShell；DSH Desktop 的 asar 通常在 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`。
- Node `^22.19.0 || >=24.0.0`。仓库根无 `node_modules`——`@deepseek-ai/*` 由 dsh 宿主提供，本地跑 `lib/index.js` 需要 stub（参考 `tmp/smoke/run.mjs`）。
