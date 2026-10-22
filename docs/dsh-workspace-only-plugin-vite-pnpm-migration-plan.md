# dsh-workspace-only-plugin 构建迁移计划书（pnpm + Vite / src 源码 + lib 产物 / React JSX）

> 本文档是**自包含任务书**，面向在另一台计算机上执行迁移的 DSH 会话。所有设计决策已完成、依据已内嵌，执行者不需要做新的架构决策，也不需要访问 DSH 源码（如需复核，证据出处以 `packages/...` 相对 DSH 仓库根的形式给出）。
>
> 执行前先读目标仓库自己的 `AGENTS.md`（其中的契约与提交约定继续有效），再按本文「实施步骤」推进。**迁移是纯工程化重构：运行时行为、对外契约零变化**，任何"顺手改进"都不在本任务范围内。

**基线状态**：本文依据仓库提交 `32196d4`（`docs: 更新安装地址为新仓库地址`，其前为 T13 notice 修复 `260c11b`）撰写；用户安装入口已是 `github:devilspiderx/dsh-workspace-only-plugin#main`。执行时若现场仓库存在更新提交，一律按「逐行平移现状代码」原则处理（§6 红线 7），并在交付说明中列出与本文的差异。

---

## 1. 任务与成功标准

**目标**：把 `dsh-workspace-only-plugin`（DeepSeek Harness 的 Workspace Only 门禁插件）从"无构建、手写浏览器 bundle"迁移为 **pnpm + Vite 构建**：

1. 构建工具：pnpm（包管理）+ Vite（构建）；
2. 渲染部分（Web 端 UI）改为 **React JSX** 源码；
3. **源码放 `src/`，编译产物放 `lib/`**（`package.json` 的 `exports`/`main`/`files` 仍指向 `lib/`，DSH 宿主契约零变化）。

**成功标准**（全部满足即完成）：

1. `pnpm install && pnpm build` 后 `lib/` 出现 7 个文件：`index.js`、`scanner.js`、`ask.js`、`approval-compat.js`、`session-state.js`、`remote-service.js`、`client.js`（与迁移前同名）。
2. `lib/client.js` 仍是 `window.__ModuleLoader__` 单文件 bundle：外壳与官方配方同构（见 §3.1），`require()` 恰为 3 个平台模块，导出 `apply`/`inject`；`package.json` 的 `exports`/`files`/`dsh` 字段零变化。
3. 渲染层为 JSX 源码（`src/client/**`），逻辑零改动（纯语法迁移，逐行平移非渲染部分）。
4. `node scripts/verify-scanner.mjs`、`node scripts/check-compat.mjs`（需本机 dsh）、`node tmp/smoke/run.mjs`（若存在）全绿；模块图无循环依赖。
5. 源码只在 `src/`；`lib/` 仅由构建生成，且随 git 提交分发（原因见 §3.5）。

---

## 2. 项目现状与契约速览

### 2.1 项目是什么

一个 DSH（DeepSeek Harness）0.2.x 插件：把任意沙箱模式下的文件访问限制在会话工作区内，带三键审批卡片、always 白名单、per-session 档位。纯 ESM JavaScript，Node `^22.19.0 || >=24`。**迁移前无构建、无测试框架、无 lint/format/typecheck**；自检体系是三个脚本（词法扫描用例、DSH 契约自检、端到端 smoke）。

### 2.2 当前目录（迁移前）

```
lib/index.js            # cordis 插件入口（export name/inject/Config/apply）
lib/scanner.js          # 纯词法路径扫描 + 读写口径（toolAccessKind），零依赖
lib/ask.js              # 三键会合点、presence 握手、回退链
lib/approval-compat.js  # 官方 approval/request 瀑布封装（回退通道）
lib/session-state.js    # 会话档位三态与审计记录
lib/remote-service.js   # client→host 管理 RPC（workspaceOnly/*）
lib/client.js           # Web 端 UI，手写浏览器 bundle（约 1200+ 行，以现场为准）
scripts/verify-scanner.mjs   # 词法扫描用例，import "../lib/scanner.js"
scripts/check-compat.mjs     # 对本机 dsh 契约自检，读 "../lib/client.js" 产物
cordis.patch.yml  package.json  locale/  icon.svg  README.md  AGENTS.md
tmp/                  # gitignored（smoke、commit-msg.txt）
```

