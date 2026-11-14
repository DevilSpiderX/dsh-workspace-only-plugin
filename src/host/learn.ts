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
import type {ApprovalEvent, GroupMatcher, HitEvent, LearnDb, LearnedFeature, LearnedPolicy, LlmGroupRule} from "./learn-db.ts";
import {hasHardPathShape, shapeSignature} from "./shell-syntax.ts";

export {shapeSignature};

/** 学习层的配置读取面（`Config` 的字段，index 装配时注入）。 */
export interface LearnOptions {
    /** `Config.learnFromDecisions`：总开关。 */
    readonly enabled: () => boolean;
    /** `Config.learnThreshold`：自动豁免的放行阈值。 */
    readonly threshold: () => number;
    /** `Config.learnRetentionDays`：事件保留天数（压实）。 */
    readonly retentionDays: () => number;
    /**
     * `Config.autoApproveFromHistory`：**学习结果自动审批总闸**（T39 加、T40 扩义）——
     * false 时 `isExempt`（L1 形态豁免）与 `shouldAutoApprove`（L2 意图自动通过）
     * 一律 false=照常弹窗，而 record/recordPolicy 归纳照常（继续学习是硬需求）。
     */
    readonly autoApprove: () => boolean;
    /** `Config.autoApproveThreshold`：L2 自动通过的合成置信阈值（T39）。 */
    readonly autoApproveThreshold: () => number;
    /** `Config.autoApproveMinSamples`：L2 自动通过的最少用户表态样本（T39）。 */
    readonly autoApproveMinSamples: () => number;
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

// ============================ T39 L2：审批意图层 ============================

/** 一次意图判定/记账的输入（工具、归一命令名、目标目录）。 */
export interface PolicyInput {
    readonly tool: string;
    readonly commandName: string;
    readonly dir: string;
}

/** 分层特征键的一层（键文本 + 层号 1-4）。 */
export interface PolicyKey {
    readonly featureKey: string;
    readonly layer: number;
}

/** 层权重（计划定值：K1 0.4 / K2 0.3 / K3 0.2 / K4 0.1，和为 1）。 */
const POLICY_LAYER_WEIGHTS = [0.4, 0.3, 0.2, 0.1] as const;

/**
 * 分层特征键（T39）：K1=`tool|commandName|dir`、K2=`tool|commandName`、
 * K3=`tool|dir`、K4=`tool`。键是唯一标识、不做解析；值保持原样
 * （大小写语义由各来源自行归一）。
 */
export function policyFeatureKeys(tool: string, commandName: string, dir: string): PolicyKey[] {
    return [
        {featureKey: `${tool}|${commandName}|${dir}`, layer: 1},
        {featureKey: `${tool}|${commandName}`, layer: 2},
        {featureKey: `${tool}|${dir}`, layer: 3},
        {featureKey: tool, layer: 4}
    ];
}

/**
 * glob 匹配（`*` 任意串含空串、`?` 单字符；大小写不敏感）。手工双指针、
 * 无正则——避免 ReDoS 与 `.*` 回溯（LLM 产物是不可信输入）。
 */
export function globMatch(pattern: string, value: string): boolean {
    const p = pattern.toLowerCase();
    const v = value.toLowerCase();
    let pi = 0;
    let vi = 0;
    let star = -1;
    let mark = 0;
    while (vi < v.length) {
        if (pi < p.length && (p[pi] === "?" || p[pi] === v[vi])) {
            pi += 1;
            vi += 1;
        } else if (pi < p.length && p[pi] === "*") {
            star = pi;
            mark = vi;
            pi += 1;
        } else if (star >= 0) {
            pi = star + 1;
            mark += 1;
            vi = mark;
        } else {
            return false;
        }
    }
    while (pi < p.length && p[pi] === "*") pi += 1;
    return pi === p.length;
}

/** 组规则匹配（T39）：空串维度=不限；`*` 通配可匹配空串。 */
export function matchesGroupRule(matcher: GroupMatcher, input: PolicyInput): boolean {
    return (matcher.tool === "" || globMatch(matcher.tool, input.tool))
        && (matcher.command === "" || globMatch(matcher.command, input.commandName))
        && (matcher.dir === "" || globMatch(matcher.dir, input.dir));
}

/** {@link decidesAutoApprove} 的输入（纯函数面，verify-learn 直测）。 */
export interface AutoApproveParams {
    /** K1-K4 四层的键（`policyFeatureKeys` 产物）。 */
    readonly keys: readonly PolicyKey[];
    readonly policies: ReadonlyMap<string, LearnedPolicy>;
    readonly groups: readonly LlmGroupRule[];
    readonly input: PolicyInput;
    readonly threshold: number;
    readonly minSamples: number;
}

/**
 * L2 自动通过判定（T39）——三条件同时满足才放行，任何不确定= false
 * （fail-closed：回到弹窗）：
 *
 * 1. **deny 一票否决**：精确键（K1）`deny_count>0` 或 `active=false`
 *    （被拒回撤过）→ 否；任一命中组 `deny_count>0` → 否（组 deny 传染，
 *    整组否决——被拒过的命令变体不能被 LLM 归并救回来）。K2-K4 的 deny
 *    不牵连无辜组合，只经 β 放行率稀释置信（同工具/同命令有拒绝 →
 *    自动通过变慢）。
 * 2. **样本闸门**：K1 用户表态样本（含命中组先验）≥ minSamples。
 * 3. **合成置信**：各层 β 平滑放行率 (allow+1)/(sample+2) 按层权重
 *    （0.4/0.3/0.2/0.1）合成 ≥ threshold；命中组时 K1 层以组聚合**替代**
 *    本键计数（组计数是 tidy 侧实算的精确样本聚合、含本键，叠加会
 *    重复计数；组先验因此也能喂饱新变体的样本闸门）。
 *
 * 训练样本只含用户真实表态（`auto-approved` 不回流，`recordPolicy` 侧），
 * 防自我强化。
 */
export function decidesAutoApprove(params: AutoApproveParams): boolean {
    // 命中组聚合 + deny 传染（整组一票否决）。
    let matched = false;
    let groupSample = 0;
    let groupAllow = 0;
    for (const rule of params.groups) {
        if (rule.active !== true || !matchesGroupRule(rule.matcher, params.input)) continue;
        if (rule.denyCount > 0) return false;
        matched = true;
        groupSample += rule.sampleCount;
        groupAllow += rule.allowCount;
    }
    let confidence = 0;
    for (const key of params.keys) {
        const policy = params.policies.get(key.featureKey);
        const isK1 = key.layer === 1;
        const sample = isK1 && matched ? groupSample : (policy?.sampleCount ?? 0);
        const allow = isK1 && matched ? groupAllow : (policy?.allowCount ?? 0);
        const deny = policy?.denyCount ?? 0;
        if (isK1) {
            // 精确键被拒过/回撤过 → 永久不能自动通过（除非重置/删除）。
            if (deny > 0 || policy?.active === false) return false;
            if (sample < params.minSamples) return false;
        }
        confidence += POLICY_LAYER_WEIGHTS[key.layer - 1] * (allow + 1) / (sample + 2);
    }
    return confidence >= params.threshold;
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
    /** L2 意图记账（T39）：一次审批结算按 K1-K4 计数；`auto-approved`
     *  是学习产物输出、**绝不回流训练**（防自我强化）。就绪前排队。 */
    recordPolicy(input: PolicyInput, verdict: string): void;
    /** L2 自动通过判定（T39；内存缓存热路径，零 SQL）。开关关/存储不可用/
     *  任何不确定 → false=弹窗（fail-closed）。 */
    shouldAutoApprove(input: PolicyInput): boolean;
    /** 该签名是否已学为豁免（内存缓存）。 */
    isExempt(signature: string): boolean;
    features(): LearnedFeature[];
    removeFeature(shape: string): boolean;
    /** 删除一条审批意图策略（Remote 管理面；缓存同步）。 */
    removePolicy(featureKey: string): boolean;
    search(query: string, limit?: number): HitEvent[];
    /** 从存储重载策略/组规则缓存（LLM 整理产物落库后调用）。 */
    reload(): void;
    /** 重置全部学习数据（T39 设置页按钮）：清库 + 清缓存。 */
    resetLearnData(): boolean;
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
    const policyCache = new Map<string, LearnedPolicy>();
    let groupCache: LlmGroupRule[] = [];
    const pending: Array<() => void> = [];
    let ready = false;
    const flush = (): void => {
        ready = true;
        for (const op of pending.splice(0)) op();
    };
    const loadCaches = (): void => {
        policyCache.clear();
        for (const policy of db.policies()) policyCache.set(policy.featureKey, policy);
        groupCache = db.groupRules();
    };
    const readyPromise: Promise<void> = openLearnDb(dbPath).then((opened) => {
        db = opened;
        for (const feature of db.features()) cache.set(feature.shape, feature);
        loadCaches();
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
                // auto-approved 是学习产物的输出：事件照记、不回流训练统计
                //（L1 归纳与 L2 策略都不吃自己的产出，防自我强化）。
                if (verdict === "auto-approved") {
                    db.prune(at - options.retentionDays() * 86_400_000);
                    return;
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
        recordPolicy(input, verdict) {
            const op = (): void => {
                if (options.enabled() !== true || !db.available) return;
                // auto-approved 是学习产物的输出，绝不回流训练（防自我强化）。
                if (verdict === "auto-approved") return;
                const kind = verdictClass(verdict);
                // 只有用户真实表态（allow/user-deny）进策略样本；timeout 类
                // fail-closed 噪声不进计数（与 L1 的 timeoutCount 口径一致）。
                if (kind === "other-deny") return;
                const at = Date.now();
                for (const key of policyFeatureKeys(input.tool, input.commandName, input.dir)) {
                    const prior = policyCache.get(key.featureKey) ?? {
                        id: "",
                        featureKey: key.featureKey,
                        layer: key.layer,
                        tool: input.tool,
                        commandName: input.commandName,
                        dir: input.dir,
                        sampleCount: 0,
                        allowCount: 0,
                        denyCount: 0,
                        active: true,
                        source: "stat",
                        updatedAt: at
                    };
                    const next: LearnedPolicy = {
                        ...prior,
                        sampleCount: prior.sampleCount + 1,
                        allowCount: prior.allowCount + (kind === "allow" ? 1 : 0),
                        denyCount: prior.denyCount + (kind === "user-deny" ? 1 : 0),
                        // 用户拒绝立即回撤（active=false）；精确键再拒一票否决。
                        active: kind === "user-deny" ? false : prior.active,
                        updatedAt: at
                    };
                    policyCache.set(next.featureKey, next);
                    db.writePolicy(next);
                }
            };
            if (ready) op(); else pending.push(op);
        },
        shouldAutoApprove(input) {
            // 热路径同步判定；开关关/存储不可用/任何不确定 → false（弹窗）。
            if (options.autoApprove() !== true || !db.available) return false;
            return decidesAutoApprove({
                keys: policyFeatureKeys(input.tool, input.commandName, input.dir),
                policies: policyCache,
                groups: groupCache,
                input,
                threshold: options.autoApproveThreshold(),
                minSamples: options.autoApproveMinSamples()
            });
        },
        isExempt(signature) {
            // T40：自动审批总闸——关闸时 L1 形态豁免同样不作用（每次都询问），
            // 学习（record 归纳）不受影响；开关读取不确定按关处理（fail-closed）。
            if (options.autoApprove() !== true) return false;
            return cache.get(signature)?.exempt === true;
        },
        features() {
            return [...cache.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        },
        removeFeature(shape) {
            cache.delete(shape);
            return db.removeFeature(shape);
        },
        removePolicy(featureKey) {
            policyCache.delete(featureKey);
            return db.removePolicy(featureKey);
        },
        search(query, limit = 50) {
            return db.search(query, limit);
        },
        reload() {
            if (!ready || !db.available) return;
            loadCaches();
        },
        resetLearnData() {
            if (!db.available) return false;
            db.resetAll();
            cache.clear();
            policyCache.clear();
            groupCache = [];
            return true;
        },
        close() {
            db.close();
        }
    };
}
