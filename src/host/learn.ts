/**
 * 无感自主学习层：从**既有三键判决**自动归纳 shell 路径识别的豁免规则 ——
 * 不新增任何判决 UI。机制：
 *
 * 1. 归因：每次 ask 按命中条目的**形态签名**记账（事件级，进 learn.sqlite3）；
 * 2. 归纳：某签名累计放行 ≥ 阈值且用户拒绝为 0 → 自动豁免（不再触发询问）；
 *    **任一次用户拒绝立即回撤豁免**（门禁重新收紧）；
 * 3. 负样本口径（AGENTS.md「学习层负样本只认用户 deny」条目）：只有
 *    `user-denied`/`user-rejected` 是用户对形态的判断；`timeout`/`no-channel`/
 *    `cancelled` 是 fail-closed 噪声，只计观察、不回撤。
 *
 * 安全边界：学习只产生"降误判"豁免（形态签名级），永不触碰 deny 规则、
 * 敏感判定、硬路径特征与白名单语义；一切不确定回落保守询问（fail-safe）。
 */
import {openLearnDb, UNAVAILABLE} from "./learn-db.ts";
import type {ApprovalEvent, HitEvent, LearnDb, LearnedFeature} from "./learn-db.ts";
import {hasHardPathShape, shapeSignature} from "./shell-syntax.ts";

export {shapeSignature};

/** 学习层的配置读取面（`Config` 的三个字段，index 装配时注入）。 */
export interface LearnOptions {
    /** `Config.learnFromDecisions`：总开关。 */
    readonly enabled: () => boolean;
    /** `Config.learnThreshold`：自动豁免的放行阈值。 */
    readonly threshold: () => number;
    /** `Config.learnRetentionDays`：事件保留天数（压实）。 */
    readonly retentionDays: () => number;
}

/** 一条命中记账的输入（时间、判决与 id 由 {@link LearnService.record} 补齐）。 */
export interface LearnHitInput {
    readonly tool: string;
    readonly command: string;
    readonly token: string;
    readonly shapeSig: string;
    /** token 所属命令的归一名（空串=不可知）。 */
    readonly commandName: string;
    readonly role: string;
    readonly shape: string | null;
    readonly hitReason: string;
    readonly isFocus: boolean;
    /** dsh 会话 id。 */
    readonly sessionId: string;
}

/**
 * 判决的学习分类：`allow`（正样本）/ `user-deny`（**唯一负样本**，回撤豁免）/
 * `other-deny`（超时/无应答/取消，只计观察）。
 */
export function verdictClass(verdict: string): "allow" | "user-deny" | "other-deny" {
    if (verdict === "once" || verdict === "always") return "allow";
    if (verdict === "user-denied" || verdict === "user-rejected") return "user-deny";
    return "other-deny";
}

/**
 * 方向锁：**abs-path 形态与硬路径特征不可学**——学习只降误判，
 * 真实路径的放行是授权语义（白名单的事）、不是误报。五段签名的形态段
 * （第 4 段）为 `abs-path` 或 token 带硬路径特征（盘符/UNC/`~/`/`..`）
 * 的命中永不进归纳、永不被豁免。
 */
export function isLearnable(shapeSig: string, token: string): boolean {
    if (hasHardPathShape(token)) return false;
    return (shapeSig.split("|")[3] ?? "plain") !== "abs-path";
}

/**
 * 形态签名（归纳键）：`工具|命令|角色|形态|引号` —— 判别维度全部保留、
 * 绝不泛化到裸 token。签名级豁免比"具体 token 放行"安全得多：
 * 它只压掉误报形态的 outside 询问，deny/敏感/硬路径照常。
 * （实现在 `shell-syntax.ts`，与扫描侧的签名同源。）
 */

/** 归纳判定：放行达到阈值且零用户拒绝 → 豁免。 */
export function decidesExemption(feature: Pick<LearnedFeature, "allowCount" | "denyCount">, threshold: number): boolean {
    return feature.denyCount === 0 && feature.allowCount >= Math.max(2, threshold);
}