### 2.3 `lib/client.js` 的现状形态（迁移的核心对象）

- 整文件手工编辑，但内部按 `//#region lib/types/client/*.js` 标记分块，**这些源文件并不存在**——region 名就是天然的拆分粒度：
  `styles.js`、`locales.js`、`settings-store.js`、`shared.js`、`WorkspaceOnlySection.js`、`WorkspaceOnlyScopeSelect.js`、`WorkspaceOnlyWhitelistView.js`、`WorkspaceOnlyAskCard.js`、`pending-notice.js`、`index.js`，另有无 region 的包装段（含 `createSnapshotStore`）。（行号区间随仓库演化会漂移，拆分以现场文件的 region 标记为准，不要按任何快照行号硬切。）
- ⚠️ **T13 notice 面（待审批徽章/toast/跳转）在迁移前不久刚经历契约修复**（提交 `260c11b`「fix: repair T13 notice surface after GUI acceptance test」，GUI 验收发现的四个缺陷）：
  1. 徽章槽位是 `conversation.session.header.actions`（**不是** `header.utilities`），注册 order 11、紧随官方子代理目录下拉（`subagent-catalog`，order 10）——旧槽位 `header.utilities` 渲染在标题栏最右，不是「下拉旁」；
  2. 跳子代理必须传 `SubagentAddress`（`{parentSessionId, childSessionId, mode}`，从 `useSessions` 快照 `byId[childId].subagent.address` 取），裸 SessionId 会被当普通会话打开并报 `subagent/not-found`；
  3. 徽章只在 parked ask 的**父会话**显示（过滤 `byId[entry.sessionId].subagent.address.parentSessionId === 当前视图 id`）——旧的「排除自己」宽过滤会把所有无关会话都点亮计数；
  4. notice 条目清理必须在**结算同步路径**：`settle`/`dismiss` 里直接调**幂等的 `cleanup()`**（清 `pendingStore` + 撤席位），`completion.promise.then` 只留幂等兜底重跑——只在微任务里清会导致全部卡片批完后徽章仍残留计数。

  **拆分 `pending-notice.jsx`/`index.jsx` 时以现场代码为准，禁止按旧形态回退**。另：toast 节奏（每个 ask 一条 one-shot banner、FIFO 逐条展示）是**设计行为**不是缺陷，逐行保持、别"顺手优化"。
- 外壳契约（**逐字保持**）：

```js
window.__ModuleLoader__.load({
	id: "dsh-workspace-only-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// ...bundle body...
		return module.exports;
	}
});
```

- `require()` 白名单恰好 3 个，全部是平台冻结模块表成员：`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`。**白名单受 `check-compat.mjs` 探测 7 看守**，其正则 `require\("([^"]+)"\)` **只匹配双引号**形式。
- 渲染代码已是 `react_jsx_runtime.jsx/jsxs(...)` 调用形态（等价于 JSX 编译产物），可机械反写为 JSX。
- 导出：`exports.apply`、`exports.inject`（`inject` 是 8 个注入名的数组，`apply(ctx)` 装配 6 个 UI 挂载面 + 门禁逻辑）。

### 2.4 自检体系与既有纪律（执行时必须继续满足）

