/**
 * 无感学习层的持久化底座：`learn.sqlite3`（`node:sqlite` 的 `DatabaseSync` +
 * **Drizzle ORM** 的 `node-sqlite` driver，查询与 schema 全部类型安全）。
 *
 * 为什么是 SQLite + Drizzle（评估结论）：学习统计是**事件级细粒度**
 * （每次命中 × 判决一行，用久了万级+），且需要模糊搜索/时间窗聚合 ——
 * 正是 SQL 的强项；Drizzle 的 `sqliteCore` schema 让表结构与查询保持
 * 类型一致，`onConflictDoUpdate` 等 upsert 语义直接可表达。
 * `node:sqlite` 是 Node 内置模块（22.13+ 无需实验 flag；dsh 宿主的
 * `session-query-sqlite`/`storage-sqlite` 同款底座）。
 *
 * 依赖形态：`drizzle-orm` 是正式运行时依赖（`dependencies`），由 vite 打进
 * `lib/` 产物（external 白名单只有 `node:` 与 `@deepseek-ai/*`）——插件安装
 * 走 git 源不跑 install，运行时依赖必须随产物分发。
 *
 * 失败方向 fail-safe：`node:sqlite`/drizzle/迁移器加载失败、迁移失败或
 * db 打不开/损坏 → 返回不可用 stub（学习不持久、门禁照常保守询问）。
 * 学习层是优化器，门禁的 fail-closed 正确性**从不**依赖它。
 *
 * schema 演进走 **Flyway 式迁移**（`@wuyuchentr/database-migration-tool`）：
 * 版本化 SQL 文件（`migrations/<timestamp>_<name>.up.sql`/`.down.sql`）+
 * `_migrations` 历史表，启动时应用 pending 迁移；破坏性约定落在迁移
 * 文件内容里（允许 DROP 重建、不做数据迁移）。
 */
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {desc, eq, like, lt, or} from "drizzle-orm";
import {drizzle} from "drizzle-orm/node-sqlite";
import {integer, sqliteTable, text} from "drizzle-orm/sqlite-core";
import {Migrator} from "@wuyuchentr/database-migration-tool";
import {uuidv7} from "./uuid.ts";

/** 一次命中 × 判决的事件行（细粒度统计的底座）。 */
export interface HitEvent {
    /** 主键：uuidv7（时间有序；AGENTS.md「数据库 id 一律 uuidv7」条目）。 */
    readonly id: string;
    readonly at: number;
    readonly tool: string;
    readonly command: string;
    readonly token: string;
    /** 归纳键（形态签名，见 `learn.ts`）。 */
    readonly shapeSig: string;
    /** token 所属命令的归一名（空串=不可知；老行为 NULL）。 */
    readonly commandName: string;
    readonly role: string;
    readonly shape: string | null;
    readonly hitReason: string;
    readonly isFocus: boolean;
    /** dsh 会话 id。 */
    readonly sessionId: string;
    /** `once`/`always`/`user-denied`/`user-rejected`/`timeout`/`no-channel`/`cancelled`。 */
    readonly verdict: string;
}

/** 归纳产物行：一个形态签名的判决统计与豁免标记。 */
export interface LearnedFeature {
    readonly shape: string;
    readonly allowCount: number;
    readonly denyCount: number;
    /** 超时/无应答类 deny 的计数（**不计学习负样本**，仅观察）。 */
    readonly timeoutCount: number;
    readonly exempt: boolean;
    readonly updatedAt: number;
}

/** 审批事件行（T36）：**每次弹窗一行**，不论最终通过与否，供事后分析。 */
export interface ApprovalEvent {
    /** 主键：uuidv7（时间有序）。 */
    readonly id: string;
    readonly at: number;
    readonly tool: string;
    readonly command: string;
    readonly dir: string;
    readonly reason: string;
    /** 本次 ask 的全部命中目标（JSON 数组文本，截断存储）。 */
    readonly targets: string;
    readonly sensitive: boolean;
    /** `once`/`always`/`user-denied`/`user-rejected`/`timeout`/`no-channel`/`cancelled`。 */
    readonly verdict: string;
    readonly channel: string;
    /** 从触发到裁决的毫秒数。 */
    readonly ms: number;
    readonly sessionId: string;
}

/** 事件表（Drizzle schema，列名与 DDL 一一对应；id 主键 = uuidv7）。 */
const hitEvents = sqliteTable("hit_events", {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    tool: text("tool").notNull(),
    command: text("command"),
    token: text("token").notNull(),
    shapeSig: text("shape_sig").notNull(),
    commandName: text("command_name"),
    role: text("role").notNull(),
    shape: text("shape"),
    hitReason: text("hit_reason").notNull(),
    isFocus: integer("is_focus").notNull(),
    sessionId: text("session_id"),
    verdict: text("verdict").notNull()
});

