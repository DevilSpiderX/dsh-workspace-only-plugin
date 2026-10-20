# dsh-workspace-only-plugin

DeepSeek Harness (dsh) 插件：把**任何沙箱模式**（read-only / workspace-write / danger-full-access / auto）下代理的文件访问限制在会话工作区内，越界访问一律请用户裁决。适配 DSH **0.2.x**（已在 0.2.1-rc.2 验证）。

## 功能

- **全局开关**（`Config.enabled`）：开启后，越出工作区的 `read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh` 调用都会停下来问用户；关闭则完全不干预。
- **三键裁决**（`仅此一次 / 总是允许本目录 / 拒绝`）：
  - 通过官方的 `ctx.userQuestions` 问答通道提问（DSH 为「permission plugins」预留的 `user-questions/request` 瀑布），Web 端在输入栏旁弹出可回答的问题卡片；其他 answer UI（TUI 等）同样可用；
  - **总是允许本目录** → 目录写入 `Config.always` 白名单（持久化到 profile 的 `cordis.patch.yml`），同目录后续直接放行；
  - **拒绝 / 关闭卡片 / 超时**（`Config.dialogTimeoutMs`，默认 120s）→ 拒绝该次调用；
  - 无任何应答端（headless）或提问方是子代理 → 回退到官方 `approval/request` 弹窗（与旧版行为一致，**依然绕过 `never` 策略**，Full access 会话也弹）；完全没有应答渠道时拒绝（fail closed）。
- **白名单管理**：设置页列出/删除已允许目录；「最近询问的目录」一键加白（上限 20 条，仅展示用）。
- **会话级放飞**（per-session bypass）：composer 快捷按钮**右键或长按**打开会话菜单，「放飞本会话 / 恢复本会话」；放飞的会话直接跳过门禁（连白名单都不查），其他会话照常。状态记在会话日志（ignorable `plugin:` 记录）+ 进程内权威，跨重启保留、会话间隔离。设置页可查看并撤销。
- **Windows 路径扫描**：shell 命令里的盘符（`C:\...`、`C:/...`）、UNC（`\\server\share`）、反斜杠逃逸（`..\`）与 POSIX 形态同等对待；路径包含判定对 Windows 形态使用 `path.win32` 语义（大小写不敏感）。
- **直通 runner**（可选，任务 C）：用官方 `runnerCommand` 顶掉 win32 的 ACL 受限令牌 runner，消除误拒与受限令牌开销；`dsh-fs-sandbox` 进程内写围栏与 `sandbox_permissions` 升权流程**不变**。
- 零 node_modules 补丁：开关/白名单走插件 Config（DSH 0.2 配置通道），不再需要 0.1 时代 apiproxy 白名单补丁；`workspace-write` 预设改名 "Write Only" 改为可选项（默认关闭，与 auto 插件零冲突）。

## 安装

**一行安装（推荐）：**

```sh
curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-workspace-only-plugin/main/install.sh | bash
```

脚本自动：`dsh plugin add` 装进 profile → 写入直通 runner 覆盖（`DSH_KEEP_ACL=1` 可跳过）→ 检测到运行中的 dsh web 则以原命令行重启。环境变量：`DSH_PROFILE`（默认 web）、`DSH_HOME`、`DSH_KEEP_ACL=1`、`DSH_NO_RESTART=1`。

**手动安装：**

1. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加 `"dsh-workspace-only-plugin": "github:CsBpRd/dsh-workspace-only-plugin"`，并在 `dsh.profile.bundles` 末尾追加 `"dsh-workspace-only-plugin"`；
2. `cd ~/.dsh/profiles/web && pnpm install`；
3. （可选，换掉 ACL runner）`node node_modules/dsh-workspace-only-plugin/scripts/configure-runner.mjs --profile web`；
4. 重启 dsh web。

**升级 dsh 后**请跑一次自检：`node scripts/check-compat.mjs`（探测审批词汇、pre-execute 词汇、插件记录通道、问答通道、runner 覆盖、volatile 配置等契约，漂移会打印差异报告）。

## 配置

配置住在插件的 DSH 0.2 Config 里（当前 profile 的 `cordis.patch.yml` → `config`），设置卡片与插件共享同一份实时值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 门禁总开关（运行时可写，`.volatile()`） |
| `always` | `[]` | 总是允许的目录白名单（运行时可写，`.volatile()`） |
| `renamePresetLabel` | `false` | 把 `workspace-write` 预设显示名改为 "Write Only"；开启后与 `@nanmicoder/dsh-auto-mode` 的标签匹配可能冲突 |
| `dialogTimeoutMs` | `120000` | 三键问题的等待上限，超时按拒绝处理 |

手动编辑示例（profile 的 `cordis.patch.yml` 追加）：

```yaml
- id: workspace-only
  config:
    enabled: true