- 改扫描行为 → 必跑 `node scripts/verify-scanner.mjs`（POSIX+Windows 用例，不依赖本机 dsh）。
- 改任何 DSH 契约耦合面（审批词汇、pre-execute、插件记录、问答通道、client `require()`）→ 必跑 `node scripts/check-compat.mjs`（无 dsh 安装时 exit 1 属环境问题）。
- `tmp/smoke/run.mjs` 端到端 smoke（stub dsh 包 + 真 schemastery 校验），`tmp/` 不入库、缺失则跳过。
- 提交约定：commit message 写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`（PowerShell 下 `-m` 会毁掉引号）；英文 `feat:`/`fix:`/`docs:` 前缀；README/docs 写中文、代码注释写英文。
- 不声明 `dependencies`/`peerDependencies` 是有意的（DSH 内部包以 prerelease 演进，semver 范围会误报不兼容），迁移不得添加。

---

## 3. 决策依据（已对照 DSH 源码验证，结论内嵌）

以下结论来自对 DSH 仓库（`packages/...` 路径为 DSH monorepo 内相对路径）的源码核查。执行者**不需要**重新验证；列出是为了让红线有据可依。

### 3.1 官方 bundle 外壳就是构建器三段式生成的（配方照抄）

`packages/client/tsdown.client.ts`（DSH 官方客户端打包脚本，约 649-670 行）用 Rollup 系构建器的 `banner`/`intro`/`footer` 生成 `__ModuleLoader__` 外壳：

```
banner: window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {
intro:  var module = { exports: {} }; var exports = module.exports;
footer: return module.exports; } });
```

与本插件现有 `lib/client.js` 外壳逐字同构（我们额外多一行 `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`，放进 `intro` 保持即可）。**Vite 的 `output.banner/intro/footer` 直接复刻官方配方**，不需要自研包裹器。

### 3.2 官方认可"编译型插件源码"，官方包本身就是 src→lib 形态

- `packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md`："For compiled sources, use the deployment's Client build tooling to emit this format; declare non-baseline runtime imports in `dsh.client.external`."
- 同技能 `SKILL.md`："installed packages ship built `lib/index.js` and `lib/types/**/*.d.ts` ... not `src/`"。

即：**产物进 `lib/`、源码在 `src/` 正是 DSH 生态的标准形态**。

### 3.3 require 白名单全部是 baseline，manifest 无需变化

`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES`（浏览器冻结模块表）包含：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。

本插件 require 的 3 个模块全在其中 → `dsh.client.external` **不声明**（声明反而引入多余图边）。`dsh.client` 的校验（`packages/client/modules/src/client/manifest.ts`）只要求 `platform` 为 string，`inject`/`external`/`immediately` 可选——现有 `"platform": "web", "inject": []` 保持不动。`exports["./client"]` 允许"string 或带 string default 的一层 conditional"，现有 `{ "default": "./lib/client.js" }` 合法。

### 3.4 factory 契约：`factory(require) → exports`，且 CJS 形态循环依赖致命

`packages/client/modules/src/client/system.ts`：`const exports = registered.factory(this.makeRequire(ownerId, edges))`——**factory 的返回值就是模块 exports**，`return module.exports` 是官方同款收尾。同一文件明确："factory-form CJS cannot deliver partial exports, so a cycle is fatal"（循环依赖会直接抛错）→ **src 拆分必须保持 import 图无环**。

### 3.5 安装链路证明：构建产物必须入库 git，且禁放 `prepare`

`packages/boot/plugin-manager`（安装器）的行为：

- 安装走 `runProfilePnpm`（即 pnpm add）；本地目录安装生成 `link:<dir>` **链接整个 checkout**（`references/host-plugin.md`："Local directory installation links the checkout instead ... `files` does not filter a linked directory"）；`github:` git 源安装**直接取仓库内容**（无 `prepare` 就不构建）。
- 若放 `prepare` 试图"安装时构建"：git 安装会拉取 devDependencies 并执行构建，且撞 pnpm 10 的 `ERR_PNPM_IGNORED_BUILDS` 审批门槛（安装器有 `approvedBuilds`/`pendingBuilds` 审批流程，`packages/boot/plugin-manager/src/build-approval.ts`）——安装变慢、变复杂、要用户批脚本。
- `prepack` 只在本地 `npm pack`/`pnpm pack`/publish 时触发，git/link 安装不跑，安全。

**结论**：`lib/` 产物**提交进 git**（clone 即装即用）；`package.json` 只加 `prepack: "pnpm build"`，**绝不加 `prepare`/`preinstall`/`install`/`postinstall`**。

本插件的用户安装入口就是 git 源安装：web GUI 或 `dsh plugin --profile <p> add "github:devilspiderx/dsh-workspace-only-plugin#main"`（README 安装节；仓库地址于提交 `32196d4` 由 `CsBpRd/...` 迁至现址）。产物入库后用户从该地址重装/升级即得构建产物——迁移**不得改变这一分发路径**，README 安装节保持现状。

### 3.6 require 引号必须是双引号（check-compat 探测 7）

`scripts/check-compat.mjs` 探测 7 用正则 `require\("([^"]+)"\)` 扫描 `lib/client.js`（只认**双引号**）提取我们的 `require()` 集合，再与官方包 bundle 的 require 基线比对。官方构建器（tsdown/rolldown）产物正是双引号（该探测能提取到基线为证），而 Rollup 对 CJS external 可能输出 `require('x')` 单引号——**构建后必须检测并归一化**（§5.3）。

