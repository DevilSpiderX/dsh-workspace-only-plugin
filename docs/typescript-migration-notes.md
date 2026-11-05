# TypeScript 迁移记录（T28，2026-11-05）

全项目 TS/TSX 化的计划外现场修正与关键决策，供回溯。计划与验收结论见提交信息；本文只记**做计划时不知道、现场才定下来的**东西。

## 范围与形态

- `src/host/*.js`（7）→ `.ts`、`src/client` 5 个 `.js` + 6 个 `.jsx` → `.ts`/`.tsx`、`scripts/*.mjs`（3）→ `.ts`、两个 `vite.*.config.mjs` → `.ts`；`*.module.css` 不动。全部经 `git mv` 保留历史。
- `tsconfig.json`：`strict` + `isolatedModules` + `verbatimModuleSyntax` + `noEmit` + `allowImportingTsExtensions`，`jsx: "react-jsx"`，`types: ["node"]`。
- `pnpm build` = `tsc --noEmit && vite build -c vite.host.config.ts && vite build -c vite.client.config.ts`；`pnpm typecheck` 单独可用。
- `scripts/*.ts` 靠 Node type stripping 直跑（engines `^22.19.0 || >=24.0.0` 内置），**只用可擦除语法**（禁 enum/namespace/参数属性）；相对 import 显式 `.ts`/`.tsx` 扩展名，Rollup 产物里自动重写为 `.js`（已验证）。

## 现场修正（计划没写、踩了才定）

1. **`verify-remote-service.ts` 的形参名提取会死在类型注解上**：`parameterNames` 的正则按逗号切形参段，TS 源文本里是 `sessionId: string` 而不是 `sessionId`。修法不是改正则，而是 `node:module` 的 `stripTypeScriptTypes()` 先把源文本剥成运行时形态再提取——与 Gateway source-mode 对 `Function.prototype.toString()` 的提取路径同构，语义零漂移。
2. **`scopeTarget(ctx, agent)` 的返回品牌与 `ctx.waterfall` 的 thisArg 品牌在 dsh 类型里不互通**（`Scoped<Context>` vs `Scoped<Agent>`）。运行时就是 agent 作用域的路由 receiver，`approval-compat.ts` 里一处 `as unknown as Scoped<Agent>` 收窄 + 注释，运行行为零改动。
3. **`Promise.resolve("unavailable")` 推断成 `Promise<string>`**：waterfall 的 `next` 回调要补上下文类型 `(): Promise<ApprovalOutcome> => ...`。
4. **schemastery 的 `.volatile()` 不在输出类型里**（运行时读到的是 `.get()` 引用）：`apply(ctx, config)` 的字段一律 `unknown`（`PluginConfigInput`）+ `readVolatile` 解引用，这是诚实形状，别"顺手"改成 z.infer。
5. **`settings/describe` 等 wire 响应按 unknown 诚实标注**，归一 `as` 集中在 `settings-store.ts` 的 unwrap 出口（`RecentAskView`/`SessionScopeView` 是展示层形状）；`ctx.remote` 传给 controller 的是整个 remote 对象（用 `.settings` 子面），接口是 `RemoteWithSettings`。
6. **`pending-notice.tsx` 的 `visible[0]` 用非空断言**（`visible.length === 0` 已在上方返回 null，防御性 null 比较在 strict 下是 TS2367 无重叠比较）；同型的 `session.scope !== void 0` 恒真比较在 `WorkspaceOnlySection.tsx` 里删除（`scope: string`）。
7. **`index.tsx` 的 `ask.requestId` 提为局部 `requestId` 常量**：`raisePanel` 的多个闭包（cleanup/settle/自毁计时）要访问它，属性窄化在闭包里会丢。产物等价（压缩后同形）。
8. **`remote-service.ts` 的 `if (Service === void 0)` 是 TS 恒假比较**（TS2367）→ 改 `if (!Service)`，防御语义不变（缺基类 composition 的降级路径）。
9. **类型补丁面**（均为字面复刻的最小声明，契约漂移时同步）：
   - `src/host/dsh-augment.d.ts`：cordis `Events` 的 `settings/document-updated`、`tools/pre-execute` 与 `Context` 的 `systemPrompt`/`permissionPresets`（声明住在未钉进 devDeps 的 dsh 包里）；
   - `src/host/session-state.ts`：官方 `PluginRecordMap` augmentation（四种审计载荷的精确形状，`appendPluginRecord` 写入编译期校验）；
   - `src/client/css-modules.d.ts`：`*.module.css` 默认导出。
10. **`check-compat.ts` 失败提示的版本表述**顺带更新为 `0.2.1-rc.5`。

## 产物形态

`lib/` 文件名面不变（host 7 + `client.js`）；相对导入重写为 `.js`；banner/intro/footer、require 白名单、CSS 内联、`exports.apply/inject` 形态全部保持。压缩产物与迁移前逐字节不同（几处等价窄化写法），语义由 verify-scanner 169/169、verify-remote-service 35/35、check-compat 14/14 看守背书。

## 遗留

- `tmp/smoke/run.mjs` 不在工作区（按惯例跳过）；smoke 若回归，其 `src/host/**` import 路径与 bundle 断言需按 `.ts` 路径与压缩形态一并适配（见 AGENTS.md 的 smoke 条目）。
- `docs/` 里的历史任务书（increment-plan/optimization-plan 等）保留 `.js`/`.mjs` 的当时写法，不回溯修改。
