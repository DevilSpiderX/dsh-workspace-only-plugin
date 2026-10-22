# dsh-workspace-only-plugin

DeepSeek Harness (dsh) 插件：把**任何沙箱模式**（read-only / workspace-write / danger-full-access / auto）下代理的文件访问限制在会话工作区内，越界访问一律请用户裁决；每个会话还能用 composer 旁的**档位选择框**把越界门禁放宽为「工作区外只读」或「完全放开」。适配 DSH **0.2.x**（已在 0.2.1-rc.2 验证）。

## 功能

- **全局开关**（`Config.enabled`）：开启后，越出工作区的 `read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh` 调用都会停下来问用户；关闭则完全不干预。
- **三键裁决**（`仅此一次 / 总是允许该目录 / 拒绝`）：
  - 越界调用触发时，输入栏被一张**三键卡片接管**——与 dsh 权限提升面板同款形态（警示条 + 工具/目标路径/原因 + 按钮行），`Enter`=仅此一次、`Esc`=拒绝；
  - **总是允许该目录** → 目录写入**会话级**白名单条目 `{root, dir}`（root=授权会话的工作区根，仅同根会话生效；持久化到 profile 的 `cordis.patch.yml`），同目录后续直接放行；
  - **拒绝 / 超时**（`Config.dialogTimeoutMs`，默认 120s）→ 拒绝该次调用；
  - **同一会话的并发询问逐张排队**（子代理并行工具调用就是同会话并发）：一次只出现一张卡片，答完这张才轮到下一张，不会出现「点了不关」（多张卡片挤占同一渲染席位）；排队中的调用若已被新写入的白名单条目覆盖，出队时直接放行（等效批量放行），不再弹卡；
  - **子代理的询问会在会话标题栏亮「待审批 N」徽章**（黄点 + 计数，悬停列出各请求的会话与目标路径，点击跳到该子代理——卡片就在它的输入栏）；每个请求另弹一次顶部 toast。徽章只统计当前视图看不到卡片的请求（本会话自己的卡片就在眼前，不计数），应答或 `askDone` 结算后即时消退；
  - 无 Web 客户端（卡片未现身）→ 回退通用问题卡片（`ctx.userQuestions`，TUI 等）→ 再回退官方 `approval/request` 弹窗（与旧版行为一致，**依然绕过 `never` 策略**，Full access 会话也弹）；完全没有应答渠道时拒绝（fail closed）。
- **会话档位选择框**（composer 权限选择器旁，与「仅可查看/工作区内修改/完全权限」同款下拉）：三档调节**本会话**的门禁强度——**仅工作区内**（越界读写都询问）/ **工作区外只读**（越界读放行、越界写询问）/ **完全放开**（越界读写都放行）。档位记在会话日志（ignorable `plugin:` 记录）+ 进程内权威，跨重启保留、会话间隔离；读写口径：`read`/`read_image`/`glob`/`grep` 算读，`write`/`edit` 与 shell（`bash`/`pwsh`，无法静态分辨读写）算写。**敏感文件弹窗与「永不放行」规则在任何档位都生效**。总开关关闭或未打开会话时选择框隐藏。
- **白名单分两处管理**：
  - **设置 → Workspace Only → 总是允许的目录（全局）**：只放全局条目（处处生效），可手动添加/删除；
  - **会话页 → 白名单目录**（与「对话 / 轨迹」并列的视图）：只放本工作区的**会话级**条目（询问卡片「总是允许该目录」写入的），可添加/删除；
  - 「最近询问的目录」一键加白写入**全局**（上限 20 条，仅展示用）。
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
| `always` | `[]` | 总是允许的目录白名单（运行时可写，`.volatile()`）：字符串条目=**全局**（设置页管理，处处生效）；`{root, dir}` 条目=**会话级**（会话页「白名单目录」管理，仅同 root 会话生效） |
| `sensitivePatterns` | `["*.env","*.env.*","*.pem","*.key","*.p12","*.pfx","id_rsa*","id_ed25519*"]` | 敏感文件 basename glob：**工作区内也弹三键** |
| `sensitiveAllowPatterns` | `["*.env.example","*.env.sample","*.env.template","*.env.defaults"]` | 敏感豁免（优先于 `sensitivePatterns`，如 `.env.example` 不弹） |
| `sensitiveAlways` | `[]` | "总是允许此类文件"持久化的 pattern（运行时可写，`.volatile()`；与目录白名单**正交**，"总是允许该目录"不会放行敏感文件） |
| `deny` | `[]` | **永不放行**规则：以 `/` 或 `\` 结尾按目录前缀、否则按 glob 全路径匹配（运行时可写，`.volatile()`）；命中直接拒绝、不弹窗、**优先级最高** |
| `renamePresetLabel` | `false` | 把 `workspace-write` 预设显示名改为 "Write Only"；开启后与 `@nanmicoder/dsh-auto-mode` 的标签匹配可能冲突 |
| `dialogTimeoutMs` | `120000` | 三键问题的等待上限，超时按拒绝处理 |
| `fastDenyMs` | `0` | 非交互快速 fail-closed 预算（毫秒）：`>0` 时无应答渠道（无 UI）的调用在该预算内直接拒绝、不走系统弹窗兜底；`0` 保持完整回退链 |
| `scanAllTools` | `false` | 全量保守扫描（opt-in）：白名单 8 工具之外的工具也按参数里的路径形状判定（可能对含路径样文本的参数误报） |
| `scanIgnoreTools` | `[]` | 保守扫描的工具豁免名单（误报逃生舱） |
| `realpathCheck` | `false` | realpath 复核（opt-in，T11）：对词法判「工作区内」的路径做一次 `fs.realpath` 复核，工作区内符号链接指向区外时改判越界、照走三键；每条目一次同步 fs 调用（性能代价），解析失败按越界询问（fail-closed） |

手动编辑示例（profile 的 `cordis.patch.yml` 追加）：

```yaml
- id: workspace-only
  config:
    enabled: true
    always:
      - C:\data\shared\          # 全局条目（字符串）：处处生效
      - root: C:\work\project    # 会话级条目 {root, dir}：仅同 root 会话生效
        dir: C:\data\project-cache\