---

## 4. 目标布局

```
<repo>/
  src/
    host/                      # Node/cordis 侧（现 lib/*.js 平移，内容逐字保留）
      index.js  scanner.js  ask.js  approval-compat.js  session-state.js  remote-service.js
    client/                    # Web 端 UI（现 client.js 按 //#region 拆分改写 JSX）
      index.jsx                #   apply/inject 装配（region index.js）
      snapshot-store.js        #   createSnapshotStore（无 region 包装段）
      styles.js                #   PLUGIN_ID/CSS/installStyles
      locales.js               #   zh/en 文案对象（纯数据，保持 .js）
      settings-store.js        #   WorkspaceOnlySettingsController（逻辑类，保持 .js）
      shared.js                #   SCOPE_OPTIONS/scopeGlyph/globalEntries/scopedEntries
      WorkspaceOnlySection.jsx
      WorkspaceOnlyScopeSelect.jsx
      WorkspaceOnlyWhitelistView.jsx
      WorkspaceOnlyAskCard.jsx
      pending-notice.jsx       #   WorkspaceOnlyPendingBadge + WorkspaceOnlyToast
  lib/                         # 构建产物（入库 git；同名 7 文件）
  vite.host.config.mjs
  vite.client.config.mjs
  package.json  pnpm-lock.yaml  cordis.patch.yml  locale/  icon.svg  scripts/  README.md  AGENTS.md
```

**依赖方向（单向，无环——§3.4 硬约束）**：
`index.jsx → {styles, locales, settings-store, snapshot-store, shared, 各组件}`；`settings-store → snapshot-store`；`shared → (react/jsx-runtime, ui-primitives)`；组件 → `shared`/`locales` + `react` + `ui-primitives`。禁止组件之间互相 import、禁止 shared/settings-store 回引组件。

---

## 5. 实施步骤

> 执行环境：Windows + PowerShell。项目根记作 `<repo>`，以实际 clone 路径为准。

### 5.1 pnpm + Vite 骨架

`package.json` 变更（其余字段一律不动）：

```jsonc
{
  // 新增：
  "packageManager": "pnpm@<本机 pnpm -v 的版本>",
  "devDependencies": {
    "vite": "^7",
    "react": "^19"          // 仅供 IDE/JSX 解析；运行时 React 来自平台模块表，构建时 external，绝不打进产物
  },
  "scripts": {
    // 保留 verify-scanner / check-compat，新增：
    "build": "vite build -c vite.host.config.mjs && vite build -c vite.client.config.mjs",
    "prepack": "pnpm build"
    // 禁止出现 prepare / preinstall / install / postinstall（§3.5）
  }
}
```

- 运行 `pnpm install` 生成 `pnpm-lock.yaml`，**入库**。
- `.gitignore` 现有 `node_modules/`、`*.log`、`.idea`、`tmp/` 保持；**不加 `lib/`**。
- `package.json` 的 `main`/`exports`/`files`/`dsh`/`engines`/`icon` 零变化（`files` 继续含 `lib` 与 `scripts`）。

### 5.2 `vite.host.config.mjs`（宿主侧，恒等直出）

