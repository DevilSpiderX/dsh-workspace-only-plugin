/**
 * 会话级白名单的文件持久化（T25）：每条 `{session, dir}` 会话级条目存到
 * `<DSH_HOME>/dsh-workspace-only-plugin/sessions/<rootSessionId>/whitelist.json`，
 * 而不是插件 Config 的 `always`（配置只保留全局字符串条目）。`rootSessionId`
 * 是授权会话的血缘根（主会话 id，T20 语义不变）：主会话及其所有子代理/fork
 * 共享同一个文件，不同主会话互相隔离。
 *
 * 文件形状（versioned，向后兼容的宽松读取）：
 *   { "version": 1, "dirs": ["C:\\data\\", "/var/data/"] }
 *
 * 失败方向一律 fail-closed（收紧 = 多问一次）：文件缺失、JSON 损坏、形状不对
 * 都按空列表处理；会话 id 不合法（可被用来做路径逃逸的形态）拒绝写入，由调用方
 * 回退成「仅此一次」。写入按会话串行（promise 链），防并发授权互相覆盖。
 */
import {readdirSync, readFileSync} from "node:fs";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {resolveDshHome} from "./scanner.js";

/** 文件布局常量。 */
const PLUGIN_DIR = "dsh-workspace-only-plugin";
const SESSIONS_DIR = "sessions";
const WHITELIST_FILE = "whitelist.json";
const WHITELIST_VERSION = 1;

/**
 * 会话 id 允许当目录名的判定：非空、不是 `.`/`..`，且不含路径分隔符、
 * 盘符冒义与 Windows 非法文件名字符、控制字符。id 由平台产生（uuid/短 id
 * 形态），这里只挡路径逃逸与跨平台非法名，不设白名单以免误拒真实 id。
 */
function isSafeSessionId(rootId) {
    if (typeof rootId !== "string" || rootId === "" || rootId === "." || rootId === "..") return false;
    // 路径分隔符、盘符冒义、Windows 非法文件名字符与控制字符。
    return !/[\\/:*?"<>|\u0000-\u001f]/.test(rootId);
}

/**
 * `<DSH_HOME>/dsh-workspace-only-plugin/sessions`。home 与内置默认白名单
 * 同源（`resolveDshHome`，每次实时解析）；后续拼接是真实 fs 路径，按宿主
 * `path` 语义（开发机 Windows 上与 home 形态一致）。
 */
function sessionsRoot() {
    return join(resolveDshHome(), PLUGIN_DIR, SESSIONS_DIR);
}

/** 单个会话的 `whitelist.json` 路径；id 不合法返回 `undefined`。 */
export function whitelistPathOf(rootId) {
    if (!isSafeSessionId(rootId)) return void 0;
    return join(sessionsRoot(), rootId, WHITELIST_FILE);
}

/** 宽松解析文件内容：只认 `{ dirs: string[] }`，其余形状一律按空处理。 */
function parseWhitelist(text) {
    try {
        const parsed = JSON.parse(text);
        const dirs = parsed !== null && typeof parsed === "object" ? parsed.dirs : void 0;
        return Array.isArray(dirs) ? dirs.filter((dir) => typeof dir === "string" && dir !== "") : [];
    } catch {
        return [];
    }
}

/**
 * 同步读一个会话的白名单目录列表。缺失/损坏/非法 id 都返回 `[]`
 * （fail-closed：条目丢了只会多问，不会少问）。门禁路径每次判定实时读，
 * 因此手工编辑的文件立即生效。
 */
export function readSessionDirs(rootId) {
    const path = whitelistPathOf(rootId);
    if (path === void 0) return [];
    try {
        return parseWhitelist(readFileSync(path, "utf8"));
    } catch {
        return [];
    }
}

/**
 * 扫描全部会话的白名单条目（`[{session, dir}]`），供管理快照全量展示。
 * `sessions/` 目录不存在或不可读时返回 `[]`。
 */
export function readAllSessionEntries() {
    let dirents;
    try {
        dirents = readdirSync(sessionsRoot(), {withFileTypes: true});
    } catch {
        return [];
    }
    const entries = [];
    for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const rootId = dirent.name;
        if (!isSafeSessionId(rootId)) continue;
        for (const dir of readSessionDirs(rootId)) entries.push({session: rootId, dir});
    }
    return entries;
}

/** 每会话一条写链：同会话的读改写串行，防并发授权互相覆盖。 */
const writeChains = new Map();

function serialized(rootId, task) {
    const previous = writeChains.get(rootId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const kept = run.then(() => void 0, () => void 0);
    writeChains.set(rootId, kept);
    kept.then(() => {
        if (writeChains.get(rootId) === kept) writeChains.delete(rootId);
    });
    return run;
}

/** 写回整份目录列表（在 {@link serialized} 任务里调用）。 */
async function writeDirs(rootId, dirs) {
    const path = whitelistPathOf(rootId);
    if (path === void 0) throw new Error(`[workspace-only] unsafe session id for whitelist file: ${rootId}`);
    await mkdir(dirname(path), {recursive: true});
    const body = JSON.stringify({version: WHITELIST_VERSION, dirs}, null, 2) + "\n";
    await writeFile(path, body, "utf8");
}

/**
 * 向会话白名单追加一个目录（幂等去重）。非法 id 或写失败向上抛 ——
 * 调用方（ask 的 grant）回退成「仅此一次」并告警。
 *
 * @returns 写入后的目录列表。
 */
export function addSessionDir(rootId, dir) {
    return serialized(rootId, async () => {
        const next = [...new Set([...readSessionDirs(rootId), dir])];
        await writeDirs(rootId, next);
        return next;
    });
}

/**
 * 从会话白名单移除一个目录。文件里没有该条目时仍重写（幂等）。
 *
 * @returns 移除后的目录列表。
 */
export function removeSessionDir(rootId, dir) {
    return serialized(rootId, async () => {
        const next = readSessionDirs(rootId).filter((item) => item !== dir);
        await writeDirs(rootId, next);
        return next;
    });
}

/**
 * 把一批目录并入会话白名单（迁移用），去重后一次写回。
 *
 * @returns 合并后的目录列表。
 */
export function mergeSessionDirs(rootId, dirs) {
    return serialized(rootId, async () => {
        const next = [...new Set([...readSessionDirs(rootId), ...dirs])];
        await writeDirs(rootId, next);
        return next;
    });
}