```

注意：patch 的 override 语义是**整体替换** `config`，写 override 时带上需要的全部字段。

### 内置默认白名单（不占配置字段）

除配置里的 `always` 外，还有一条**内置默认**白名单：`<DSH_HOME>/dsh-runtimes/dsh-primary-runtime` 目录树始终按**全局条目**放行（等效设置页条目，处处生效）。

- 该目录就是 Desktop 把随附 Python/Node/pnpm 分发包安装进去的目标根（宿主 `desktop-host` 的 `root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime')`）；home 解析逐条对齐宿主 `resolveDshHome()`（`@deepseek-ai/dsh-home-paths`）：`$DSH_HOME` **非空白**时以它为准（空白值按未设置处理，`~`/`~/`/`~\` 拼写展开，结果解析为绝对路径），否则回退 `~/.dsh`；条目在**每次判定时**从环境解析，不写死绝对路径、不持久化进 `cordis.patch.yml`，换机器/换用户自动适配（`check-compat.mjs` probe 12 盯住该契约的漂移）；
- 设置页「默认白名单（内置）」分组只读展示**本机解析结果**，不可移除（要收紧请用 deny 规则，它优先级更高）；
- 只放行**越界维度**：deny 规则仍优先压过它；敏感文件（`sensitivePatterns`）照旧弹三键，与目录白名单正交的语义不变。

## 与 auto 插件共存

`renamePresetLabel` 默认 `false`，本插件不再改预设名，与 `@nanmicoder/dsh-auto-mode` 零冲突（也不再需要它的标签补丁）。若显式开启改名，auto 插件按标签匹配权限菜单的逻辑需要自行适配。

## 行为矩阵

### 会话档位 × 越界访问（composer 旁选择框，仅本会话生效）

| 会话档位 | 越界**读**（`read`/`read_image`/`glob`/`grep`） | 越界**写**（`write`/`edit`/`bash`/`pwsh`） | 敏感文件 | deny 规则 |
|---|---|---|---|---|
| **仅工作区内**（默认） | 弹三键 | 弹三键 | 弹三键 | 命中即拒 |
| **工作区外只读** | **放行** | 弹三键（shell 保守按写） | 弹三键 | 命中即拒 |
| **完全放开** | **放行** | **放行** | 弹三键 | 命中即拒 |

### 官方模式 × 会话档位（总开关=开；档位只放行本插件门禁，官方围栏始终叠加）

三键门禁与官方沙箱是**叠加**关系：门禁只决定"越界要不要问你"，实际执行仍受官方模式约束（批准 ≠ 越权）。以下均基于官方内置沙箱后端（含 win32 ACL runner）。

| 官方模式 | 仅工作区内（默认） | 工作区外只读 | 完全放开 |
|---|---|---|---|
| **read-only** | 越界读写都弹三键；批准后读可以，**写仍被官方只读围栏拒绝** | 越界**读**放行；越界写弹三键（批准了也写不了） | 越界读写都不弹，但官方只读围栏仍在：**写全拒** |
| **workspace-write** | 越界读弹 → 允许即读；越界写弹 → 允许后仍被写围栏拦（`FS_SANDBOX_DENIED`）→ 再走 `sandbox_permissions` 升权确认（**双确认**）；shell 命令内越界路径照弹 | 越界**读**放行；越界写照左侧的双确认链弹 | 越界读写都不弹；越界写仍走官方写围栏 + 升权链（`workspace-write` 的官方语义不变） |
| **danger-full-access** | **核心用例**：官方无任何围栏，越界读/写/搜索/shell **全部弹三键**（approval policy 为 `never` 也照弹）；批准后完全放行 | 越界**读**放行；越界写弹三键 | 越界读写全放行（仅敏感文件仍弹、deny 仍拦） |