/** 学习服务（index 装配；`isExempt` 是 pre-execute 热路径的同步查询）。 */
export interface LearnService {
    readonly db: LearnDb;
    /** 存储就绪（Flyway 迁移完成）；就绪前 record/recordApproval 排队、绝不丢。 */
    readonly ready: Promise<void>;
    /** 一次 ask 结算后记账：逐条目写事件 + 按焦点签名归纳。 */
    record(hits: readonly LearnHitInput[], verdict: string): void;
    /** 审批事件：弹窗即记、不论结果（T36；就绪前排队）。 */
    recordApproval(event: Omit<ApprovalEvent, "id">): void;
    /** 该签名是否已学为豁免（内存缓存）。 */
    isExempt(signature: string): boolean;
    features(): LearnedFeature[];
    removeFeature(shape: string): boolean;
    search(query: string, limit?: number): HitEvent[];
    close(): void;
}

/**
 * 创建学习服务：异步打开 `learn.sqlite3`（Flyway 迁移 + 查询连接，失败=
 * 不可用 stub，学习不持久）、加载归纳缓存。就绪前的记账进队列、就绪后
 * 统一补写（审批事件"弹窗即记"不因启动竞态丢失）；热路径（`isExempt`）零 SQL。
 */
export function createLearnService(dbPath: string, options: LearnOptions): LearnService {
    let db: LearnDb = UNAVAILABLE;
    const cache = new Map<string, LearnedFeature>();
    const pending: Array<() => void> = [];
    let ready = false;
    const flush = (): void => {
        ready = true;
        for (const op of pending.splice(0)) op();
    };
    const readyPromise: Promise<void> = openLearnDb(dbPath).then((opened) => {
        db = opened;
        for (const feature of db.features()) cache.set(feature.shape, feature);
        flush();
    }, () => {
        flush();
    });
    return {
        get db(): LearnDb {
            return db;
        },
        ready: readyPromise,
        record(hits, verdict) {
            const op = (): void => {
                // 开关关闭或持久层不可用（损坏/缺 node:sqlite）都不学习 ——
                // fail-safe：学习状态不完整时回到保守询问，绝不半学半用。
                if (options.enabled() !== true || !db.available) return;
                const at = Date.now();
                for (const hit of hits) {
                    db.recordHit({...hit, at, verdict});
                }
            // 归纳：逐签名去重（一次裁决内同签名只计一次）；方向锁过滤
            //（abs-path/硬路径不可学）。逐目标审批后一次 ask 通常单目标，
            // 其判决归因天然干净。
            const seen = new Set<string>();
            for (const hit of hits) {
                if (!isLearnable(hit.shapeSig, hit.token) || seen.has(hit.shapeSig)) continue;
                seen.add(hit.shapeSig);
                const prior = cache.get(hit.shapeSig) ?? {
                    shape: hit.shapeSig,
                    allowCount: 0,
                    denyCount: 0,
                    timeoutCount: 0,
                    exempt: false,
                    updatedAt: at
                };
                const kind = verdictClass(verdict);
                const next: LearnedFeature = {
                    shape: prior.shape,
                    allowCount: prior.allowCount + (kind === "allow" ? 1 : 0),
                    // 用户拒绝是唯一负样本：计数 + 立即回撤豁免。
                    denyCount: prior.denyCount + (kind === "user-deny" ? 1 : 0),
                    timeoutCount: prior.timeoutCount + (kind === "other-deny" ? 1 : 0),
                    exempt: kind === "user-deny" ? false : prior.exempt || (kind === "allow" && decidesExemption({
                        allowCount: prior.allowCount + 1,
                        denyCount: prior.denyCount
                    }, options.threshold())),
                    updatedAt: at
                };
                cache.set(next.shape, next);
                db.writeFeature(next);
            }
            db.prune(at - options.retentionDays() * 86_400_000);
            };
            if (ready) op(); else pending.push(op);
        },
        recordApproval(event) {
            const op = (): void => {
                if (!db.available) return;
                db.recordApproval(event);
            };
            if (ready) op(); else pending.push(op);
        },
        isExempt(signature) {
            return cache.get(signature)?.exempt === true;
        },
        features() {
            return [...cache.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        },
        removeFeature(shape) {
            cache.delete(shape);
            return db.removeFeature(shape);
        },
        search(query, limit = 50) {
            return db.search(query, limit);
        },
        close() {
            db.close();
        }
    };
}
