/**
 * 会话级白名单孤儿目录清理（T31）。会话被删除后（转录物理移除——平台侧
 * 没有「已删除」事件，删除由 `@michengai/dsh-archive-manager` 等工具执行
 * `rm` 转录目录），`sessions/<rootId>/` 白名单目录会残留成垃圾。
 *
 * 判据：已知 id 集合 = `sessionQuery.listSessions()` 全部 `header.id` ∪
 * 全部 `header.parentSession` 值。这个并集**可证**覆盖一切可能的血缘根
 * 目录名（T20 白名单绑血缘根）：血缘链上每个节点要么是某 record 的 id、
 * 要么是某 record 的 parentSession（断链点），无需递归上溯。归档的会话
 * 仍在列表里（只是 `workspaceRegistry.archivedSessionIds` 标记）→ 保留；
 * 删除后转录物理移除、列表消失 → 清。精确满足「删除才清、归档不清」。
 *
 * 失败方向 fail-safe（与门禁的 fail-closed 互补：这里宁可留垃圾，绝不误删
 * 活数据；误删的后果也只是门禁多问几次）：
 * - `listSessions()` 失败/服务缺席 → 由调用方整轮跳过；
 * - 孤儿目录 mtime 在宽限期内 → 保留（兜「刚写白名单的新目录」竞态；
 *   `writeDirs` 重写 `whitelist.json` 会刷新 mtime）；
 * - 单项 stat/rm 失败 → 跳过该项，不中断整轮。
 *
 * 纯判定 + 可注入 root/now，`scripts/verify-session-cleanup.ts` 直测。
 */
import {readdir, rm, stat} from "node:fs/promises";
import {join} from "node:path";
import {sessionsRoot} from "./session-whitelist.ts";

/** `sessionQuery.listSessions()` 记录 header 的最小形状（防御性收窄）。 */
export interface SessionHeaderLike {
    readonly id?: unknown;
    readonly parentSession?: unknown;
}

/** 清理节奏：每 24 小时至多一轮（启动时先清一次）。 */
export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 孤儿目录 mtime 距今小于该宽限不删（兜新目录与并发授权竞态）。 */
export const PRUNE_GRACE_MS = 60 * 60 * 1000;

/**
 * 从会话 header 列表构造已知 id 集合：全部 `id` ∪ 全部 `parentSession`。
 * 空串/非字符串值忽略。集合里的 id 对应的 `sessions/<id>/` 目录一律保留。
 */
export function knownSessionIds(headers: readonly SessionHeaderLike[]): Set<string> {
    const ids = new Set<string>();
    for (const header of headers) {
        if (typeof header.id === "string" && header.id !== "") ids.add(header.id);
        if (typeof header.parentSession === "string" && header.parentSession !== "") ids.add(header.parentSession);
    }
    return ids;
}

/** 一轮清理的结果（供日志与直测断言）。 */
export interface PruneOutcome {
    /** 已删除的会话目录名（血缘根 id）。 */
    readonly pruned: string[];
    /** 保留的目录数（活跃、宽限期内或删除失败）。 */
    readonly kept: number;
    /** 根目录不可读时整轮跳过。 */
    readonly skipped: boolean;
}

/**
 * 扫描会话白名单根目录，删除不在 `knownIds` 里的孤儿会话目录（整个
 * `<rootId>/`，不只 `whitelist.json`——目录名即会话 id，会话没了整目录
 * 都是垃圾）。
 *
 * @param knownIds - 已知会话 id 集合（{@link knownSessionIds} 的产物）。
 * @param options - `root` 覆盖扫描根（默认 `<DSH_HOME>/.../sessions`）、
 *   `now`/`graceMs` 覆盖时间基准（直测用）。
 */
export async function pruneOrphanSessionDirs(
    knownIds: ReadonlySet<string>,
    options: {root?: string; now?: number; graceMs?: number} = {}
): Promise<PruneOutcome> {
    const root = options.root ?? sessionsRoot();
    const now = options.now ?? Date.now();
    const graceMs = options.graceMs ?? PRUNE_GRACE_MS;
    let dirents;
    try {
        dirents = await readdir(root, {withFileTypes: true});
    } catch {
        return {pruned: [], kept: 0, skipped: true};
    }
    const pruned: string[] = [];
    let kept = 0;
    for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const dir = join(root, dirent.name);
        if (knownIds.has(dirent.name)) {
            kept += 1;
            continue;
        }
        // 宽限期基准：whitelist.json 的 mtime（重写即刷新）；文件缺失退回
        // 目录 mtime；都取不到则保守保留。
        let mtimeMs: number | undefined;
        try {
            mtimeMs = (await stat(join(dir, "whitelist.json"))).mtimeMs;
        } catch {
            try {
                mtimeMs = (await stat(dir)).mtimeMs;
            } catch {
                mtimeMs = void 0;
            }
        }
        if (mtimeMs === void 0 || now - mtimeMs < graceMs) {
            kept += 1;
            continue;
        }
        try {
            await rm(dir, {recursive: true, force: true});
            pruned.push(dirent.name);
        } catch {
            kept += 1;
        }
    }
    return {pruned, kept, skipped: false};
}