**总开关=关**：任何档位都不生效（composer 的档位选择框也隐藏），纯官方行为——`read-only` 读随意、写全拒；`workspace-write` 越界读随意、越界写靠写围栏 + 升权；`danger-full-access` **⚠️ 完全裸奔**（无围栏、无门禁，代理可读写任意路径）。

敏感文件（弹三键）与「永不放行」规则（命中即拒）在上表**任何格子**都生效，与模式、档位无关。

通用规则（所有格子适用）：

- **deny 规则**优先级最高：命中直接拒绝、不弹窗，压过白名单、会话档位、总开关与平台临时区豁免（设置页可管理）；
- **会话档位**（composer 旁选择框）决定越界读写要不要问：**仅工作区内**=越界读写都问；**工作区外只读**=越界读放行、越界写问（shell 保守按写）；**完全放开**=越界读写都放行。档位与白名单是**叠加放行**（任一放行即免弹），但压不过 deny 规则，且只影响越界维度；
- **白名单目录**内免弹，等效工作区内：全局条目（设置页）处处生效；会话级条目（`{root, dir}`，会话页「白名单目录」）仅同工作区根的会话生效；询问卡片「总是允许本目录」写入**会话级**条目；另有**内置默认条目** `<DSH_HOME>/dsh-runtimes/dsh-primary-runtime`（每次判定实时解析，处处生效、不可删除，见「内置默认白名单」）；
- **敏感文件**（`sensitivePatterns` 命中的 basename）**工作区内也弹三键，且不受会话档位影响**（「完全放开」档也弹）：一次调用既越界又敏感只弹一次（原因合并）；"总是允许此类文件"按 **pattern** 持久化（`sensitiveAlways`），与目录白名单正交——"总是允许该目录"不会放行敏感文件；
- **平台临时区**默认免弹：`%TEMP%`/`os.tmpdir()` 下 `dsh-*` 或 `.dsh-*` 一级子目录（含子树）是 DSH 自己生成的落盘目录——`dsh-subprocess-*`（子进程大输出 spill）、`dsh-spill-*`（工具结果溢出）、`dsh-*`（沙箱受限进程的私有 TEMP）等，工具跟随 `spillPath` 或展开 `%TEMP%` 时不再询问；临时根本身、其下普通文件、其他位置的同名前缀目录照旧弹；
- 带 `sandbox_permissions` 的升权调用**仅当目标模式严格宽于会话当前模式**（官方升权弹窗必现）时才跳过门禁（避免双弹窗）；重复（等于当前模式）或畸形的升权请求在官方侧**零弹窗**直接放行/报错，一律照走三键门禁，堵死"重复升权绕过"；
- 审批策略（`ask`/`never`）不影响门禁：弹窗不走 `ApprovalService`，`never` 会话也照弹。

推荐组合：

| 想要的效果 | 官方模式 | 总开关 | 会话档位 |
|---|---|---|---|
| 最强约束（默认建议） | `workspace-write` | 开 | **仅工作区内** |
| 只防读泄露、允许自由写 | 任意 | 开 | **工作区外只读** |
| 临时放开一个会话（探索 / 迁移数据 / 演示） | 任意 | 开 | **完全放开**（敏感仍弹、deny 仍拦） |
| 只要官方围栏 | 任意 | 关 | —（不生效） |
| ⚠️ 不推荐 | `danger-full-access` | 关 | —（裸奔，仅限一次性隔离环境） |

## 边界与残余面

