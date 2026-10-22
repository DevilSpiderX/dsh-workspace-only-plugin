import {createSnapshotStore} from "./snapshot-store.js";
import {installStyles} from "./styles.js";
import {en, zh} from "./locales.js";
import {WorkspaceOnlySettingsController} from "./settings-store.js";
import {WorkspaceOnlySection} from "./WorkspaceOnlySection.jsx";
import {WorkspaceOnlyScopeSelect} from "./WorkspaceOnlyScopeSelect.jsx";
import {WorkspaceOnlyWhitelistView} from "./WorkspaceOnlyWhitelistView.jsx";
import {WorkspaceOnlyAskCard} from "./WorkspaceOnlyAskCard.jsx";
import {WorkspaceOnlyPendingBadge, WorkspaceOnlyToast} from "./pending-notice.jsx";

const inject = ["connection", "slots", "locale", "remote", "remote.settings", "uiSession", "sessions", "uiWorkspace"];
/** 任务 T16：在 Host 对话框超时之上再加一段宽限，作为卡片自毁兜底。 */
const SELF_DESTRUCT_GRACE_MS = 15_000;

function apply(ctx) {
    installStyles(document);
    const controller = new WorkspaceOnlySettingsController(ctx.remote, ctx.connection);
    const load = () => controller.load();
    const select = (enabled) => controller.select(enabled);
    const injected = () => ({
        hooks: {workspaceOnly: controller.store},
        load,
        select,
        addGlobalAlways: (dir) => controller.addGlobalAlways(dir),
        removeAlways: (entry) => controller.removeAlways(entry),
        addDeny: (entry) => controller.addDeny(entry),
        removeDeny: (entry) => controller.removeDeny(entry),
        clearRecent: () => controller.clearRecent(),
        setScope: (sessionId, scope) => controller.setScope(sessionId, scope)
    });
    ctx.effect(() => ctx.locale.register("settings.workspaceOnly", {
        zh,
        en
    }), "workspace-only: settings dictionaries");
    const t = ctx.locale.bind("settings.workspaceOnly");
    // Workspace Only 的设置放在独立的设置页上（一个 `settings.section` 导航项），
    // 而不是塞进 `settings.general.item` 行——卡片太高，放不进「通用」列。
    // 内容不变；导航标签是 thunk，语言切换时会重新读取。
    ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "workspace-only",
        order: 25,
        locale: "settings.workspaceOnly",
        label: () => t("title"),
        inject: injected
    }, WorkspaceOnlySection));
    // 任务 D（修订版）：会话档位选择器放在 composer 的工具行里，
    // 与平台权限选择器同级（`conversation.input.permission` 紧挨着这个槽位之前渲染）。
    ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "workspace-only-scope",
        order: 10,
        locale: "settings.workspaceOnly",
        inject: (sessionId) => ({
            hooks: {workspaceOnly: controller.store},
            sessionId,
            load,
            setScope: (scope) => controller.setScope(sessionId, scope)
        })
    }, WorkspaceOnlyScopeSelect));
    // 会话页视图：当前工作区根目录的会话级白名单
    //（conversation.view 标签页，紧挨「对话 / 轨迹」）。
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: "whitelist",
        order: 20,
        locale: "settings.workspaceOnly",
        label: () => t("view.whitelist"),
        inject: (sessionId) => ({
            hooks: {workspaceOnly: controller.store},
            sessionId,
            load,
            addEntry: (dir) => controller.allowAlways(dir, sessionId),
            removeEntry: (entry) => controller.removeAlways(entry)
        })
    }, WorkspaceOnlyWhitelistView));
    // 任务 B 的三键面板：在 composer 里落座一个 pending ask，
    // 与平台的权限升权接管完全同款。
    const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(() => 0);
    // 任务 T12：按 requestId 记录在场的卡片。重复投递的 ask 负载绝不能
    // 二次落座——平台域对重复 key 会抛错，多余的席位卡片永远关不掉
    //（「卡片点了不关」的根因）。
    const seats = new Map();
    // 任务 T13：提示面的两个 store。`pendingStore` 镜像在场席位、供标题栏
    // 徽章使用；`toastStore` 是 FIFO 的一次性 toast 队列。两者都用对象包裹，
    // 让 `update` 的浅草稿 mutator 保持安全（裸数组状态会被展开成对象、
    // 丢掉 Array.prototype）。
    const pendingStore = createSnapshotStore({entries: []});
    const toastStore = createSnapshotStore({queue: []});
    let toastSeq = 0;
    const dismissToast = (seq) => {
        toastStore.update((state) => {
            state.queue = state.queue.filter((item) => item.seq !== seq);
        });
    };
    const raisePanel = (ask) => {
        if (ask === null || ask === void 0 || typeof ask.requestId !== "string") return;
        if (seats.has(ask.requestId)) return;
        // 形状对齐平台的 PendingApproval 契约：composer 的 pending-interaction
        // 投影是按 session 的，渲染按 `kind`/`key`/`sessionId`/`result` 匹配。
        // `kind: "approval"` 借用了侧边栏的可见 pending 白名单
        //（`visiblePendingKind` 只接受 approval/plan-review/question），
        // 所以 ask 待决期间会话行会亮起警告点。对官方面板是安全的：
        // composer 链的选举用 `instanceof PendingApproval`/`PendingQuestion`
        // 匹配它们，从不看 `kind`，所以这个借来的值不会把我们的卡片误交给
        // 官方组件（已在 DSH 0.2.1-rc.2 验证；若未来版本改按 `kind` 字符串
        // 选举就会冲突，必须回头复查）。`source` 是反向保护：我们的选择器
        // 绝不能认领官方的 PendingApproval，它的 `kind` 同样是 "approval"。
        const completion = Promise.withResolvers();
        let settled = false;
        let remove = () => {
        };
        let selfDestruct = 0;
        // 唯一的幂等撤座路径。点击结算和 Host 侧 dismiss 必须同步清掉
        // 提示 store——只靠 `completion.promise.then` 清理，就会在所有卡片
        // 都批完后留下过期的徽章条目（「徽章还显示 3」）。下面的 microtask
        // 只是双保险重跑一遍，并撤掉 composer 席位。
        const cleanup = () => {
            seats.delete(ask.requestId);
            clearTimeout(selfDestruct);
            pendingStore.update((state) => {
                state.entries = state.entries.filter((entry) => entry.requestId !== ask.requestId);
            });
        };
        const settle = (choice) => {
            if (settled) return Promise.resolve();
            settled = true;
            cleanup();
            completion.resolve(choice);
            return controller.call("decide", {requestId: ask.requestId, choice}).catch((error) => {
                console.warn("[workspace-only] decide RPC failed:", error);
                throw error;
            });
        };
        // 任务 T12：不带裁决地撤座——Host 已经结掉这个 ask 了
        //（对话框超时、批量放行、或另一个客户端的点击），不欠 decide RPC，
        // 过期卡片必须撤掉。
        const dismiss = () => {
            if (settled) return;
            settled = true;
            cleanup();
            completion.resolve("deny");
        };
        const pending = {
            kind: "approval",
            source: "workspace-only",
            key: ask.requestId,
            // 卡片的 presence 握手会把这个 id 报回 Host；没有它 announce()
            // 无法匹配这个 ask，Host 会退回到通用问答（双弹窗）。
            requestId: ask.requestId,
            sessionId: ask.sessionId,
            toolName: String(ask.toolName ?? "tool"),
            reason: String(ask.reason ?? ""),
            dir: String(ask.dir ?? ""),
            result: completion.promise,
            get answerable() {
                return !settled;
            },
            answer: (choice) => settle(choice)
        };
        // 平台的 answerApproval 模式：registerPendingInteraction 返回席位的
        // remove()，结果结算后必须移除席位——否则即使做了裁决卡片也永远
        // 离不开 composer。cleanup() 是幂等的，所以这个 microtask 只是
        // 给「resolve 了 `completion` 却没 settle」的路径兜底（目前没有）。
        completion.promise.then(() => {
            cleanup();
            try {
                remove();
            } catch {
                // 框架已经撤过了。
            }
        });
        remove = registerPendingInteraction(pending, async () => {
            // 被撤下（面板被替换或销毁）：拒绝这个 ask。
            try {
                await settle("deny");
            } catch {
                // Host 侧超时反正也会结掉这个 ask。
            }
        });
        seats.set(ask.requestId, dismiss);
        // 任务 T16：双保险自毁。Host 的 `askDone` 可能丢（通知丢失、重连
        // 竞态），过期卡片就会永远赖在 composer 里。Host 在自己的对话框
        // 超时时会结掉 ask，且拒绝永远 fail-closed，所以迟到的本地 dismiss
        // 不会改变裁决——它只是把卡片撤掉。从管理快照读取 Host 的截止时间。
        const deadline = controller.store.getSnapshot().dialogTimeoutMs;
        selfDestruct = setTimeout(() => {
            seats.get(ask.requestId)?.();
        }, (Number.isSafeInteger(deadline) && deadline >= 1 ? deadline : 120_000) + SELF_DESTRUCT_GRACE_MS);
        // T13：为标题栏徽章镜像席位并排入一条提示 toast。上面的 `seats`
        // 去重保证两者每个 requestId 只出现一次。
        const notice = {
            requestId: ask.requestId,
            sessionId: ask.sessionId,
            toolName: String(ask.toolName ?? "tool"),
            dir: String(ask.dir ?? "")
        };
        pendingStore.update((state) => {
            state.entries = [...state.entries, notice];
        });
        toastSeq += 1;
        toastStore.update((state) => {
            state.queue = [...state.queue, {seq: toastSeq, text: t("pending.toast", {dir: notice.dir})}];
        });
        // Presence：这个 handler 能跑起来本身就证明 Web 客户端在场。
        // 立刻 announce，而不是等 React 挂载卡片，这样 Host 的 presence
        // 窗口绝不会输给渲染周期；卡片自己的 announce 保留为幂等的第二次
        // 机会。任务 T16：Host 在不再认识这个 ask 时（已经结掉了）会答
        // `{ ok: false }`——迟到的卡片必须立刻撤掉，而不是等一个在席位
        // 出现之前就已广播的 `askDone`。
        controller.call("announce", {requestId: ask.requestId}).then((result) => {
            if (result?.ok === false) dismiss();
        }, (error) => {
            console.warn("[workspace-only] announce RPC failed:", error);
        });
    };
    // 任务 T12：ask 在非本客户端点击的情况下结掉时（对话框超时、批量
    // 放行、另一个标签页的裁决），Host 会广播 `askDone`——撤掉卡片，
    // 别让过期席位赖在 composer 里。
    const closePanel = (done) => {
        if (done === null || done === void 0 || typeof done.requestId !== "string") return;
        seats.get(done.requestId)?.dismiss();
    };
    ctx.slots.inject("conversation.composer", () => ctx.slots.register({
        name: "conversation.composer",
        priority: 1,
        select: ({
                     sessionId,
                     pendingInteraction
                 }) => pendingInteraction?.source === "workspace-only" ? pendingInteraction : null,
        locale: "settings.workspaceOnly",
        inject: () => ({
            // Presence 握手：卡片实际挂载后 announce 一次自己，这样 Host
            // 绝不会干等一个从未渲染出来的面板。与 raisePanel 里的到达
            // announce 幂等。任务 T16：`{ ok: false }` 表示 Host 已经结掉
            // 这个 ask——撤掉迟到卡片，别让它永远占着席位。
            announce: (requestId) => {
                controller.call("announce", {requestId}).then((result) => {
                    if (result?.ok === false) seats.get(requestId)?.();
                }, (error) => {
                    console.warn("[workspace-only] announce RPC failed:", error);
                });
            }
        })
    }, WorkspaceOnlyAskCard));
    // T13：会话标题栏徽章，紧挨子代理目录下拉。`conversation.session.header.actions`
    // 是标题旁承载 `SubagentCatalogAction`（id 'subagent-catalog'，order 10）
    // 的列表槽位——即「N 个子智能体」下拉——所以 order 11 让徽章紧跟其后。
    // 平台把打开的 Session 作为 `sessionId` 连同 `useSessions` hook 传下来。
    // 点击徽章用 `uiWorkspace.openSession` 打开第一个隐藏的 ask：跳子代理
    // 必须传 `SubagentAddress`——裸 SessionId 会被当普通会话打开、历史加载
    // 报 `subagent/not-found`。
    ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
        name: "conversation.session.header.actions",
        id: "workspace-only-pending",
        // 紧跟在子代理目录下拉（order 10）之后。
        order: 11,
        locale: "settings.workspaceOnly",
        inject: (sessionId) => ({
            hooks: {pending: pendingStore},
            sessionId,
            openPending: (target) => {
                // 负载畸形时 fail-closed：不导航。
                if (typeof target === "string") {
                    if (target.length > 0) ctx.uiWorkspace.openSession(target);
                    return;
                }
                if (target === null || target === void 0 || typeof target.childSessionId !== "string") return;
                // 徽章从列表行的 `parentId` 拼出地址（mode 未知）；平台若知道
                // 精确的 SubagentAddress 就优先用它，避免猜测 mode。
                const exact = ctx.sessions?.subagentAddress?.(target.childSessionId);
                ctx.uiWorkspace.openSession(exact ?? target);
            }
        })
    }, WorkspaceOnlyPendingBadge));
    // T13：一次性提示 toast。`shell.overlay` 是官方明示的全局浮层
    // add-only 槽位（slot-catalog：在此注册你自己的全局横幅）；横幅
    // 本体是共享的 Toast 原语。
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "workspace-only-toast",
        inject: () => ({
            hooks: {toasts: toastStore},
            dismissToast
        })
    }, WorkspaceOnlyToast));
    ctx.effect(() => {
        const refresh = () => {
            controller.load();
        };
        const disposers = [ctx.remote.$on("settings/document-updated", (ns, extra) => {
            if (extra?.ask != null) {
                raisePanel(extra.ask);
                return;
            }
            if (extra?.askDone != null) {
                closePanel(extra.askDone);
                return;
            }
            if (ns !== "workspace-only") return;
            refresh();
        })];
        return () => {
            controller.dispose();
            for (const dispose of disposers) dispose();
        };
    }, "workspace-only: settings invalidations");
}

export {apply, inject};
