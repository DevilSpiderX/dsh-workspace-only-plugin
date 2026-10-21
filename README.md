# dsh-workspace-only-plugin

DeepSeek Harness (dsh) 插件：把**任何沙箱模式**（read-only / workspace-write / danger-full-access / auto）下代理的文件访问限制在会话工作区内，越界访问一律请用户裁决。适配 DSH **0.2.x**（已在 0.2.1-rc.2 验证）。

## 功能

- **全局开关**（`Config.enabled`）：开启后，越出工作区的 `read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh` 调用都会停下来问用户；关闭则完全不干预。
- **三键裁决**（`仅此一次 / 总是允许本目录 / 拒绝`）：
  - 越界调用触发时，输入栏被一张**三键卡片接管**——与 dsh 权限提升面板同款形态（警示条 + 工具/目标路径/原因 + 按钮行），`Enter`=仅此一次、`Esc`=拒绝；
  - **总是允许本目录** → 目录写入 `Config.always` 白名单（持久化到 profile 的 `cordis.patch.yml`），同目录后续直接放行；
  - **拒绝 / 超时**（`Config.dialogTimeoutMs`，默认 120s）→ 拒绝该次调用；
  - 无 Web 客户端（卡片未现身）→ 回退通用问题卡片（`ctx.userQuestions`，TUI 等）→ 再回退官方 `approval/request` 弹窗（与旧版行为一致，**依然绕过 `never` 策略**，Full access 会话也弹）；完全没有应答渠道时拒绝（fail closed）。
- **白名单管理**：设置页列出/删除已允许目录；「最近询问的目录」一键加白（上限 20 条，仅展示用）。
- **会话级开关**（per-session bypass）：composer 旁的快捷按钮控制**本会话**的门禁，悬停有作用域说明——「仅工作区：开/关」，单击即放飞本会话 / 恢复本会话；放飞的会话直接跳过门禁（连白名单都不查），其他会话照常。总开关关闭或未打开会话时按钮隐藏。状态记在会话日志（ignorable `plugin:` 记录）+ 进程内权威，跨重启保留、会话间隔离；设置页可查看并撤销放飞中的会话。
- **Windows 路径扫描**：shell 命令里的盘符（`C:\...`、`C:/...`）、UNC（`\\server\share`）、反斜杠逃逸（`..\`）与 POSIX 形态同等对待；路径包含判定对 Windows 形态使用 `path.win32` 语义（大小写不敏感）。
- 零 node_modules 补丁：开关/白名单走插件 Config（DSH 0.2 配置通道），不再需要 0.1 时代 apiproxy 白名单补丁；`workspace-write` 预设改名 "Write Only" 改为可选项（默认关闭，与 auto 插件零冲突）。

## 安装

DSH 0.2 自带完整插件安装器（依赖安装、`dsh.bundle` 校验、版本兼容预检，不兼容会拒装并回滚），任选一条路径：

**方式一：web GUI 安装**

1. 打开 dsh web 的「插件」页；
2. 「包名或地址」填 `github:CsBpRd/dsh-workspace-only-plugin#main`，点「安装」；
3. 完成后重启 dsh web（提示「已安装，下次启动后加载」），再打开 Workspace Only 开关。

**方式二：一行 CLI**

```sh
dsh plugin --profile web add "github:CsBpRd/dsh-workspace-only-plugin#main"
```

然后重启 dsh web（`--profile` 换成你的 profile 名）。

> `github:` 直连不走安装源，机器需能直接访问 GitHub。访问不了时可下载 `.tgz` 后填绝对路径安装；插件若发布到 npm 后也可直接填包名。

**升级 dsh 后**请跑一次自检：`node scripts/check-compat.mjs`（探测审批词汇、pre-execute 词汇、插件记录通道、问答通道、volatile 配置、client 模块表等契约，漂移会打印差异报告）。

