# 构建迁移交付说明（对照 `dsh-workspace-only-plugin-vite-pnpm-migration-plan.md`）

执行结果：迁移完成，单 commit 待用户执行（message 在 `tmp/commit-msg.txt`）。
基线 `32196d4`（其后仅计划书提交 `26d2091`），无代码漂移。

## 验收清单执行情况（计划书 §7）

| # | 项 | 结果 |
|---|---|---|
| 1 | `pnpm install && pnpm build`，`lib/` 恰 7 文件 | ✅ 7 个 `.js`，prepack 链路亦验证（`pnpm pack --dry-run` 会跑 `prepack`） |
| 2 | `lib/client.js` 外壳/require/exports | ✅ banner、intro（含 `Symbol.toStringTag` 行）、footer 逐字；`require()` 恰 3 个且全双引号；`exports.apply`/`exports.inject` 在 |
| 3 | `verify-scanner.mjs` | ✅ 140/140 |
| 4 | `check-compat.mjs` | ⚠️ 12/13，探测 13 为 dsh 侧环境漂移（见下），非迁移回归 |
| 5 | `tmp/smoke/run.mjs` | ✅ 53/53 |
| 6 | GUI 六面手动点验 | ⏳ 留给用户（重装插件后点验） |
| 7 | `git status` 同 commit / `pnpm pack --dry-run` | ✅ tarball 含 `lib/` 全 7 文件 + `scripts/`；`git add -A` 后单 commit 即可 |

`node --check` 7 个产物全过；`package.json` 的 `exports`/`main`/`files`/`dsh`/`icon`/`engines` 零变化；
无 `dependencies`/`peerDependencies`/`prepare`/install scripts，只加 `prepack: "pnpm build"`。

## 与计划书的差异（§8 授权的现场修正）

1. **`vite.host.config.mjs` 加 `build.ssr: true`（§5.2 未列）**：Vite 默认按浏览器环境构建，
   define 管线会把 `process.env` 整体替换成空对象（`var define_process_env_default = {}`），
   直接破坏 scanner 的 home 解析（`env.HOME`/`env.USERPROFILE`）与 `WORKSPACE_ONLY_PRESENCE_WAIT_MS`。
   node target 下 `process.env` 保持原样（产物实测 3+1 处引用完好）。这是**功能等价**的关键，
   不是格式问题。同理保留 `minify: false`/`target: "esnext"`。
2. **`vite.host.config.mjs` 加 `preserveEntrySignatures: "exports-only"`**：Vite 7 lib 模式默认
   `false`，与 `preserveModules` 组合被 Rollup 直接拒绝（构建报错），属配置必选项。
3. **`vite.client.config.mjs` 加 `output.esModule: false`，并让 `normalize-require-quotes` 顺带删除
   Rollup 4 附加的 `Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })`**：
   `esModule: false` 并不能抑制该标记行；外壳的 toStringTag 行由 `intro` 提供（逐字契约），重复行删除后
   外壳与 §2.3 完全一致。require 引号归一化照 §5.3 保留。
4. **`src/client/shared.js` 的 `scopeGlyph` 用 `jsx()` 调用而非 `<Icon />` 语法**：§4 清单规定
   `shared.js` 保持 `.js`（且依赖方向明写 `shared → (react/jsx-runtime, ui-primitives)`），而 `.js`
   不走 JSX 转换；`jsx(PermissionIconXxx, {})` 与 `<PermissionIconXxx />` 编译产物等价。四个组件
   `.jsx` 均为真 JSX。若想统一为 JSX 语法，把该文件改名 `shared.jsx` 即可（一行 import 变更）。
5. **新增 `pnpm-workspace.yaml`（`allowBuilds: esbuild: true`）**：pnpm 12 在 `pnpm install` 时生成
   审批占位并以 `ERR_PNPM_IGNORED_BUILDS` 退出 1（esbuild 的 postinstall 被拦），会让任何新 clone 的
   `pnpm install && pnpm build` 断链。该声明等价于无人值守的 `pnpm approve-builds`，非 install script。
6. **`tmp/smoke/run.mjs` 的拷贝源改 `src/host/`**（计划书说改 import；stub 环境靠拷贝解析依赖，改拷贝源
   更小）。bundle 断言（12–15 用例）仍读 `lib/client.js` 产物，跑 smoke 前需 `pnpm build`。

## 环境漂移记录：check-compat 探测 13（T13 notice surface）

- 现象：`package missing — the shared Toast primitive is gone`。探测 13 的四个锚点里，
  `conversation.session.header.actions`、`shell.overlay`、`uiWorkspace.openSession` 三项在官方包文本中命中，
  只有 `@deepseek-ai/dsh-client-ui-primitives` 的包定位失败（`locate()` 找
  `dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/client.js`）。
- 证据：app.asar 内 `dsh/node_modules/@deepseek-ai/` 的包清单中已**没有** `dsh-client-ui-primitives`；
  但官方 `dsh-client-ui-conversation`/`dsh-client-ui-workspace`/`dsh-client-ui-approval` 的 `lib/client.js`
  仍然 `require("@deepseek-ai/dsh-client-ui-primitives")` —— **平台模块表仍以该名提供模块**，运行时
  `require` 不会失败，探测 7（require 白名单）因此通过。
- 定性：dsh 升级后该包不再以独立 npm 包形态出现在安装里（内容并入他处），check-compat 的包定位面过时。
  探测 13 不读本插件产物（只读官方包），**迁移前跑必然同样失败**，与本次重构无关。等 dsh 侧包布局回归
  或 check-compat 更新定位面后重跑即可。

## 功能等价证据

- host：6 个产物 `node --check` 全过；`process.env` 语义保留；smoke 53/53 端到端（stub dsh 包 + 真
  schemastery 校验写回）覆盖门禁/三键/白名单/deny/档位/回退链/T12/T13 语义。
- client：外壳三段式逐字、require 集合恰 3、无 interop helper 残留（`getDefaultExportFromCjs`/
  `__toESM`/`__commonJS` 均为 0）、smoke 的 9 条 bundle 形态断言全过、`node --check` 过。
- 模块图无环：index → {styles, locales, settings-store, snapshot-store, shared, 组件}，settings-store →
  snapshot-store，shared/组件为叶子；组件之间零 import（Rollup 未报循环）。
- 打包器正常格式化（去注释、CRLF→LF、import 重排）按用户指示接受，不作为差异项。
