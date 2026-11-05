/**
 * 三键门禁的 ask 会合点（任务 B）。
 *
 * 呈现：一张三按钮卡片接管 Conversation composer —— 与平台的权限升级面板
 * （`@deepseek-ai/dsh-client-ui-approval`）同一表面，样式也仿照它：警告条、
 * 违规的工具/路径/原因，以及一行动作按钮 仅此一次 / 总是允许该目录 / 拒绝
 * （Enter = 允许一次，Esc = 拒绝）。
 *
 * 传输：DSH 的转发事件白名单编译在 `@deepseek-ai/dsh-api-remotes` 里，因此插件
 * 没有自定义的 host→client 请求事件。面板通过白名单上的通道拉起 —— 即携带 `ask`
 * 载荷的 `settings/document-updated` 通知 —— 再经插件自己的 `workspaceOnly/decide`
 * RPC 应答（见 `remote-service.ts`）。presence 握手（`announce`）告诉 Host 面板
 * 确实已出现，之后才等完整超时。
 *
 * 回退链（绝不弱于旧行为）：
 *   1. 三按钮 composer 卡片（Web 客户端，presence 已确认）；
 *   2. `ctx.userQuestions` 通用提问（其他答题 UI，如 TUI）；
 *   3. 官方 `approval/request` waterfall（系统对话框）；
 *   4. 拒绝（fail closed）。
 *
 * 在 presence 窗口之后才出现的卡片仍保留席位：对该 requestId 的迟到 `decide()`
 * 依然有效并撤掉回退提问，这样慢速客户端绝不会让两个答题表面争抢同一次 ask。
 *
 * 超时与取消一律拒绝。审计走可忽略的 `plugin:` 记录，面板路径上绝不写
 * `approval/*`，以免系统对话框重复弹窗。
 */
import {randomUUID} from "node:crypto";
import {requestApprovalViaWaterfall} from "./approval-compat.ts";
import {recordAlwaysAdded, recordAsk, recordDecision} from "./session-state.ts";
import type {Context} from "@deepseek-ai/cordis";
import type {Session} from "@deepseek-ai/dsh-session";
import type {ApprovalRequestEvent} from "@deepseek-ai/dsh-user-approval/types";

/** 用户的选择。 */
export const CHOICE = {
    once: "once",
    always: "always",
    deny: "deny"
} as const;

/** 生效的选择值。 */
export type Choice = (typeof CHOICE)[keyof typeof CHOICE];

/** 面板三个按钮的文案（稳定文案）。 */
export const LABELS = {
    once: "仅此一次",
    always: "总是允许该目录",
    deny: "拒绝"
} as const;

/** 决策的来源通道。 */
export const CHANNEL = {
    panel: "panel",
    question: "question",
    systemDialog: "system-dialog",
    none: "none",
    /** 任务 T2：被另一次 ask 的"总是允许该目录"批量放行。 */
    alwaysBatch: "always-batch",
    /** 任务 T6：快速 fail-closed —— 没有应答通道，不走回退链直接拒绝。 */
    fastDeny: "fast-deny"
} as const;

/** 决策来源通道值。 */
export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

