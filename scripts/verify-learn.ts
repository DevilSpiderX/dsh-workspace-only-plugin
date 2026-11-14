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

// --- 形态签名（五段：工具|命令|角色|形态|引号）：判别维度全保留 ---
check("signature keeps dimensions", shapeSignature({tool: "bash", command: "awk", role: "pattern-arg", shape: "regex-literal", quote: "single"}) === "bash|awk|pattern-arg|regex-literal|single");
check("signature null shape => plain", shapeSignature({tool: "pwsh", command: "get-childitem", role: "arg", shape: null, quote: "none"}) === "pwsh|get-childitem|arg|plain|none");
check("signature unknown command => empty segment", shapeSignature({tool: "pwsh", role: "arg", shape: "regex-escape", quote: "single"}) === "pwsh||arg|regex-escape|single");

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
    shapeSig: "bash|awk|pattern-arg|regex-literal|single",
    commandName: "awk",
    role: "pattern-arg",
    shape: "regex-literal",
    hitReason: "outside",
    isFocus: true,
    sessionId: "sess-learn",
    ...over
});

// --- 闭环：放行到阈值自动豁免；用户拒绝立即回撤；超时只观察不回撤 ---
{
    const service = createLearnService(join(dir, "learn.sqlite3"), {enabled: () => true, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await service.ready;
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("below threshold still asks", !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.record([hit()], "once");
    check("threshold reached => exempt", service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.record([hit()], "timeout");
    check("timeout keeps exemption（观察不回撤）", service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.record([hit()], "user-denied");
    check("user deny revokes exemption", !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("deny history blocks re-exemption", !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    const features = service.features();
    const feature = features.find((item) => item.shape === "bash|awk|pattern-arg|regex-literal|single");
    check("feature counters", feature !== void 0 && feature.allowCount === 7 && feature.denyCount === 1 && feature.timeoutCount === 1, JSON.stringify(feature));
    check("search finds events", service.search("awk").length > 0);
    check("search by signature", service.search("pattern-arg").length > 0);
    const rows = service.search("awk", 5);
    check("hit id is uuidv7 and session preserved", rows.every((row) => UUIDV7_PATTERN.test(row.id)) && rows.every((row) => row.sessionId === "sess-learn"), JSON.stringify(rows.map((row) => [row.id, row.sessionId])));
    check("hit command name preserved", rows.every((row) => row.commandName === "awk"), JSON.stringify(rows.map((row) => row.commandName)));
    check("removeFeature revokes", service.removeFeature("bash|awk|pattern-arg|regex-literal|single") && !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.close();
}

// --- 开关关闭：不记账 ---
{
    const service = createLearnService(join(dir, "learn-off.sqlite3"), {enabled: () => false, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await service.ready;
    service.record([hit()], "once");
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("disabled => no learning", service.features().length === 0 && !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    service.close();
}

// --- 审批事件（T36）：弹窗即记、不论结果，模糊搜索可查 ---
{
    const service = createLearnService(join(dir, "learn-approval.sqlite3"), {enabled: () => true, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
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
    const first = createLearnService(dbPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await first.ready;
    check("migrations applied on first open", first.db.available === true);
    first.db.recordHit({...hit(), at: Date.now(), verdict: "once"});
    first.close();
    const second = createLearnService(dbPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await second.ready;
    check("reopen is idempotent and keeps data", second.db.available && second.db.search("awk", 5).length === 1, JSON.stringify(second.db.search("awk", 5).map((row) => row.token)));
    second.close();
    const migrator = new Migrator({driver: "sqlite", database: dbPath, directory: fileURLToPath(new URL("../migrations", import.meta.url)), table: "_migrations"});
    await migrator.connect();
    const status = await migrator.status();
    await migrator.disconnect();
    check("migration history recorded in _migrations", status.length === 3 && status[0].executed === true && status[0].name === "0001_init" && status[1].executed === true && status[1].name === "0002_add_command_name" && status[2].executed === true && status[2].name === "0003_learn_policies", JSON.stringify(status));
}

// --- 五段签名：新旧异键隔离 + 方向锁（abs-path/硬路径不可学）+ 逐签名归纳 ---
{
    const service = createLearnService(join(dir, "learn-sig5.sqlite3"), {enabled: () => true, threshold: () => 2, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await service.ready;
    // 升级前的存量四段行（哪怕已豁免）与新五段键天然异键、精确匹配永不命中。
    service.db.writeFeature({shape: "bash|pattern-arg|regex-literal|single", allowCount: 3, denyCount: 0, timeoutCount: 0, exempt: true, updatedAt: Date.now()});
    check("legacy 4-segment row does not exempt 5-segment key", !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    // abs-path 形态不可学（方向锁：真实路径的放行是授权语义、不是误报）。
    service.record([hit({shapeSig: "bash|cat|arg|abs-path|double", shape: "abs-path", token: "/etc/passwd", commandName: "cat"})], "once");
    service.record([hit({shapeSig: "bash|cat|arg|abs-path|double", shape: "abs-path", token: "/etc/passwd", commandName: "cat"})], "once");
    check("abs-path shape never learns", !service.isExempt("bash|cat|arg|abs-path|double") && service.features().every((item) => item.shape !== "bash|cat|arg|abs-path|double"));
    // 硬路径特征（盘符/UNC/`~/`/`..`）不可学（方向锁）。
    service.record([hit({shapeSig: "pwsh|get-item|arg|abs-path|double", shape: "abs-path", token: "C:\\tmp\\x", commandName: "get-item"})], "once");
    check("hard-path token never learns", service.features().every((item) => item.shape !== "pwsh|get-item|arg|abs-path|double"));
    // 可学形态照常归纳到阈值豁免。
    service.record([hit()], "once");
    service.record([hit()], "once");
    check("learnable shape exempts at threshold", service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    // 逐签名归纳：一次裁决携带多个签名时同签名只计一次、异签名互不混淆。
    service.record([
        hit({shapeSig: "pwsh||string-content|regex-escape|single", shape: "regex-escape", token: "\\\\target\\\\", commandName: ""}),
        hit({shapeSig: "pwsh||string-content|regex-escape|single", shape: "regex-escape", token: "\\\\target\\\\", commandName: ""}),
        hit({shapeSig: "pwsh||arg|soft-path|none", shape: "soft-path", token: "foo\\bar", commandName: ""})
    ], "once");
    const dup = service.features().find((item) => item.shape === "pwsh||string-content|regex-escape|single");
    check("same-signature hits count once per verdict", dup !== void 0 && dup.allowCount === 1, JSON.stringify(dup));
    const other = service.features().find((item) => item.shape === "pwsh||arg|soft-path|none");
    check("distinct signatures induct independently", other !== void 0 && other.allowCount === 1, JSON.stringify(other));
    // 拒绝回撤同样按签名作用（只回撤被拒的那个形态、不波及兄弟签名）。
    service.record([hit({shapeSig: "pwsh||string-content|regex-escape|single", shape: "regex-escape", token: "\\\\target\\\\", commandName: ""})], "once");
    check("regex-escape exempt at threshold", service.isExempt("pwsh||string-content|regex-escape|single"));
    service.record([hit({shapeSig: "pwsh||arg|soft-path|none", shape: "soft-path", token: "foo\\bar", commandName: ""})], "once");
    check("soft-path exempt at threshold", service.isExempt("pwsh||arg|soft-path|none"));
    service.record([hit({shapeSig: "pwsh||arg|soft-path|none", shape: "soft-path", token: "foo\\bar", commandName: ""})], "user-denied");
    check("user deny revokes only the denied shape", !service.isExempt("pwsh||arg|soft-path|none") && service.isExempt("pwsh||string-content|regex-escape|single"));
    service.close();
}

// --- fail-safe：损坏的 db 降级为不可用 stub（学习丢失、门禁不受影响）---
{
    const badPath = join(dir, "corrupt.sqlite3");
    writeFileSync(badPath, "this is not a sqlite database", "utf8");
    const service = createLearnService(badPath, {enabled: () => true, threshold: () => 3, retentionDays: () => 90, autoApprove: () => false, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await service.ready;
    check("corrupt db => unavailable stub", service.db.available === false);
    service.record([hit()], "once");
    check("unavailable stub swallows writes", service.features().length === 0 && !service.isExempt("bash|awk|pattern-arg|regex-literal|single"));
    check("unavailable search empty", service.search("awk").length === 0);
    service.close();
}

// --- L2 意图学习（T39）：分层计数 / 自动通过三条件 / 回撤 / auto-approved 不训练 ---
{
    const service = createLearnService(join(dir, "learn-l2.sqlite3"), {enabled: () => true, threshold: () => 2, retentionDays: () => 90, autoApprove: () => true, autoApproveThreshold: () => 0.95, autoApproveMinSamples: () => 5});
    await service.ready;
    const input = {tool: "pwsh", commandName: "docker", dir: "D:\\proj"};
    // auto-approved 不回流训练（防自我强化）：L1/L2 都不吃自己的产出。
    service.record([hit()], "auto-approved");
    check("auto-approved never trains L1", service.features().length === 0);
    service.recordPolicy(input, "auto-approved");
    check("auto-approved never trains L2", service.db.policies().length === 0);
    // other-deny（timeout 等）只观察、不进样本（超时噪声不污染学习）。
    service.recordPolicy(input, "timeout");
    check("timeout is not a training sample", service.db.policies().length === 0);
    // 正样本计数：K1-K4 四层键逐层 upsert。
    for (let i = 0; i < 20; i += 1) service.recordPolicy(input, "once");
    const rows = service.db.policies();
    check("four layers counted per verdict", rows.length === 4 && rows.every((row) => row.allowCount === 20 && row.sampleCount === 20 && row.denyCount === 0 && row.active === true), JSON.stringify(rows));
    check("auto-approve ready at threshold", service.shouldAutoApprove(input) === true);
    // 样本不足的新特征不自动通过（fail-closed 回弹窗）。
    check("fresh feature does not auto-approve", service.shouldAutoApprove({tool: "pwsh", commandName: "curl", dir: "D:\\proj"}) === false);
    // 用户拒绝立即回撤：deny 计数 + active=false，K1 永久否决。
    service.recordPolicy(input, "user-denied");
    check("user deny revokes auto-approve", service.shouldAutoApprove(input) === false);
    const k1 = service.db.policies().find((row) => row.featureKey === "pwsh|docker|D:\\proj");
    check("deny counted and revoked", k1 !== void 0 && k1.denyCount === 1 && k1.active === false, JSON.stringify(k1));
    // 组规则 deny 传染：LLM 归并的组被拒过 → 整组不自动通过。
    service.db.writeGroupRule({id: "g1", matcher: {tool: "pwsh", command: "docker*", dir: ""}, sampleCount: 20, allowCount: 19, denyCount: 1, active: true, updatedAt: Date.now()});
    service.reload();
    check("group deny contagion blocks auto-approve", service.shouldAutoApprove({tool: "pwsh", commandName: "docker", dir: "E:\\other"}) === false);
    // 重置：全部学习表清空、重新开始学习。
    check("resetLearnData clears everything", service.resetLearnData() === true && service.db.policies().length === 0 && service.features().length === 0 && service.db.groupRules().length === 0);
    service.close();
}

console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