/** 归纳表（Drizzle schema；id 主键 = uuidv7，shape 是 upsert 的业务唯一键）。 */
const learnedExemptions = sqliteTable("learned_exemptions", {
    id: text("id").primaryKey(),
    shape: text("shape").notNull().unique(),
    allowCount: integer("allow_count").notNull().default(0),
    denyCount: integer("deny_count").notNull().default(0),
    timeoutCount: integer("timeout_count").notNull().default(0),
    exempt: integer("exempt").notNull().default(0),
    updatedAt: integer("updated_at").notNull()
});

/** 审批事件表（Drizzle schema，T36：弹窗即记、不论结果；id 主键 = uuidv7）。 */
const approvalEvents = sqliteTable("approval_events", {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    tool: text("tool").notNull(),
    command: text("command"),
    dir: text("dir").notNull(),
    reason: text("reason"),
    targets: text("targets"),
    sensitive: integer("sensitive").notNull().default(0),
    verdict: text("verdict").notNull(),
    channel: text("channel").notNull(),
    ms: integer("ms").notNull(),
    sessionId: text("session_id")
});

/** 存储面（`learn.ts` 消费；不可用 stub 与真实现同形）。id 由存储层生成（uuidv7）。 */
export interface LearnDb {
    readonly available: boolean;
    recordHit(event: Omit<HitEvent, "id">): void;
    /** 审批事件：弹窗即记、不论结果（T36）。 */
    recordApproval(event: Omit<ApprovalEvent, "id">): void;
    features(): LearnedFeature[];
    /** 归纳写回（upsert 统计列与豁免标记）。 */
    writeFeature(feature: LearnedFeature): void;
    removeFeature(shape: string): boolean;
    search(query: string, limit: number): HitEvent[];
    /** 审批事件的模糊搜索（工具/命令/目录/原因）。 */
    searchApprovals(query: string, limit: number): ApprovalEvent[];
    /** 事件保留期压实（`at` 早于 `olderThanMs` 的行删除）。 */
    prune(olderThanMs: number): void;
    close(): void;
}

/** 不可用 stub：一切操作静默成功/空集 —— 学习不持久，门禁不受影响。 */
export const UNAVAILABLE: LearnDb = {
    available: false,
    recordHit: () => {
    },
    recordApproval: () => {
    },
    features: () => [],
    writeFeature: () => {
    },
    removeFeature: () => false,
    search: () => [],
    searchApprovals: () => [],
    prune: () => {
    },
    close: () => {
    }
};

/** `node:sqlite` 的 `DatabaseSync` 最小形状（PRAGMA/DDL 面，按用到的收窄）。 */
interface RawSqlite {
    exec(sql: string): void;
    prepare(sql: string): {get(...params: Array<unknown>): Record<string, unknown> | undefined};
    close(): void;
}

/**
 * 定位 `migrations/`（版本化 SQL，随包分发）：源码直跑（`src/host/`）与
 * 产物（`lib/`）两种布局都找，向上最多四级。
 */
function migrationsDir(): string | undefined {
    let dir = fileURLToPath(new URL(".", import.meta.url));
    for (let depth = 0; depth < 4; depth += 1) {
        if (existsSync(join(dir, "migrations", "0001_init.up.sql"))) return join(dir, "migrations");
        const parent = join(dir, "..");
        if (parent === dir) break;
        dir = parent;
    }
    return void 0;
}

/**
 * 打开（或创建）学习库。任何失败（`node:sqlite`/drizzle 缺席、迁移失败、
 * db 损坏）都返回 {@link UNAVAILABLE} —— fail-safe：宁可失去学习，
 * 绝不影响门禁。
 *
 * schema 演进走 Flyway 式迁移（`migrations/` 版本化 SQL + `_migrations`
 * 历史表，启动时应用 pending 迁移）；破坏性约定写在迁移文件内容里。
 */