```js
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { target: "esnext" }, // 零降级、零 helper 注入
  build: {
    outDir: "lib",
    emptyOutDir: true,           // host 先构建，清空 lib 后 client 再写入
    minify: false,
    target: "esnext",
    rollupOptions: {
      input: "src/host/index.js",
      external: [/^node:/, /^@deepseek-ai\//], // 运行时依赖全部来自 dsh 宿主，绝不打包
      output: {
        format: "es",
        preserveModules: true,               // 每个源文件直出一个产物文件
        preserveModulesRoot: "src/host",     // src/host/index.js → lib/index.js（平铺同名）
        entryFileNames: "[name].js",
      },
    },
  },
});
```

预期产物：`lib/index.js`、`lib/scanner.js`、`lib/ask.js`、`lib/approval-compat.js`、`lib/session-state.js`、`lib/remote-service.js`（内容≈源码，import 路径不变）。

### 5.3 `vite.client.config.mjs`（client bundle，官方配方外壳）

```js
import { defineConfig } from "vite";

// §3.6：Rollup 对 CJS external 可能输出单引号 require('x')，
// 而 check-compat 探测 7 的正则只认双引号 —— 构建时归一化。
const normalizeRequireQuotes = {
  name: "normalize-require-quotes",
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") {
        output.code = output.code.replace(/require\('([^']+)'\)/g, 'require("$1")');
      }
    }
  },
};

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react", target: "esnext" },
  plugins: [normalizeRequireQuotes],
  build: {
    outDir: "lib",
    emptyOutDir: false,          // 不清空 host 产物
    minify: false,
    target: "esnext",
    lib: {
      entry: "src/client/index.jsx",
      formats: ["cjs"],          // 产物主体即 require(...)/exports.xxx = ...，天然匹配 factory 签名
      fileName: () => "client.js", // type:"module" 包默认会出 .cjs，显式锁 .js
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"],
      output: {
        inlineDynamicImports: true, // 单文件单 chunk（官方多 chunk/require.async 形态用不到）
        // §3.1 官方配方三段式（id = 包名）：
        banner: 'window.__ModuleLoader__.load({ id: "dsh-workspace-only-plugin", factory: (require) => {',
        intro: 'var module = { exports: {} }; var exports = module.exports;\n'
          + 'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
        footer: 'return module.exports; } });',
      },
    },
  },
});
```

构建顺序：host 先（清 `lib/`）、client 后（追加）——由 `build` script 的 `&&` 顺序保证。

### 5.4 宿主侧平移（零改动）

1. `git mv lib/index.js lib/scanner.js lib/ask.js lib/approval-compat.js lib/session-state.js lib/remote-service.js src/host/`；
2. 内容一个字不改（相对 import `./ask.js` 等自然保持）；
3. `pnpm build` 后 `node --check lib\*.js` 逐个语法校验。

### 5.5 client JSX 改写（仅渲染语法迁移）

按 §2.3 的 region 清单拆出 §4 的 11 个文件。**规则**：

| 现形态（jsxs 调用树） | JSX 目标 |
|---|---|
| `(0, react_jsx_runtime.jsx)("div", { ...props, children: X })` | `<div {...}>X</div>` |
| `jsxs(tag, { children: [a, b, c] })` | 多子节点 JSX（必要时 `<>...</>`） |
| `"data-x": true` | 裸属性 `<div data-x>`（React 渲染行为与 `{true}` 一致） |
| `"data-open": String(open)`、`"aria-busy": answered` | `data-open={String(open)}`、`aria-busy={answered}` |
| `children` 键 | JSX 子节点；数组元素上的 `key` 改 JSX `key` 属性 |
| `(0, react.useState)(...)` 等 | `import { useState, useEffect, useRef } from "react"` |
| `(0, react_jsx_runtime.jsx)(ui_primitives.Menu, {...})` | `import { Menu, Input, Button, Toast, IconChevronDownOutlineRegular, PermissionIcon* } from "@deepseek-ai/dsh-client-ui-primitives"`，用 `<Menu ... />` |
| `scopeGlyph` 里 `jsx(ui_primitives.PermissionIconXxx, {})` | `<PermissionIconXxx />` |