> 为什么 `package.json` 不声明 `peerDependencies`：DSH 内部包的版本随发行版以 prerelease 形态演进（如 `0.2.1-rc.2`），semver 对 prerelease 的匹配规则是「只允许同 `major.minor.patch` 且带 prerelease 标记的比较器」——任何固定范围（包括 `*`）都会在下一次 rc 升级时误报「不兼容」。本插件按官方 Host-only bundle 的做法不声明依赖，真实兼容性由 `scripts/check-compat.mjs` 探测实际契约来判定。

## 配置

配置住在插件的 DSH 0.2 Config 里（当前 profile 的 `cordis.patch.yml` → `config`），设置卡片与插件共享同一份实时值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 门禁总开关（运行时可写，`.volatile()`） |
| `always` | `[]` | 总是允许的目录白名单（运行时可写，`.volatile()`） |
| `sensitivePatterns` | `["*.env","*.env.*","*.pem","*.key","*.p12","*.pfx","id_rsa*","id_ed25519*"]` | 敏感文件 basename glob：**工作区内也弹三键** |
| `sensitiveAllowPatterns` | `["*.env.example","*.env.sample","*.env.template","*.env.defaults"]` | 敏感豁免（优先于 `sensitivePatterns`，如 `.env.example` 不弹） |
| `sensitiveAlways` | `[]` | "总是允许此类文件"持久化的 pattern（运行时可写，`.volatile()`；与目录白名单**正交**，"总是允许本目录"不会放行敏感文件） |
| `renamePresetLabel` | `false` | 把 `workspace-write` 预设显示名改为 "Write Only"；开启后与 `@nanmicoder/dsh-auto-mode` 的标签匹配可能冲突 |
| `dialogTimeoutMs` | `120000` | 三键问题的等待上限，超时按拒绝处理 |

手动编辑示例（profile 的 `cordis.patch.yml` 追加）：

```yaml
- id: workspace-only
  config:
    enabled: true
```

注意：patch 的 override 语义是**整体替换** `config`，写 override 时带上需要的全部字段。

## 与 auto 插件共存

`renamePresetLabel` 默认 `false`，本插件不再改预设名，与 `@nanmicoder/dsh-auto-mode` 零冲突（也不再需要它的标签补丁）。若显式开启改名，auto 插件按标签匹配权限菜单的逻辑需要自行适配。

## 行为矩阵（官方模式 × 仅工作区开关）

三键门禁与官方沙箱是**叠加**关系：门禁只决定"越界要不要问你"，实际执行仍受官方模式约束（批准 ≠ 越权）。以下均基于官方内置沙箱后端（含 win32 ACL runner）。

| 官方模式 | 仅工作区 **开** | 仅工作区 **关** |
|---|---|---|
| **read-only** | 工作区内读照常；**越界读弹三键**（允许才读）。写操作（越界时）也弹，但**批准了也写不了**——read-only 下官方围栏拒绝一切变更 | 纯官方只读：读随意、写全拒 |
| **workspace-write** | 门禁与官方围栏叠加（典型配置）：越界**读**弹三键，允许即读；越界**写**弹三键 → 允许后仍被写围栏拦（`FS_SANDBOX_DENIED`）→ 再走 `sandbox_permissions` 升权确认 → 才真写（**双确认**）；工作区内读写照常不弹；shell 命令内路径扫描，越界路径弹三键 | 纯官方 workspace-write：越界读随意；越界写靠写围栏 + 升权；工作区内可写 |
| **danger-full-access** | **核心用例**：官方无任何围栏，但越界读/写/搜索/shell **全部弹三键**（approval policy 为 `never` 也照弹）；批准后完全放行 | **⚠️ 完全裸奔**：无围栏、无门禁，代理可读写任意路径 |

通用规则（所有格子适用）：