export async function openLearnDb(path: string): Promise<LearnDb> {
    // 1) 迁移（独立连接，跑完即关，与下方查询连接串行）。
    try {
        const directory = migrationsDir();
        if (directory === void 0) return UNAVAILABLE;
        const migrator = new Migrator({driver: "sqlite", database: path, directory, table: "_migrations"});
        await migrator.connect();
        await migrator.up();
        await migrator.disconnect();
    } catch {
        return UNAVAILABLE;
    }
    // 2) 查询连接（Drizzle + node:sqlite；失败=UNAVAILABLE）。
    let raw: RawSqlite | undefined;
    try {
        const nodeRequire = createRequire(import.meta.url);
        const sqlite = nodeRequire("node:sqlite") as {DatabaseSync: new (path: string) => RawSqlite};
        raw = new sqlite.DatabaseSync(path);
        raw.exec("PRAGMA journal_mode = WAL;");
    } catch {
        try {
            raw?.close();
        } catch {
            // 关闭失败无所谓，直接走降级。
        }
        return UNAVAILABLE;
    }
    const client = raw;
    const db = drizzle({client: client as never});
    return {
        available: true,
        recordHit(event) {
            try {
                db.insert(hitEvents).values({
                    id: uuidv7(),
                    at: event.at,
                    tool: event.tool,
                    command: event.command.slice(0, 2048),
                    token: event.token.slice(0, 512),
                    shapeSig: event.shapeSig,
                    commandName: event.commandName.slice(0, 256),
                    role: event.role,
                    shape: event.shape,
                    hitReason: event.hitReason,
                    isFocus: event.isFocus ? 1 : 0,
                    sessionId: event.sessionId,
                    verdict: event.verdict
                }).run();
            } catch {
                // 单行写失败只丢这一条统计。
            }
        },
        recordApproval(event) {
            try {
                db.insert(approvalEvents).values({
                    id: uuidv7(),
                    at: event.at,
                    tool: event.tool,
                    command: event.command.slice(0, 4096),
                    dir: event.dir,
                    reason: event.reason.slice(0, 2048),
                    targets: event.targets.slice(0, 4096),
                    sensitive: event.sensitive ? 1 : 0,
                    verdict: event.verdict,
                    channel: event.channel,
                    ms: event.ms,
                    sessionId: event.sessionId
                }).run();
            } catch {
                // 单行写失败只丢这一条事件。
            }
        },
        features() {
            try {
                return db.select().from(learnedExemptions).all().map((row) => ({
                    shape: row.shape,
                    allowCount: row.allowCount,
                    denyCount: row.denyCount,
                    timeoutCount: row.timeoutCount,
                    exempt: row.exempt === 1,
                    updatedAt: row.updatedAt
                }));
            } catch {
                return [];
            }
        },
        writeFeature(feature) {
            try {
                db.insert(learnedExemptions).values({
                    id: uuidv7(),
                    shape: feature.shape,
                    allowCount: feature.allowCount,
                    denyCount: feature.denyCount,
                    timeoutCount: feature.timeoutCount,
                    exempt: feature.exempt ? 1 : 0,
                    updatedAt: feature.updatedAt
                }).onConflictDoUpdate({
                    target: learnedExemptions.shape,
                    set: {
                        allowCount: feature.allowCount,
                        denyCount: feature.denyCount,
                        timeoutCount: feature.timeoutCount,
                        exempt: feature.exempt ? 1 : 0,
                        updatedAt: feature.updatedAt
                    }
                }).run();
            } catch {
                // 写回失败下轮重新归纳。
            }
        },
        removeFeature(shape) {
            try {
                const existing = db.select().from(learnedExemptions).where(eq(learnedExemptions.shape, shape)).get();
                db.delete(learnedExemptions).where(eq(learnedExemptions.shape, shape)).run();
                return existing !== void 0;
            } catch {
                return false;
            }
        },
        search(query, limit) {
            try {
                const needle = `%${query.replace(/[%_]/g, " ")}%`;
                return db.select().from(hitEvents)
                    .where(or(likeToken(needle), likeCommand(needle), likeShape(needle)))
                    .orderBy(desc(hitEvents.at))
                    .limit(Math.max(1, Math.min(limit, 500)))
                    .all()
                    .map((row) => ({
                        id: String(row.id),
                        at: row.at,
                        tool: row.tool,
                        command: row.command ?? "",
                        token: row.token,
                        shapeSig: row.shapeSig,
                        commandName: row.commandName ?? "",
                        role: row.role,
                        shape: row.shape,
                        hitReason: row.hitReason,
                        isFocus: row.isFocus === 1,
                        sessionId: row.sessionId ?? "",
                        verdict: row.verdict
                    }));
            } catch {
                return [];
            }
        },
        searchApprovals(query, limit) {
            try {
                const needle = `%${query.replace(/[%_]/g, " ")}%`;
                return db.select().from(approvalEvents)
                    .where(or(like(approvalEvents.tool, needle), like(approvalEvents.command, needle), like(approvalEvents.dir, needle), like(approvalEvents.reason, needle), like(approvalEvents.verdict, needle)))
                    .orderBy(desc(approvalEvents.at))
                    .limit(Math.max(1, Math.min(limit, 500)))
                    .all()
                    .map((row) => ({
                        id: String(row.id),
                        at: row.at,
                        tool: row.tool,
                        command: row.command ?? "",
                        dir: row.dir,
                        reason: row.reason ?? "",
                        targets: row.targets ?? "[]",
                        sensitive: row.sensitive === 1,
                        verdict: row.verdict,
                        channel: row.channel,
                        ms: row.ms,
                        sessionId: row.sessionId ?? ""
                    }));
            } catch {
                return [];
            }
        },
        prune(olderThanMs) {
            try {
                db.delete(hitEvents).where(lt(hitEvents.at, olderThanMs)).run();
                db.delete(approvalEvents).where(lt(approvalEvents.at, olderThanMs)).run();
            } catch {
                // 压实失败下轮再来。
            }
        },
        close() {
            try {
                client.close();
            } catch {
                // 已关或已损坏。
            }
        }
    };
}

// 搜索谓词（拆成小函数保持可读）。
const likeToken = (pattern: string) => like(hitEvents.token, pattern);
const likeCommand = (pattern: string) => like(hitEvents.command, pattern);
const likeShape = (pattern: string) => like(hitEvents.shapeSig, pattern);