**硬性要求**：

- 事件处理、hooks、`WorkspaceOnlySettingsController`、`createSnapshotStore`、`raisePanel`/`closePanel`/`seats`/presence 握手/toast 队列等**逐行原样平移**，只动渲染层语法；不重构、不改名、不"顺手优化"。
- CSS 字符串（`styles.js`）、locale 对象（`locales.js`）、`installStyles` 的 `<style data-plugin>` 挂载方式不动。
- 注释全部保留（英文注释是仓库约定）。
- 每个组件的 props 形状（`inject` 注入的 `load`/`select`/`addEntry`/`useWorkspaceOnly`/`t` 等）保持原样——它们与宿主 slots 装配耦合。
- T13 notice 面（`raisePanel`/`closePanel`/`openPending`/`settle`/`dismiss`、`pendingStore`/`toastStore`）**逐行平移现状**：包括 `conversation.session.header.actions` 槽位注册（order 11）、徽章的父会话过滤、`SubagentAddress` 构造与跳转、幂等 `cleanup()` 在 `settle`/`dismiss` 同步路径里清 `pendingStore`（`completion.promise.then` 只留兜底）——这些是刚修复的新契约（§2.3 ⚠️ 四缺陷），任何"简化"或按旧版本的写法都是回归。
- `src/client/index.jsx` 保留 `export { apply, inject }`（CJS 产物生成 `exports.apply = ...`，与现状导出面一致）。

### 5.6 自检脚本适配

- `scripts/verify-scanner.mjs`：`import ... from "../lib/scanner.js"` → `"../src/host/scanner.js"`；头注释里 `lib/scanner.js` 同步改。自检**直测源码**，clone 即跑、不依赖构建。
- `scripts/check-compat.mjs`：**迁移不改动它**。它看守的就是发布产物 `lib/client.js`（require 白名单、T13 契约），构建后照跑。注意：探测 13 的看守面已在 `260c11b` 中随新席位更新——它校验官方包里的 `conversation.session.header.actions`、`shell.overlay`、`uiWorkspace.openSession`、共享 `Toast` 四个耦合面，正是本插件 T13 新契约的锚点；迁移后探测 13 通过即证明 bundle 里引用的槽位/原语与官方契约一致。
- `tmp/smoke/run.mjs`（gitignored，若存在）：对 `lib/*` 的 import 改 `src/host/*`。

### 5.7 文档同步（中文文档/英文注释约定不变）

- `AGENTS.md`：
  - 命令节加 `pnpm install`、`pnpm build`；删掉"无构建、无 build 脚本，别发明"的表述（被本任务取代），改为"构建产物在 `lib/`，改 `src/**` 后必须 `pnpm build` 并与 `lib/` 同 commit"。
  - 结构表：`lib/...` 行改指 `src/host/...`、`src/client/...`，注明 `lib/` = 构建产物（入库）。
  - "lib/client.js 不是由源文件拼出来的：整文件手工编辑"整段改写为："`src/client/*.jsx` 是源码；`lib/client.js` 由 `vite.client.config.mjs` 的 banner/intro/footer（DSH 官方 tsdown 同款配方）生成；`require` 白名单 = external 白名单，两者必须同步；拆分 src 模块不得引入 import 环（factory-form CJS 循环致命）"。
  - "改 lib/scanner.js 必跑 verify-scanner"→ `src/host/scanner.js`。
- `README.md`：「实现结构」段落（搜索该四字定位，行号会因行为矩阵更新漂移）做路径同步（`lib/...` → `src/...`，注明产物在 `lib/`）。安装节（新仓库地址 `github:devilspiderx/dsh-workspace-only-plugin#main`）是刚更新过的现状，**保持不动**。

### 5.8 提交

**单个 commit 完成整个迁移**（`src/` 与 `lib/` 同 commit 的红线要求迁移原子自洽，拆开会出现中间不可用状态）。按仓库约定：message 写入 `tmp/commit-msg.txt` 再 `git commit -F tmp/commit-msg.txt`，英文、`feat:` 前缀，例如：

