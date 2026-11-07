/**
 * 无感学习层验证：判决分类、形态签名、归纳/回撤闭环、fail-safe 降级。
 * 直测 `src/host/learn.ts` + `learn-db.ts`（临时 sqlite 库），不依赖
 * 构建与本机 dsh：
 *
 *   node scripts/verify-learn.ts
 */
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Migrator} from "@wuyuchentr/database-migration-tool";
import {createLearnService, decidesExemption, shapeSignature, verdictClass} from "../src/host/learn.ts";
import type {LearnHitInput} from "../src/host/learn.ts";
import {UUIDV7_PATTERN} from "../src/host/uuid.ts";

let pass = 0;
let total = 0;
const check = (name: string, ok: boolean, detail?: string): void => {
    total += 1;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === void 0 ? "" : `  => ${detail}`}`);
};

// --- 判决分类：只有 user-denied/user-rejected 是学习负样本 ---
check("verdict once => allow", verdictClass("once") === "allow");
check("verdict always => allow", verdictClass("always") === "allow");
check("verdict user-denied => user-deny", verdictClass("user-denied") === "user-deny");
check("verdict user-rejected => user-deny", verdictClass("user-rejected") === "user-deny");
check("verdict timeout => other-deny（不计负样本）", verdictClass("timeout") === "other-deny");
check("verdict no-channel => other-deny（不计负样本）", verdictClass("no-channel") === "other-deny");
check("verdict cancelled => other-deny（不计负样本）", verdictClass("cancelled") === "other-deny");

// --- 形态签名：判别维度全保留 ---
check("signature keeps dimensions", shapeSignature({tool: "bash", role: "pattern-arg", shape: "regex-literal", quote: "single"}) === "bash|pattern-arg|regex-literal|single");
check("signature null shape => plain", shapeSignature({tool: "pwsh", role: "arg", shape: null, quote: "none"}) === "pwsh|arg|plain|none");

// --- 归纳判定 ---
check("exempt at threshold with zero deny", decidesExemption({allowCount: 3, denyCount: 0}, 3));
check("not exempt below threshold", !decidesExemption({allowCount: 2, denyCount: 0}, 3));
check("not exempt with any user deny", !decidesExemption({allowCount: 9, denyCount: 1}, 3));
check("threshold floor is 2", decidesExemption({allowCount: 2, denyCount: 0}, 1));

const dir = mkdtempSync(join(tmpdir(), "dsh-learn-verify-"));
const hit = (over: Partial<LearnHitInput> = {}): LearnHitInput => ({
    tool: "bash",
    command: "awk '/^\\// {print}'",
    token: "/^\\//",
    shapeSig: "bash|pattern-arg|regex-literal|single",
    role: "pattern-arg",
    shape: "regex-literal",
    hitReason: "outside",
    isFocus: true,
    sessionId: "sess-learn",
    ...over
});

// --- 闭环：放行到阈值自动豁免；用户拒绝立即回撤；超时只观察不回撤 ---
{
    const service = createLearnService(join(dir, "learn.sqlite3"), {enabled: () => true, threshold: () => 3, retentionDays: () => 90});
    await service.ready;
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("below threshold still asks", !service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.record([hit()], "once");
    check("threshold reached => exempt", service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.record([hit()], "timeout");
    check("timeout keeps exemption（观察不回撤）", service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.record([hit()], "user-denied");
    check("user deny revokes exemption", !service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("deny history blocks re-exemption", !service.isExempt("bash|pattern-arg|regex-literal|single"));
    const features = service.features();
    const feature = features.find((item) => item.shape === "bash|pattern-arg|regex-literal|single");
    check("feature counters", feature !== void 0 && feature.allowCount === 7 && feature.denyCount === 1 && feature.timeoutCount === 1, JSON.stringify(feature));
    check("search finds events", service.search("awk").length > 0);
    check("search by signature", service.search("pattern-arg").length > 0);
    const rows = service.search("awk", 5);
    check("hit id is uuidv7 and session preserved", rows.every((row) => UUIDV7_PATTERN.test(row.id)) && rows.every((row) => row.sessionId === "sess-learn"), JSON.stringify(rows.map((row) => [row.id, row.sessionId])));
    check("removeFeature revokes", service.removeFeature("bash|pattern-arg|regex-literal|single") && !service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.close();
}

// --- 开关关闭：不记账 ---
{
    const service = createLearnService(join(dir, "learn-off.sqlite3"), {enabled: () => false, threshold: () => 3, retentionDays: () => 90});
    await service.ready;
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("disabled => no learning", service.features().length === 0 && !service.isExempt("bash|pattern-arg|regex-literal|single"));
    service.close();
}

// --- 审批事件（T36）：弹窗即记、不论结果，模糊搜索可查 ---
{
    const service = createLearnService(join(dir, "learn-approval.sqlite3"), {enabled: () => true, threshold: () => 3, retentionDays: () => 90});
    await service.ready;
    const base = {
        at: Date.now(),
        tool: "bash",
        command: "cat /etc/x",
        dir: "/etc",
        reason: "command references a path outside the workspace",
        targets: "[\"/etc/x\"]",
        sensitive: false,
        channel: "panel",
        ms: 1234,
        sessionId: "sess-1"
    };
    service.db.recordApproval({...base, verdict: "once"});
    service.db.recordApproval({...base, verdict: "user-denied", ms: 50});
    service.db.recordApproval({...base, verdict: "timeout", channel: "none", ms: 120000});
    const all = service.db.searchApprovals("cat", 10);
    check("approval events recorded regardless of outcome", all.length === 3, JSON.stringify(all.map((item) => item.verdict)));
    check("approval search by verdict", service.db.searchApprovals("user-denied", 10).length === 1);
    check("approval search by dir", service.db.searchApprovals("/etc", 10).length === 3);
    check("approval fields preserved", all.some((item) => item.verdict === "timeout" && item.ms === 120000 && item.channel === "none"));
    check("approval id is uuidv7", all.every((item) => UUIDV7_PATTERN.test(item.id)), JSON.stringify(all.map((item) => item.id)));
    service.close();
}

// --- Flyway 式迁移（T38）：首次建库、幂等重开、迁移历史 ---
{
    const dbPath = join(dir, "learn-migrate.sqlite3");
    const first = createLearnService(dbPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90});
    await first.ready;
    check("migrations applied on first open", first.db.available === true);
    first.db.recordHit({...hit(), at: Date.now(), verdict: "once"});
    first.close();
    const second = createLearnService(dbPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90});
    await second.ready;
    check("reopen is idempotent and keeps data", second.db.available && second.db.search("awk", 5).length === 1, JSON.stringify(second.db.search("awk", 5).map((row) => row.token)));
    second.close();
    const migrator = new Migrator({driver: "sqlite", database: dbPath, directory: fileURLToPath(new URL("../migrations", import.meta.url)), table: "_migrations"});
    await migrator.connect();
    const status = await migrator.status();
    await migrator.disconnect();
    check("migration history recorded in _migrations", status.length === 1 && status[0].executed === true && status[0].name === "0001_init", JSON.stringify(status));
}

// --- fail-safe：损坏的 db 降级为不可用 stub（学习丢失、门禁不受影响）---
{
    const badPath = join(dir, "corrupt.sqlite3");
    writeFileSync(badPath, "this is not a sqlite database", "utf8");
    const service = createLearnService(badPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90});
    await service.ready;
    check("corrupt db => unavailable stub", service.db.available === false);
    service.record([hit()], "once");
    check("unavailable stub swallows writes", service.features().length === 0 && !service.isExempt("bash|pattern-arg|regex-literal|single"));
    check("unavailable search empty", service.search("awk").length === 0);
    service.close();
}

console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