- 收编是**工具层词法门禁**，非内核隔离。home 形态（`~`/`$HOME`/`${HOME}`/`%USERPROFILE%`/`%HOMEPATH%`/`$env:USERPROFILE`/`$env:HOMEPATH`）已统一展开为真实路径判定（单引号内的字面量除外）；扫描器看不到的路径（完全动态计算、其他环境变量拼接）是文档化的残余面，与 auto-mode 插件同级哲学。
- 词法围栏**默认不解析符号链接**（残余面，T11）：工作区内符号链接指向区外时，路径仍是「工作区内」词法字符串 → 不拦截，底层 fs 操作会跟随链接越界——与 MiMo `AppFileSystem.contains` 同哲学（两边一致）。开启 `realpathCheck` 后，命中「工作区内」的路径经 `fs.realpath` 复核（对尚不存在的目标取最深存在祖先 canonicalize 后重拼余段，覆盖「写新文件、父目录是链接」场景；root 与目标双方都解析，macOS `/tmp`→`/private/tmp` 不误拒）：解析到区外改判越界照走三键，解析失败 fail-closed 按越界询问。残余面收窄但仍存：**白名单 / deny 规则仍按词法路径匹配**（链接路径与其真身不互通）。
- 默认只精确扫描 8 个工具（`read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh`，误报低）；MCP/插件注册的其他工具默认不设防。开启 `scanAllTools` 进入全量保守模式：任何工具的参数里出现路径形状值都会判定，配合 `scanIgnoreTools` 豁免误报工具；shell 命令内的**相对**敏感路径（如 `cat .env`）不在词法扫描范围内。
- 在 workspace-write 会话，批准后的越界**写**仍受进程内写围栏拦截（`FS_SANDBOX_DENIED`），随后走 dsh 既有 `sandbox_permissions` 升权再确认一次——写操作始终需要明确同意；携带 `sandbox_permissions` 的调用仅在官方升权弹窗必现（目标模式严格宽于会话当前模式）时跳过本插件门禁（避免双弹窗），重复/畸形升权照走三键。
- 三键卡片渲染依赖 Web 端（`conversation.composer` 槽位接管）；无 Web 客户端时回退通用问题卡片（TUI 等）→ 官方审批弹窗。卡片超时视为拒绝。设置 `fastDenyMs > 0` 可让无应答渠道的调用（后台/无 UI）秒级拒绝而不挂满超时（`fast-deny` 审计通道）。卡片席位按 `requestId` 去重；询问在 Host 侧结算（超时、批量放行、其他客户端作答）后广播 `askDone`，各端残留卡片自动撤下。
- composer 档位选择框与会话页「白名单目录」视图依赖 Web 端槽位（`conversation.input.left` / `conversation.view`，用 `@deepseek-ai/dsh-client-ui-primitives` 渲染）；TUI 等无此界面时档位保持「仅工作区内」，白名单只能从设置页或询问卡片维护。待审批徽章与 toast 提示同样依赖 Web 端槽位（`conversation.session.header.utilities` / `shell.overlay`）。
- 档位的读写口径是**工具级**的：shell（`bash`/`pwsh`）命令内无法静态分辨读写，一律按写处理（「工作区外只读」下 shell 越界照弹）；`scanAllTools` 覆盖的未知工具同样保守按写。
- 沙箱执行约束全部沿用官方（含 win32 的 ACL 受限令牌 runner 与 `dsh-fs-sandbox` 写围栏）：本插件只在工具层加门禁，不改动任何沙箱后端。
- 会话档位的持久化尽力而为（ignorable 插件记录 + 进程内权威 + 下一次 turn 内补写）；极端丢失时门禁自动恢复为「仅工作区内」（fail-safe）。

## 开发自检

```sh
node scripts/verify-scanner.mjs   # 词法扫描用例（POSIX + Windows，含误报对照）
node scripts/check-compat.mjs     # 对本机 dsh 安装做契约自检
```

实现结构：`lib/scanner.js`（纯词法扫描 + 读写口径 `toolAccessKind`，可独立测试）、`lib/ask.js`（三键会合点与回退链）、`lib/approval-compat.js`（官方审批瀑布封装）、`lib/session-state.js`（会话档位三态与审计记录）、`lib/remote-service.js`（client→host 管理 RPC）、`lib/index.js`（门禁装配）、`lib/client.js`（设置页、composer 会话档位选择框、会话页「白名单目录」视图、会话标题栏待审批徽章与 toast 提示，UI 组件用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`/`Input`/`Button`/`Toast`，与官方权限选择器同款）。

## 升级说明（会话级放飞 → 会话档位）

- 旧版的会话级「放飞」开关升级为三档档位：放飞中的旧会话读旧记录自动映射为**完全放开**，未放飞的映射为**仅工作区内**；
- `alwaysScope` 配置项已移除：询问卡片「总是允许该目录」现在固定写**会话级**条目（在会话页「白名单目录」管理），要全局放行请在 设置 → Workspace Only 手动添加；profile 的 `cordis.patch.yml` 若显式写过 `alwaysScope`，升级后删掉该行即可；
- 「总是允许该目录」新写的会话级条目只对同工作区根的会话生效；旧的全局字符串条目保持处处生效；
- 管理 RPC 有变更（若你有脚本直调 `workspaceOnly/*`）：`setBypass(sessionId, enabled)` → `setScope(sessionId, scope)`（`scope` ∈ `workspace` / `outside-read` / `outside-write`），新增 `addGlobalAlways(dir)`，`snapshot` 的 `sessions[]` 由 `bypass: boolean` 改为 `scope: string`。

设计与 DSH 运行时契约详见 [`docs/increment-plan.md`](docs/increment-plan.md)（含实现中发现的契约出入记录）。
