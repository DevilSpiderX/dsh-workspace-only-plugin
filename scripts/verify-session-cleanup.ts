/**
 * 会话白名单孤儿目录清理验证（任务 T31）。对 `src/host/session-cleanup.ts`
 * 直测：已知 id 集合构造（`id` ∪ `parentSession` 并集、空值过滤）与孤儿
 * 判定（活跃保留、老孤儿删除、宽限期内保留、无 `whitelist.json` 回退目录
 * mtime、非目录忽略、时间流逝后宽限孤儿出清、根缺失整轮跳过不抛错）。
 * 不需要部署或 DSH 运行时：
 *
 *   node scripts/verify-session-cleanup.ts
 */
import {existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {knownSessionIds, pruneOrphanSessionDirs} from "../src/host/session-cleanup.ts";

let total = 0;
let pass = 0;
function check(name: string, ok: boolean): void {
    total += 1;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

// --- knownSessionIds：id ∪ parentSession 并集（覆盖血缘根目录名，无需递归上溯） ---
const idsOf = (headers: {id?: unknown; parentSession?: unknown}[]): string[] => [...knownSessionIds(headers)].sort();

check("known 空列表 => 空集合", idsOf([]).length === 0);
check("known 仅 id", JSON.stringify(idsOf([{id: "a"}])) === JSON.stringify(["a"]));
check("known id 与 parentSession 并集", JSON.stringify(idsOf([{id: "child", parentSession: "root"}])) === JSON.stringify(["child", "root"]));
check("known 断链父 id 保留（母会话已删仍是白名单 key）", JSON.stringify(idsOf([{id: "c", parentSession: "gone"}])) === JSON.stringify(["c", "gone"]));
check("known 空串与非字符串忽略", idsOf([{id: "", parentSession: 123}, {id: null}]).length === 0);
check("known 多记录并集去重", JSON.stringify(idsOf([{id: "a", parentSession: "r"}, {id: "b", parentSession: "r"}])) === JSON.stringify(["a", "b", "r"]));

// --- pruneOrphanSessionDirs：临时树实测（now 注入，不依赖真实时钟） ---
const now = Date.now();
const oldTime = new Date(now - 2 * 60 * 60 * 1000);
const freshTime = new Date(now - 60 * 1000);
const root = mkdtempSync(join(tmpdir(), "wo-prune-"));
function seed(name: string, whitelist: "old" | "fresh" | "missing", dirMtime: "old" | "fresh"): void {
    const dir = join(root, name);
    mkdirSync(dir, {recursive: true});
    if (whitelist !== "missing") {
        const file = join(dir, "whitelist.json");
        writeFileSync(file, "{}");
        const at = whitelist === "old" ? oldTime : freshTime;
        utimesSync(file, at, at);
    }
    const dirAt = dirMtime === "old" ? oldTime : freshTime;
    utimesSync(dir, dirAt, dirAt);
}
seed("active", "old", "old");
seed("orphan-old", "old", "fresh");
seed("orphan-fresh", "fresh", "old");
seed("orphan-nofile-old", "missing", "old");
seed("orphan-nofile-fresh", "missing", "fresh");
writeFileSync(join(root, "loose-file.txt"), "x");

const outcome = await pruneOrphanSessionDirs(new Set(["active"]), {root, now});
check("pruned 恰为两个超宽限孤儿", JSON.stringify([...outcome.pruned].sort()) === JSON.stringify(["orphan-nofile-old", "orphan-old"]));
check("kept 计数 3（active + 两个宽限内）", outcome.kept === 3);
check("skipped = false", outcome.skipped === false);
check("超宽限孤儿目录已删除", !existsSync(join(root, "orphan-old")) && !existsSync(join(root, "orphan-nofile-old")));
check("活跃与宽限内目录保留", existsSync(join(root, "active")) && existsSync(join(root, "orphan-fresh")) && existsSync(join(root, "orphan-nofile-fresh")));

// 时间流逝超宽限 + 空集合：剩余孤儿（含曾宽限保留的）全部出清，活跃目录不存活
const later = await pruneOrphanSessionDirs(new Set(), {root, now: now + 2 * 60 * 60 * 1000});
check("二轮空集合清掉全部剩余目录", JSON.stringify([...later.pruned].sort()) === JSON.stringify(["active", "orphan-fresh", "orphan-nofile-fresh"]));
check("二轮后根下只剩非目录文件", existsSync(join(root, "loose-file.txt")) && !existsSync(join(root, "active")));

const missing = await pruneOrphanSessionDirs(new Set(), {root: join(root, "no-such-dir"), now});
check("根缺失 => skipped=true 不抛错", missing.skipped === true && missing.pruned.length === 0 && missing.kept === 0);

rmSync(root, {recursive: true, force: true});
console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