- **会话放飞**优先级最高：放飞的会话直接跳过门禁（等效该会话"关"），其他会话不受影响；
- **白名单目录**（"总是允许本目录"）内免弹，等效工作区内；
- **敏感文件**（`sensitivePatterns` 命中的 basename）**工作区内也弹三键**：一次调用既越界又敏感只弹一次（原因合并）；"总是允许此类文件"按 **pattern** 持久化（`sensitiveAlways`），与目录白名单正交——"总是允许本目录"不会放行敏感文件；
- **平台临时区**默认免弹：`%TEMP%`/`os.tmpdir()` 下 `dsh-*` 或 `.dsh-*` 一级子目录（含子树）是 DSH 自己生成的落盘目录——`dsh-subprocess-*`（子进程大输出 spill）、`dsh-spill-*`（工具结果溢出）、`dsh-*`（沙箱受限进程的私有 TEMP）等，工具跟随 `spillPath` 或展开 `%TEMP%` 时不再询问；临时根本身、其下普通文件、其他位置的同名前缀目录照旧弹；
- 带 `sandbox_permissions` 的升权调用**仅当目标模式严格宽于会话当前模式**（官方升权弹窗必现）时才跳过门禁（避免双弹窗）；重复（等于当前模式）或畸形的升权请求在官方侧**零弹窗**直接放行/报错，一律照走三键门禁，堵死"重复升权绕过"；
- 审批策略（`ask`/`never`）不影响门禁：弹窗不走 `ApprovalService`，`never` 会话也照弹。

推荐组合：

| 想要的效果 | 组合 |
|---|---|
| 最强约束（默认建议） | `workspace-write` + **开** |
| 只防读泄露、允许自由写 | `danger-full-access` + **开** |
| 纯官方行为 | 任意模式 + **关** |
| 不推荐 | `danger-full-access` + **关**（除非在一次性隔离环境） |

## 边界与残余面

- 收编是**工具层词法门禁**，非内核隔离。home 形态（`~`/`$HOME`/`${HOME}`/`%USERPROFILE%`/`%HOMEPATH%`/`$env:USERPROFILE`/`$env:HOMEPATH`）已统一展开为真实路径判定（单引号内的字面量除外）；扫描器看不到的路径（完全动态计算、其他环境变量拼接）是文档化的残余面，与 auto-mode 插件同级哲学。
- 在 workspace-write 会话，批准后的越界**写**仍受进程内写围栏拦截（`FS_SANDBOX_DENIED`），随后走 dsh 既有 `sandbox_permissions` 升权再确认一次——写操作始终需要明确同意；携带 `sandbox_permissions` 的调用仅在官方升权弹窗必现（目标模式严格宽于会话当前模式）时跳过本插件门禁（避免双弹窗），重复/畸形升权照走三键。
- 三键卡片渲染依赖 Web 端（`conversation.composer` 槽位接管）；无 Web 客户端时回退通用问题卡片（TUI 等）→ 官方审批弹窗。卡片超时视为拒绝。
- 沙箱执行约束全部沿用官方（含 win32 的 ACL 受限令牌 runner 与 `dsh-fs-sandbox` 写围栏）：本插件只在工具层加门禁，不改动任何沙箱后端。
- 会话放飞的持久化尽力而为（ignorable 插件记录 + 进程内权威 + 下一次 turn 内补写）；极端丢失时门禁自动恢复（fail-safe）。

## 开发自检

```sh
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX + Windows，含误报对照）
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检
```

实现结构：`lib/scanner.js`（纯词法扫描，可独立测试）、`lib/ask.js`（三键会合点与回退链）、`lib/approval-compat.js`（官方审批瀑布封装）、`lib/session-state.js`（会话级放飞与审计记录）、`lib/remote-service.js`（client→host 管理 RPC）、`lib/index.js`（门禁装配）、`lib/client.js`（设置行与 composer 会话级快捷开关）。

设计与 DSH 运行时契约详见 [`docs/increment-plan.md`](docs/increment-plan.md)（含实现中发现的契约出入记录）。