```

注意：patch 的 override 语义是**整体替换** `config`，写 override 时带上需要的全部字段。

## 直通 runner（ACL 替换，任务 C）

win32 默认的沙箱后端是 ACL 受限令牌 runner，实际使用中可能误拒正常文件访问。直通 runner 改为直接执行命令：

- 写入的覆盖（`scripts/configure-runner.mjs` 幂等维护，标记注释 `# workspace-only-passthrough-runner`）：

  ```yaml
  - id: sandbox
    config:
      runnerCommand: ["<node 绝对路径>", "<插件绝对路径>/scripts/passthrough-runner.mjs"]
      runnerFailureSignatures: ["workspace-only-passthrough: "]
  ```

- **回退**：删除该块（或 `node scripts/configure-runner.mjs --remove`）即恢复内置 runner 链。
- **取舍**：换掉 ACL 后 shell 命令**没有内核级隔离**，防线 = 工具层词法门禁 + 三键裁决 + `dsh-fs-sandbox` 写围栏 + 升权确认（与 MiMo-Code 同级威胁模型）。
- runner 自身故障打 `workspace-only-passthrough: <detail>` 并以 127 退出，由 `runnerFailureSignatures` 归类为「runner 坏了」而非「命令失败」。

## 与 auto 插件共存

`renamePresetLabel` 默认 `false`，本插件不再改预设名，与 `@nanmicoder/dsh-auto-mode` 零冲突（也不再需要它的标签补丁）。若显式开启改名，auto 插件按标签匹配权限菜单的逻辑需要自行适配。

## 边界与残余面

- 收编是**工具层词法门禁**，非内核隔离。扫描器看不到的路径（完全动态计算、环境变量拼接如 `%USERPROFILE%`）是文档化的残余面，与 auto-mode 插件同级哲学。
- 在 workspace-write 会话，批准后的越界**写**仍受进程内写围栏拦截（`FS_SANDBOX_DENIED`），随后走 dsh 既有 `sandbox_permissions` 升权再确认一次——写操作始终需要明确同意；携带 `sandbox_permissions` 的调用本身跳过本插件门禁（避免双弹窗）。
- 三键问题卡片渲染依赖 Web 端 user-questions UI；关闭卡片视为拒绝。headless/TUI 回退官方审批弹窗。
- 会话放飞的持久化尽力而为（ignorable 插件记录 + 进程内权威 + 下一次 turn 内补写）；极端丢失时门禁自动恢复（fail-safe）。

## 开发自检

```sh
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX + Windows，含误报对照）
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检
```

实现结构：`lib/scanner.js`（纯词法扫描，可独立测试）、`lib/ask.js`（三键会合点与回退链）、`lib/approval-compat.js`（官方审批瀑布封装）、`lib/session-state.js`（会话级放飞与审计记录）、`lib/remote-service.js`（client→host 管理 RPC）、`lib/index.js`（门禁装配）、`lib/client.js`（设置行与 composer 快捷按钮/菜单）。

设计与 DSH 运行时契约详见 [`docs/increment-plan.md`](docs/increment-plan.md)（含实现中发现的契约出入记录）。