const DEFAULT_TIMEOUT_MS = 120_000;
/** Host 等待面板 announce 自己的时长，超时后走回退（测试可用环境变量覆盖）。 */
const PRESENCE_WAIT_MS = (() => {
    const raw = Number(process.env.WORKSPACE_ONLY_PRESENCE_WAIT_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 3_000;
})();

/** Agent 身份与工具调用 id 的类型由官方审批事件载荷携带（不直接依赖 `dsh-agent`）。 */
export type AskAgent = ApprovalRequestEvent["agent"];
export type AskCallId = ApprovalRequestEvent["callId"];

/** 一次被门禁审问的工具调用（词法面之外还带 `callId`，供系统对话框回退定位调用）。 */
export interface AskExec {
    readonly name: string;
    readonly callId?: AskCallId;
    readonly arguments?: unknown;
}

/** 一次工作区外调用的询问参数（{@link createAskFlow} 的 `askOutside` 入参）。 */
export interface AskParams {
    readonly ctx: Context;
    readonly agent?: AskAgent | undefined;
    readonly session?: Session | undefined;
    readonly exec: AskExec;
    readonly reason: string;
    readonly dir: string;
    readonly targets?: readonly string[] | undefined;
    /** 本次 ask 允许授予的维度（`"dir"` / `"pattern"`），两者绝不混用（D5）。 */
    readonly grantKinds?: readonly string[] | undefined;
    readonly patterns?: readonly string[] | undefined;
    /** 命中敏感文件时卡片换 pattern 措辞（任务 T4）。 */
    readonly sensitive?: boolean | undefined;
    readonly signal?: AbortSignal | undefined;
}

/** 单次询问的裁决结果。 */
export interface AskResult {
    readonly choice: Choice;
    readonly channel: Channel;
    readonly label: string | undefined;
}

/** `createAskFlow` 的运行时钩子（由 index 装配时注入）。 */
export interface AskFlowOptions {
    timeoutMs?: (() => number | undefined) | undefined;
    allowAlways?: ((dir: string, session: Session | undefined) => Promise<unknown> | unknown) | undefined;
    allowPattern?: ((pattern: string) => Promise<unknown> | unknown) | undefined;
    isAlwaysAllowed?: ((path: string, session: Session | undefined) => boolean | undefined) | undefined;
    isPatternAllowed?: ((pattern: string) => boolean | undefined) | undefined;
    fastDenyMs?: (() => number | undefined) | undefined;
    notify?: ((payload: unknown) => void) | undefined;
}

/** 推给客户端的 ask 载荷（`settings/document-updated` 的 `ask` 部分，客户端契约）。 */
export interface AskNotice {
    readonly requestId: string;
    readonly toolName: string;
    readonly reason: string;
    readonly dir: string;
    // 会话标识：composer 的 pending-interaction 投影按会话组织，没有会话标识的条目会被丢弃。
    readonly sessionId: string | undefined;
    readonly parentSessionId: string | null;
    readonly sensitive?: true;
}

/** 一个待决 ask 的席位（`pending` map 的值）。 */
interface PendingEntry {
    toolName: string;
    dir: string;
    reason: string;
    targets: string[];
    sessionId: string | undefined;
    // T20：待决项携带会话对象（白名单匹配要走血缘根）。
    session: Session | undefined;
    releaseVia: Channel | undefined;
    announced: boolean;
    resolve: (choice: Choice) => void;
    wakePresence: () => void;
}

/** askPanel 的裁决结果。 */
type PanelOutcome =
    | {readonly kind: "answered"; readonly choice: Choice; readonly via: Channel | undefined}
    | {readonly kind: "no-panel"; readonly lateDecide: Promise<PanelOutcome>; readonly cancel: () => void}
    | {readonly kind: "timeout"}
    | {readonly kind: "aborted"};

/** askQuestion 的裁决结果（与迟到的面板决策合流）。 */
type QuestionOutcome =
    | {readonly kind: "answered"; readonly choice: Choice; readonly via: Channel | undefined}
    | {readonly kind: "answer"; readonly choice: Choice; readonly via?: Channel | undefined}
    | {readonly kind: "fallback"}
    | {readonly kind: "timeout"};

/** 将来自客户端或提问回答的决策 token 归一化。 */
export function normalizeChoice(value: unknown): Choice {
    return value === CHOICE.once || value === CHOICE.always || value === CHOICE.deny ? value : CHOICE.deny;
}

/** `user-questions` 回答批次的最小形状（类型声明在未钉进 devDeps 的 `dsh-user-questions` 里）。 */
interface QuestionAnswerBatch {
    readonly answers?: ReadonlyArray<{readonly id?: unknown; readonly selected?: unknown}> | undefined;
}

/** 把 `user-questions` 回答批次映射为 choice；无法识别的一律拒绝。 */
export function choiceFromAnswer(answer: unknown): Choice {
    const batch = (answer ?? {}) as QuestionAnswerBatch;
    const selected = batch.answers?.find((item) => item?.id === "workspace-only")?.selected ?? batch.answers?.[0]?.selected ?? [];
    const label = Array.isArray(selected) ? selected[0] : void 0;
    if (label === LABELS.always) return CHOICE.always;
    if (label === LABELS.once) return CHOICE.once;
    return CHOICE.deny;
}

/**
 * 构建绑定到本插件运行时的 ask 流程。
 *
 * @param options - `timeoutMs()` 读取 `Config.dialogTimeoutMs`；`allowAlways(dir, session)`
 *   把目录持久化进 `Config.always`（条目绑会话的血缘根，T20）；`allowPattern(pattern)` 把敏感 pattern 持久化
 *   进 `Config.sensitiveAlways`（任务 T4）；`isAlwaysAllowed(path, session)` 判断路径是否
 *   已被白名单覆盖（任务 T2 的批量放行）；`isPatternAllowed(pattern)` 判断敏感
 *   pattern 是否已持久化（任务 T12 的队列跟进）；`fastDenyMs()` 读取
 *   `Config.fastDenyMs`（任务 T6：>0 时对没有应答通道的调用启用快速 fail-closed）；
 *   `notify(payload)` 向每个已连接客户端推送 `settings/document-updated` 载荷
 *   （任务 T12：撤卡）。
 * @returns `{ askOutside, announce, decide, pendingList }` —— 后三个接入
 *   `workspaceOnly` Remote 服务。
 */
export function createAskFlow({
                                  timeoutMs,
                                  allowAlways,
                                  allowPattern,
                                  isAlwaysAllowed,
                                  isPatternAllowed,
                                  fastDenyMs,
                                  notify
                              }: AskFlowOptions) {
    const pending = new Map<string, PendingEntry>();
    // 任务 T12：composer 的 pending-interaction 投影每会话只保留一个 interaction
    // （`ui-session` 的 publishPendingInteractions 按 sessionId 只选一个赢家），
    // 因此同一会话的两次并发 ask 会争抢一个席位 —— 答掉可见的那张只是把后面的
    // 隐藏卡片露出来（"卡片关不掉"）。子代理常撞上这个（并行工具调用共用一个
    // 会话 id），所以同一会话的 ask 严格串行。排队的调用若在此期间已被白名单
    // 条目覆盖则立刻结算（T2 的批量放行，由下面出队时的再检查承接）。
    const queues = new Map<string, Promise<void>>();

    /** 移除一个席位，并通知每个已连接客户端撤掉自己的卡片。 */
    function drop(requestId: string): void {
        if (!pending.delete(requestId)) return;
        if (typeof notify !== "function") return;
        try {
            notify({askDone: {requestId}});
        } catch {
            // 通知丢了最多留下一张过期卡片，下次点击会关掉它；绝不能因此让 ask 失败。
        }
    }

    const readTimeout = (): number => {
        const value = timeoutMs?.();
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_TIMEOUT_MS;
    };
    // 任务 T6：非零预算把"没人能应答"变成立刻拒绝，而不是跑完整条回退链直到系统对话框。
    const readFastDenyMs = (): number => {
        const value = fastDenyMs?.();
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : 0;
    };

    /**
     * 任务 T2（MiMo 对齐）：一次"总是允许该目录"会同时结算同一会话中所有目标
     * 已被这条新白名单条目覆盖的待决 ask —— 这些调用直接放行，不再排队出卡片。
     * 未匹配的待决项（别的目录、别的会话）继续等各自的决策。
     *
     * @returns 放行的待决数量。
     */
    function releaseMatching(sessionId: string | undefined): number {
        if (typeof sessionId !== "string" || sessionId === "" || typeof isAlwaysAllowed !== "function") return 0;
        let released = 0;
        for (const [requestId, entry] of [...pending.entries()]) {
            if (entry.sessionId !== sessionId) continue;
            const targets = Array.isArray(entry.targets) ? entry.targets : [];
            // 任务 T20：会话对象随待决项一起携带，会话级条目只在自己的主会话
            //（血缘根）下匹配。
            if (!targets.some((target) => isAlwaysAllowed(target, entry.session) === true)) continue;
            drop(requestId);
            entry.releaseVia = CHANNEL.alwaysBatch;
            entry.resolve(CHOICE.always);
            released += 1;
        }
        return released;
    }

    /** 客户端面板报告自己已出现在屏幕上。 */
    function announce(requestId: unknown): {ok: boolean} {
        const entry = typeof requestId === "string" ? pending.get(requestId) : void 0;
        if (entry === void 0) return {ok: false};
        entry.announced = true;
        entry.wakePresence?.();
        return {ok: true};
    }

    /** 面板（或任何管理调用方）提交决策。 */
    function decide(requestId: unknown, choice: unknown): {ok: boolean} {
        const entry = typeof requestId === "string" ? pending.get(requestId) : void 0;
        if (entry === void 0 || typeof requestId !== "string") return {ok: false};
        drop(requestId);
        entry.resolve(normalizeChoice(choice));
        return {ok: true};
    }

    /** 供设置表面使用的诊断视图。 */
    function pendingList(): Array<{
        requestId: string;
        toolName: string;
        dir: string;
        sessionId: string | undefined;
        targets: string[];
        announced: boolean;
    }> {
        return [...pending.entries()].map(([requestId, entry]) => ({
            requestId,
            toolName: entry.toolName,
            dir: entry.dir,
            sessionId: entry.sessionId,
            targets: Array.isArray(entry.targets) ? entry.targets.slice() : [],
            announced: entry.announced === true
        }));
    }

    /**
     * 就一次工作区外调用询问用户。同一会话的 ask 严格一次一个（任务 T12：
     * composer 每会话只有一个席位），这样每次 ask 都有自己的卡片，答掉就真的关掉。
     *
     * @returns `{ choice, channel, label? }`。
     */
    async function askOutside(params: AskParams): Promise<AskResult> {
        const sessionId = params.session?.id;
        const queueKey = typeof sessionId === "string" && sessionId !== "" ? sessionId : "\u0000anonymous";
        const tail = queues.get(queueKey) ?? Promise.resolve();
        // 队列无论上一次 ask 是 resolve 还是 throw 都会推进。
        const run = tail.then(() => runAsk(params), () => runAsk(params));
        const keep = run.then(() => void 0, () => void 0);
        queues.set(queueKey, keep);
        keep.then(() => {
            if (queues.get(queueKey) === keep) queues.delete(queueKey);
        });
        return run;
    }

    /** 单次 ask，排在同一会话所有更早的 ask 之后。 */
    async function runAsk({ctx, agent, session, exec, reason, dir, targets, grantKinds, patterns, sensitive, signal}: AskParams): Promise<AskResult> {
        const kinds = Array.isArray(grantKinds) && grantKinds.length > 0 ? grantKinds : ["dir"];
        const sensitivePatterns = Array.isArray(patterns) ? [...new Set(patterns)] : [];
        const targetList = Array.isArray(targets) ? targets : [];
        // Fail closed：排队等待期间被取消的调用绝不再询问。
        if (signal?.aborted === true) {
            recordDecision(session, {
                toolName: exec.name,
                dir,
                channel: CHANNEL.none,
                choice: CHOICE.deny,
                label: LABELS.deny,
                ms: 0
            });
            return {choice: CHOICE.deny, channel: CHANNEL.none, label: LABELS.deny};
        }
        // 任务 T2 的队列跟进：排队期间授予的白名单条目已经覆盖了这次调用 ——
        // 按批量放行结算，不弹卡片。两个维度绝不混用（D5）：目录条目从不放行
        // 敏感 ask，且只有已持久化的 pattern（绝不是目录）能放行敏感 ask。
        const dirCovered = !kinds.includes("dir") || targetList.some((target) => isAlwaysAllowed?.(target, session) === true);
        const patternCovered = !kinds.includes("pattern") || (sensitivePatterns.length > 0 && typeof isPatternAllowed === "function" && sensitivePatterns.every((pattern) => isPatternAllowed(pattern) === true));
        if (dirCovered && patternCovered) {
            recordDecision(session, {
                toolName: exec.name,
                dir,
                channel: CHANNEL.alwaysBatch,
                choice: CHOICE.always,
                label: LABELS.always,
                ms: 0
            });
            return {choice: CHOICE.always, channel: CHANNEL.alwaysBatch, label: LABELS.always};
        }
        const askedAt = Date.now();
        recordAsk(session, {toolName: exec.name, dir, reason});
        let choice: Choice = CHOICE.deny;
        let channel: Channel = CHANNEL.none;
        let label: string | undefined = void 0;
        // `via` 标记批量放行：白名单写入已经在触发它的那次 ask 上完成，这里只记决策。
        const grant = async (picked: Choice, via: Channel | undefined): Promise<Choice> => {
            if (picked !== CHOICE.always) return picked;
            if (via === CHANNEL.alwaysBatch) return CHOICE.always;
            try {
                if (kinds.includes("dir")) {
                    // 授权会话的血缘根给条目定作用域（T20）：ask 卡片的授权永远是
                    // 会话级的（在会话页的白名单视图里管理），绝不是全局的 ——
                    // T25 起持久化到会话白名单文件，不进 Config。
                    await allowAlways?.(dir, session);
                    // 任务 T2：新白名单条目放行同会话中已被它覆盖的其他待决 ask。
                    releaseMatching(session?.id);
                    recordAlwaysAdded(session, {dir, toolName: exec.name, kind: "dir"});
                }
                // 任务 T4：敏感命中持久化其 pattern（"总是允许此类文件"）——
                // pattern 维度，绝不混进 `Config.always`。
                if (kinds.includes("pattern") && typeof allowPattern === "function") {
                    for (const pattern of sensitivePatterns) {
                        await allowPattern(pattern);
                        recordAlwaysAdded(session, {dir: pattern, toolName: exec.name, kind: "pattern"});
                    }
                }
                return CHOICE.always;
            } catch (error) {
                // 白名单写入失败仍放行这一次调用，但失败必须可见 —— 这里静默吞掉
                // 曾让"总是允许该目录"看起来像个死按钮。
                console.warn(`[workspace-only] whitelist write failed for ${dir}; granting this one call only`, error);
                return CHOICE.once;
            }
        };

        // 1) 三按钮 composer 卡片，presence 已确认。
        const requestId = randomUUID();
        const panel = await askPanel(ctx, {
            requestId,
            exec,
            reason,
            dir,
            targets,
            sensitive,
            signal,
            session
        }, pending, drop, readTimeout());
        if (panel.kind === "answered") {
            channel = panel.via === CHANNEL.alwaysBatch ? CHANNEL.alwaysBatch : CHANNEL.panel;
            choice = await grant(panel.choice, panel.via);
            label = labelOf(choice);
        } else if (panel.kind === "no-panel") {
            // 2) 通用提问（其他答题 UI），然后 3) 系统对话框。
            // 面板席位在回退期间仍然有效：卡片的迟到决策会撤掉提问并按面板输入处理。
            // 任务 T6：有快速拒绝预算时，提问只给那么多时间，应答方缺席则立刻拒绝 ——
            // 不进系统对话框。
            const fast = readFastDenyMs();
            console.warn(`[workspace-only] panel presence timed out for ${exec.name}; asking through the generic question (requestId ${requestId})`);
            const aborter = new AbortController();
            const late = panel.lateDecide.then((outcome) => {
                aborter.abort();
                return outcome;
            });
            const asked = await Promise.race([
                askQuestion(ctx, {
                    agent,
                    exec,
                    reason,
                    dir,
                    sensitive,
                    signal: anySignal([signal, aborter.signal])
                }, fast > 0 ? Math.min(readTimeout(), fast) : readTimeout()),
                late
            ]);
            // 任务 T16：在所有退出路径上都要结算通用提问。它的卡片活到请求结算为止 ——
            // 冲过本地超时却不 abort 会让三键提问卡永远留在 composer 里
            // （"卡片永远不消失"的根因）。只要回答尚未到达，abort 会以 ASK_ABORTED
            // （非应答）传到平台；已结算的请求则忽略它。
            aborter.abort();
            panel.cancel();
            if (asked.kind === "answered") {
                channel = asked.via === CHANNEL.alwaysBatch ? CHANNEL.alwaysBatch : CHANNEL.panel;
                choice = await grant(asked.choice, asked.via);
                label = labelOf(choice);
            } else if (asked.kind === "answer") {
                channel = CHANNEL.question;
                choice = await grant(asked.choice, asked.via);
                label = labelOf(choice);
            } else if (asked.kind === "fallback") {
                if (fast > 0) {
                    // 任务 T6：快速预算内没有应答通道。
                    choice = CHOICE.deny;
                    channel = CHANNEL.fastDeny;
                } else {
                    choice = await fallbackToSystemDialog(ctx, agent, session, exec, reason, signal);
                    channel = choice === CHOICE.once ? CHANNEL.systemDialog : CHANNEL.none;
                }
            } else if (fast > 0) {
                // 任务 T6：提问耗尽了快速预算 —— 快速拒绝。
                channel = CHANNEL.fastDeny;
            }
        }
        recordDecision(session, {toolName: exec.name, dir, channel, choice, label, ms: Date.now() - askedAt});
        return {choice, channel, label};
    }

    return {askOutside, announce, decide, pendingList, releaseMatching};
}

/** 某个 choice 对应的按钮文案。 */
function labelOf(choice: Choice): string {
    return choice === CHOICE.always ? LABELS.always : choice === CHOICE.once ? LABELS.once : LABELS.deny;
}

/** 合并 abort 信号，使面板的迟到决策能撤掉回退提问。 */
function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal | undefined {
    const list = signals.filter((item): item is AbortSignal => item !== void 0);
    if (list.length === 0) return void 0;
    if (list.length === 1) return list[0];
    const controller = new AbortController();
    for (const item of list) {
        if (item.aborted) {
            controller.abort(item.reason);
            break;
        }
        item.addEventListener("abort", () => controller.abort(item.reason), {once: true});
    }
    return controller.signal;
}

/**
 * 拉起 composer 卡片并等待：先是 presence 公告（面板从未出现意味着没有 Web 客户端），
 * 然后等它的决策直到对话框超时。超时与取消一律拒绝。
 */
async function askPanel(ctx: Context, {
    requestId,
    exec,
    reason,
    dir,
    targets,
    sensitive,
    signal,
    session
}: {
    requestId: string;
    exec: AskExec;
    reason: string;
    dir: string;
    targets: readonly string[] | undefined;
    sensitive: boolean | undefined;
    signal: AbortSignal | undefined;
    session: Session | undefined;
}, pending: Map<string, PendingEntry>, drop: (requestId: string) => void, timeoutMs: number): Promise<PanelOutcome> {
    const entry: PendingEntry = {
        toolName: exec.name,
        dir,
        reason,
        targets: Array.isArray(targets) ? targets.slice() : [],
        sessionId: session?.id,
        // T20：待决项携带会话对象（白名单匹配要走血缘根）。
        session,
        releaseVia: void 0,
        announced: false,
        resolve: () => {
        },
        wakePresence: () => {
        }
    };
    let settled = false;
    let wakeLate: (value: PanelOutcome) => void = () => {
    };
    const lateDecide = new Promise<PanelOutcome>((resolve) => {
        wakeLate = resolve;
    });
    const answered = new Promise<PanelOutcome>((resolve) => {
        entry.resolve = (choice) => {
            if (settled) return;
            settled = true;
            resolve({kind: "answered", choice, via: entry.releaseVia});
        };
    });
    const presence = new Promise<void>((resolve) => {
        entry.wakePresence = () => resolve(void 0);
    });
    pending.set(requestId, entry);
    try {
        ctx.emit("settings/document-updated", "workspace-only", {
            ask: {
                requestId,
                toolName: exec.name,
                reason,
                dir,
                // 会话标识：composer 的 pending-interaction 投影按会话组织，没有会话标识的条目会被丢弃。
                sessionId: session?.id,
                // T19：子代理会话标识（header `parentSession`）。客户端据此在父会话
                // 的会话行挂「待审批」黄点（影子 pending 投影）；主会话自己的 ask
                // 没有父会话（null），不挂影子。
                parentSessionId: session?.header?.parentSession ?? null,
                // 任务 T4：命中敏感文件时，卡片把 always 按钮文案换成 pattern 维度的措辞。
                ...sensitive === true ? {sensitive: true} : {}
            } satisfies AskNotice
        });
    } catch {
        drop(requestId);
        return {
            kind: "no-panel", lateDecide, cancel: () => {
            }
        };
    }
    const presenceTimeout = new Promise<string>((resolve) => setTimeout(() => resolve("presence-timeout"), Math.min(PRESENCE_WAIT_MS, timeoutMs)));
    const presenceOutcome = await Promise.race([presence.then(() => "announced"), presenceTimeout]);
    // announced 标记闭合了 announce() 与 presence 计时器同一 tick 触发的竞态。
    if (presenceOutcome !== "announced" && entry.announced !== true) {
        if (!settled) {
            // 保留席位：卡片可能稍后才挂载，它的 decide() 仍须算数。调用方把这个与回退 ask 竞速。
            entry.resolve = (choice) => {
                if (settled) return;
                settled = true;
                drop(requestId);
                wakeLate({kind: "answered", choice, via: entry.releaseVia});
            };
            return {
                kind: "no-panel",
                lateDecide,
                cancel: () => {
                    if (settled) return;
                    settled = true;
                    drop(requestId);
                }
            };
        }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<PanelOutcome>((resolve) => {
        timer = setTimeout(() => resolve({kind: "timeout"}), timeoutMs);
    });
    const abort = new Promise<PanelOutcome>((resolve) => {
        if (signal === void 0) return;
        if (signal.aborted) return resolve({kind: "aborted"});
        signal.addEventListener("abort", () => resolve({kind: "aborted"}), {once: true});
    });
    try {
        return await Promise.race([answered, deadline, abort]);
    } finally {
        clearTimeout(timer);
        if (!settled) {
            settled = true;
            drop(requestId);
        }
    }
}

/** `ctx.userQuestions` 的最小形状（服务类型在未钉进 devDeps 的 `dsh-user-questions` 里）。 */
interface UserQuestionsService {
    ask(request: {
        readonly questions: readonly unknown[];
        readonly agent?: AskAgent | undefined;
        readonly signal?: AbortSignal | undefined;
    }): Promise<unknown>;
}

/** 在通用提问接缝上发出一次带三个稳定选项的提问。 */
async function askQuestion(ctx: Context, {
    agent,
    exec,
    reason,
    dir,
    sensitive,
    signal
}: {
    agent: AskAgent | undefined;
    exec: AskExec;
    reason: string;
    dir: string;
    sensitive: boolean | undefined;
    signal: AbortSignal | undefined;
}, timeoutMs: number): Promise<QuestionOutcome> {
    const questionService = (() => {
        try {
            return ctx.get("userQuestions") as UserQuestionsService | undefined;
        } catch {
            return void 0;
        }
    })();
    if (questionService === void 0 || typeof questionService.ask !== "function") return {kind: "fallback"};
    const question = {
        id: "workspace-only",
        header: "Workspace Only",
        question: `[Workspace Only] \`${exec.name}\` 请求访问工作区外的路径`,
        detail: `原因：${reason}\n目标目录：\`${dir}\`\n工具：\`${exec.name}\``,
        options: [
            {label: LABELS.once, description: "只放行这一次调用"},
            {
                label: LABELS.always,
                description: sensitive === true ? "总是允许此类文件（按 pattern 持久化）" : "把该目录加入白名单，之后不再询问"
            },
            {label: LABELS.deny, description: "拒绝这次调用"}
        ],
        multiSelect: false
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<QuestionOutcome>((resolve) => {
        timer = setTimeout(() => resolve({kind: "timeout"}), timeoutMs);
    });
    const pendingAnswer: Promise<QuestionOutcome> = Promise.resolve()
        .then(() => questionService.ask({questions: [question], ...agent !== void 0 ? {agent} : {}, ...signal !== void 0 ? {signal} : {}}))
        .then((answer): QuestionOutcome => ({kind: "answer", choice: choiceFromAnswer(answer)}))
        .catch((error): QuestionOutcome => classifyAskFailure(error));
    try {
        return await Promise.race([pendingAnswer, timeout]);
    } finally {
        clearTimeout(timer);
        pendingAnswer.catch(() => {
        });
    }
}

/**
 * 对提问接缝的失败分类："应答方不在"走系统对话框回退；明确的非应答则拒绝。
 */
function classifyAskFailure(error: unknown): QuestionOutcome {
    const code = (error as {code?: unknown} | null | undefined)?.code;
    if (code === "NO_PROVIDER" || code === "DELEGATED_CALLER" || code === "CALLER_NOT_LIVE") return {kind: "fallback"};
    // ASK_CANCELLED（面板关闭）、ASK_ABORTED、ASK_TIMED_OUT 以及其他情况都算非应答：
    // 拒绝这次调用。
    return {kind: "timeout"};
}

/** 既有行为：在官方 `approval/request` waterfall 上询问。 */
async function fallbackToSystemDialog(ctx: Context, agent: AskAgent | undefined, session: Session | undefined, exec: AskExec, reason: string, signal: AbortSignal | undefined): Promise<Choice> {
    // 无会话则写不了审批审计（原实现会在 append 处抛出并被 catch 成拒绝）。
    if (agent === void 0 || session === void 0) return CHOICE.deny;
    try {
        const outcome = await requestApprovalViaWaterfall(ctx, {
            agent,
            toolName: exec.name,
            ...exec.callId !== void 0 ? {callId: exec.callId} : {},
            reason: `[workspace-only] ${reason} — approve to allow this one call to access outside the workspace`,
            ...signal !== void 0 ? {signal} : {}
        }, session);
        return outcome === "allowed-once" ? CHOICE.once : CHOICE.deny;
    } catch {
        return CHOICE.deny;
    }
}
