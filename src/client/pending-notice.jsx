import css from "./pending-notice.module.css";

/**
 * T13：pending ask 的提示面。会话标题栏徽章统计当前视图无法展示的
 * 已落座 ask——子代理的三键卡片在那个子代理自己的 composer 里——
 * 点击打开第一个，卡片本体正在那边等待（`seats` 的 requestId 去重
 * 保证每个 ask 只出现一次）。T19：toast 提示面已移除，子代理 ask 改由
 * 父会话行的「待审批」黄点提示（index.jsx 的影子 pending 投影）。
 * 两者都只读插件自己的 ask 生命周期：官方 approval 与 question 交互
 * 刻意不在范围内。
 */
export function WorkspaceOnlyPendingBadge({sessionId, useSessions, usePending, openPending, t}) {
    const entries = usePending((snapshot) => snapshot.entries);
    const byId = useSessions((state) => state.byId);
    // 徽章属于被搁置 ask 的父会话：卡片在那个子代理自己的 composer 里，
    // 父视图看不到。无关会话必须保持干净——这是给本对话子会话的导航
    // 提示，不是全局警报。
    // 列表行的子代理链接是 `SessionSummary.parentId`（配对
    // `origin: 'subagent'`）；`byId` 行不带 `subagent.address`——
    // 那个形状在 per-Session 的 `useSession` 快照上。读错字段过滤
    // 永远不命中：卡片在、徽章无。
    const visible = entries.filter((entry) => byId[entry.sessionId]?.parentId === sessionId);
    if (visible.length === 0) return null;
    const tip = [t("pending.tip", {n: visible.length}), ...visible.map((entry) => {
        const label = byId[entry.sessionId]?.title ?? entry.toolName;
        return `${label} → ${entry.dir}`;
    })].join("\n");
    return (
        <button
            type="button"
            className={css.pending}
            title={tip}
            onClick={() => {
                const entry = visible[0];
                if (entry === null || entry === void 0 || typeof entry.sessionId !== "string") return;
                // 目标会话是子代理时必须按 SubagentAddress 导航：裸 SessionId
                // 会把它当普通会话打开、历史加载报 `subagent/not-found`。
                // 列表行只带父链接，所以用 `parentId` 拼地址、mode 未知；
                // `openPending` 内再经 `sessions.subagentAddress` 把 mode 精确化。
                const summary = byId[entry.sessionId];
                const target = summary?.parentId == null
                    ? entry.sessionId
                    : {parentSessionId: summary.parentId, childSessionId: entry.sessionId, mode: "unknown"};
                openPending(target);
            }}
        >
            <span className={css.pendingDot}/>
            {t("pending.badge", {n: visible.length})}
        </button>
    );
}
