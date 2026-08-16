# dsh-workspace-only-plugin

DeepSeek Harness (dsh) 插件:为 dsh 增加 "Workspace Only" 开关。

## 功能

- 开关开启后,**任何模式**(read-only / workspace-write / danger-full-access / auto)无差别对待:代理访问工作目录以外的文件,一律**弹窗请求用户确认**:
  - 弹窗直接派发在 `approval/request` 通道上,**绕过审批策略闸门**——即使会话是 Full access(审批 = never)也会弹出,不会静默拒绝;
  - 用户批准 → 放行这一次调用(按会话自身模式执行);用户拒绝 / 无应答渠道 → 拒绝;
  - 越出工作区的 `read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh` 调用都会触发;
  - 内嵌路径(`node -e` / `python -c` 字符串里的绝对路径)也会被词法扫描捕获并触发弹窗;
  - auto 模式插件(`@nanmicoder/dsh-auto-mode`)照常运行但被收编:其分类器仍裁决工作区内调用,越界调用先走本插件的用户确认。
- 权限预设 `workspace-write` 显示名**永久**改为 "Write Only"(与开关状态无关)。
- 开关为全局设置(持久化到 settings.yaml),所有会话立即生效;设置页与输入栏各有一个开关。

## 安装

**一行安装(推荐):**

```sh
curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-workspace-only-plugin/main/install.sh | bash
```

脚本自动:装进 profile 的 bundle 层栈(`dsh plugin add`,首次使用自动初始化 profile)→ 打两个必需的核心补丁 → 检测到运行中的 dsh web 则以原命令行重启(会话持久化,重启后恢复)。可调环境变量:`DSH_PROFILE`(默认 web)、`DSH_HOME`、`DSH_NO_RESTART=1`(跳过重启)。

**手动安装:**

1. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加:
   `"dsh-workspace-only-plugin": "github:CsBpRd/dsh-workspace-only-plugin"`
2. 在 `dsh.profile.bundles` 末尾追加 `"dsh-workspace-only-plugin"`。
3. `cd ~/.dsh/profiles/web && pnpm install`。
4. 重启 dsh web 服务。

## 与 auto 插件共存

本插件把 `workspace-write` 预设改名 "Write Only" 后,auto 插件的客户端按标签匹配权限菜单,需同步把
`@nanmicoder/dsh-auto-mode` 的 `lib/client.js` 中 `REQUIRED_PERMISSION_LABELS` 的
`"Workspace Write"` 改为 `"Write Only"`(auto 升级后需重打)。

## 核心补丁(升级 dsh 后需 `node scripts/patch-core.mjs` 重打)

1. `@deepseek-ai/dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` 白名单加入
   `"workspace-only"`——该白名单决定 Web 客户端可读写的设置命名空间,插件自身无法注册暴露;
2. 上述 auto 插件标签补丁。

两处都幂等,脚本自动跳过已打过的文件。

## 安装(续)

5. `cd /Volumes/CBR DATA/项目/dsh-workspace-only-plugin && node scripts/patch-core.mjs`(打核心补丁)。

## 边界

- 收编是工具层闸门(词法路径扫描),非内核级隔离;扫描器无法静态看到的路径(完全动态计算)是残余面,与 auto-mode 插件同级哲学。
- 在 Write Only(workspace-write)会话,批准后的越界**写**仍受内核围栏拦截,此时按 dsh 既有 escalation 流程(`sandbox_permissions`)再确认一次后放行——写操作始终需要用户明确同意。
- 技能加载、会话持久化等 dsh 内部机制不受影响。