```
feat: migrate to pnpm+Vite build with src/ sources and JSX client
```

---

## 6. 红线清单（违反任何一条即迁移失败）

1. `lib/client.js` 的 `require()` 集合**恰好** = external 三件套 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`——不得多（模块表白名单拒载）不得少（运行时缺依赖）。
2. `__ModuleLoader__` 外壳逐字保持（§2.3 / §5.3 三段式），`id` 必须是包名 `dsh-workspace-only-plugin`。
3. `package.json` 的 `exports`/`main`/`files`/`dsh`/`icon` 零变化；**不加** `dependencies`/`peerDependencies`/`prepare`/install scripts；只加 `prepack`。
4. `lib/` 构建产物**入库 git**，与 `src/` 同 commit。
5. src 模块拆分**不得引入 import 环**（factory-form CJS 循环依赖是致命错误，不是警告）。
6. client 产物 `require("...")` 必须是**双引号**（check-compat 探测 7 的正则只认双引号）。
7. 迁移零行为变化：逻辑逐行平移，不重构、不改文案、不改 API 形状。T13 notice 面以仓库现状为准（`conversation.session.header.actions`、`SubagentAddress` 跳转、幂等 `cleanup()` 在结算同步路径清 `pendingStore`），禁止回退到旧形态（`header.utilities`、裸 SessionId 跳转、徽章「排除自己」的宽过滤、只在 `then` 里清 store）。
8. `target: "esnext"` + `minify: false`：不注入转译 helper、不打乱产物。

---

## 7. 验收清单（按序执行，全部通过才算完成）

1. `pnpm install && pnpm build` 成功；`lib/` 恰好 7 个 `.js` 文件。
2. `node --check lib\index.js` 等 7 个文件全过；肉眼/搜索确认 `lib/client.js`：
   - 开头 `window.__ModuleLoader__.load({ id: "dsh-workspace-only-plugin", factory: (require) => {`；
   - 结尾 `return module.exports; } });`；
   - `require("...")` 只出现 3 个双引号模块名（可用正则 `require\("([^"]+)"\)` 提取核对）；
   - `exports.apply` / `exports.inject` 在。
3. `node scripts/verify-scanner.mjs` 全绿。
4. `node scripts/check-compat.mjs` 全绿（需本机 dsh；重点看探测 7「client module table requests」与探测 13「notice surface contracts」）。
5. `node tmp/smoke/run.mjs` 全绿（若 `tmp/smoke/` 存在）。
6. 装入 DSH 手动点验六个 UI 面：设置页（开关/全局白名单/deny/最近询问/放宽会话）、composer 会话档位选择框、会话页「白名单目录」视图、ask 三键卡片（Enter=仅此一次 / Esc=拒绝）、会话标题栏待审批徽章（点击应以 `SubagentAddress` 跳到对应子代理会话、徽章只在父会话显示）、toast 提示。
7. `git status` 确认 `src/`、`lib/`、`package.json`、`pnpm-lock.yaml`、两个 vite config、文档全部在同一 commit；`pnpm pack --dry-run` 核对包内含 `lib/` 全部文件与 `scripts/`。

---

## 8. 执行环境与其他注意

- Windows + PowerShell 开发机；Node `^22.19.0 || >=24`（满足 Vite 7 的要求）；先装 pnpm（版本写入 `packageManager`）。
- `node scripts/check-compat.mjs` 在没有 dsh 安装的机器上 exit 1 是环境问题不是代码问题；若执行机没有 dsh，跳过该步并在交付说明注明。
- 仓库根**没有** `node_modules` 是常态（`@deepseek-ai/*` 由 dsh 宿主提供）；迁移后开发依赖（vite/react）装进 `node_modules` 即可，产物不得引用它们以外的任何新运行时依赖。
- 本任务只做构建迁移。`docs/`（gitignored 的本地任务书）、`icon.svg`、`locale/`、`cordis.patch.yml` 内容不动。
- 若执行机的 DSH 侧发现与本文 §3 结论冲突的事实（例如安装器行为变了），以现场源码/实测为准，修正方案后在交付说明中记录差异。

（完）
