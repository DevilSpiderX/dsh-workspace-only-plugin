# dsh-workspace-only-plugin

DeepSeek Harness (dsh) 插件:为 dsh 增加 "Workspace Only" 开关。

## 功能

- 开关开启后,**任何模式**(read-only / workspace-write / danger-full-access / auto)下,代理的文件访问都限制在当前会话工作目录:
  - `sandboxPolicy.resolve` 被包装,比 `workspace-write` 更宽的模式一律降级(只降不升,read-only 保持只读),内核写边界为工作区;
  - 越出工作区的 `read`/`write`/`edit`/`read_image`/`glob`/`grep`/`bash`/`pwsh` 调用在 execute 前**请求用户确认**(approval 弹窗),不硬拒:用户批准则放行,拒绝才拒绝;
  - 批准后的越界写,在 Write Only 模式内核围栏仍会拦截,此时按 dsh 既有 escalation 流程(`sandbox_permissions`)再确认一次后放行——写操作始终需要用户明确同意;
  - auto 模式插件(`@nanmicoder/dsh-auto-mode`)照常运行但被收编:其分类器仍裁决工作区内调用,越界调用先走本插件的用户确认。
- 权限预设 `workspace-write` 显示名**永久**改为 "Write Only"(与开关状态无关)。
- 开关为全局设置(持久化到 settings.yaml),所有会话立即生效;设置页与输入栏各有一个开关。

## 安装

1. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加:
   `"dsh-workspace-only-plugin": "file:/Volumes/CBR DATA/项目/dsh-workspace-only-plugin"`
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

- 守卫是工具层启发式(词法路径检查),非内核级读取限制;写操作另有内核围栏。
- 内核 `/tmp` 仍可写(工具链需要),工具层拦截 `/tmp` 写入。
- 技能加载、会话持久化等 dsh 内部机制不受影响。
