/**
 * learn.ts 单点测试（判决分类/归纳判定的函数级语义）：服务级闭环在
 * `scripts/verify-learn.ts`。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {decidesAutoApprove, decidesExemption, globMatch, isLearnable, matchesGroupRule, policyFeatureKeys, shapeSignature, verdictClass} from "../src/host/learn.ts";
import type {LearnedPolicy, LlmGroupRule} from "../src/host/learn-db.ts";

describe("verdictClass（学习负样本口径）", () => {
    it("放行是正样本", () => {
        assert.equal(verdictClass("once"), "allow");
        assert.equal(verdictClass("always"), "allow");
    });

    it("只有用户拒绝是负样本", () => {
        assert.equal(verdictClass("user-denied"), "user-deny");
        assert.equal(verdictClass("user-rejected"), "user-deny");
    });

    it("超时/无应答/取消只观察、不计负样本", () => {
        assert.equal(verdictClass("timeout"), "other-deny");
        assert.equal(verdictClass("no-channel"), "other-deny");
        assert.equal(verdictClass("cancelled"), "other-deny");
    });
});

describe("decidesExemption（豁免判定）", () => {
    it("阈值达标且零用户拒绝才豁免", () => {
        assert.equal(decidesExemption({allowCount: 3, denyCount: 0}, 3), true);
        assert.equal(decidesExemption({allowCount: 2, denyCount: 0}, 3), false);
        assert.equal(decidesExemption({allowCount: 9, denyCount: 1}, 3), false);
    });

    it("阈值下限为 2（一次放行绝不豁免）", () => {
        assert.equal(decidesExemption({allowCount: 1, denyCount: 0}, 1), false);
        assert.equal(decidesExemption({allowCount: 2, denyCount: 0}, 1), true);
    });
});

describe("shapeSignature（learn.ts 与 shell-syntax.ts 同源）", () => {
    it("null 形态归 plain", () => {
        assert.equal(shapeSignature({tool: "bash", command: "cat", role: "arg", shape: null, quote: "none"}), "bash|cat|arg|plain|none");
    });
});

describe("isLearnable（方向锁：abs-path/硬路径不可学）", () => {
    it("可学形态放行进归纳", () => {
        assert.equal(isLearnable("bash|awk|pattern-arg|regex-literal|single", "/^\\//"), true);
        assert.equal(isLearnable("pwsh||string-content|regex-escape|single", "\\\\target\\\\"), true);
        assert.equal(isLearnable("bash|cat|arg|soft-path|none", "foo\\bar"), true);
        assert.equal(isLearnable("bash|cat|arg|plain|none", "hello"), true);
    });

    it("abs-path 形态与硬路径 token 永不学习", () => {
        assert.equal(isLearnable("bash|cat|arg|abs-path|double", "/etc/passwd"), false);
        assert.equal(isLearnable("pwsh|get-item|arg|abs-path|double", "C:\\tmp\\x"), false);
        assert.equal(isLearnable("pwsh||arg|soft-path|none", "C:\\tmp\\x"), false);
        assert.equal(isLearnable("bash|cat|arg|abs-path|none", "~/x"), false);
    });
});

describe("policyFeatureKeys（L2 分层特征键：K1 精确 → K4 泛化）", () => {
    it("四层键按精确度递减", () => {
        assert.deepEqual(policyFeatureKeys("pwsh", "docker", "D:\\proj"), [
            {featureKey: "pwsh|docker|D:\\proj", layer: 1},
            {featureKey: "pwsh|docker", layer: 2},
            {featureKey: "pwsh|D:\\proj", layer: 3},
            {featureKey: "pwsh", layer: 4}
        ]);
    });
});

describe("globMatch / matchesGroupRule（LLM 组规则匹配）", () => {
    it("*/? 通配、大小写不敏感", () => {
        assert.equal(globMatch("docker*", "docker"), true);
        assert.equal(globMatch("docker*", "docker-compose"), true);
        assert.equal(globMatch("docker*", "curl"), false);
        assert.equal(globMatch("DOCKER*", "docker-run"), true);
        assert.equal(globMatch("do?ker", "docker"), true);
    });

    it("空串维度=不限", () => {
        assert.equal(matchesGroupRule({tool: "pwsh", command: "docker*", dir: ""}, {tool: "pwsh", commandName: "docker", dir: "D:\\any"}), true);
        assert.equal(matchesGroupRule({tool: "pwsh", command: "", dir: ""}, {tool: "pwsh", commandName: "whatever", dir: "x"}), true);
        assert.equal(matchesGroupRule({tool: "bash", command: "", dir: ""}, {tool: "pwsh", commandName: "x", dir: "y"}), false);
    });
});

describe("decidesAutoApprove（L2 自动通过：三条件 fail-closed）", () => {
    const input = {tool: "pwsh", commandName: "docker", dir: "D:\\proj"};
    const keys = policyFeatureKeys(input.tool, input.commandName, input.dir);
    const policyRow = (featureKey: string, layer: number, over: Partial<LearnedPolicy> = {}): LearnedPolicy => ({
        id: `id-${featureKey}`,
        featureKey,
        layer,
        tool: "pwsh",
        commandName: "docker",
        dir: "D:\\proj",
        sampleCount: 0,
        allowCount: 0,
        denyCount: 0,
        active: true,
        source: "stat",
        updatedAt: 1,
        ...over
    });
    const rowsToMap = (rows: LearnedPolicy[]): ReadonlyMap<string, LearnedPolicy> => new Map(rows.map((row) => [row.featureKey, row]));
    /** 四层同计数的健康基线（默认 20 次全放行）。 */
    const healthy = (over: Partial<LearnedPolicy> = {}): ReadonlyMap<string, LearnedPolicy> => rowsToMap(
        keys.map((key) => policyRow(key.featureKey, key.layer, {sampleCount: 20, allowCount: 20, ...over}))
    );
    const decide = (policies: ReadonlyMap<string, LearnedPolicy>, groups: readonly LlmGroupRule[] = [], over: {threshold?: number; minSamples?: number} = {}): boolean =>
        decidesAutoApprove({keys, policies, groups, input, threshold: over.threshold ?? 0.95, minSamples: over.minSamples ?? 5});

    it("20 次全放行：置信与样本双达标 → 自动通过", () => {
        assert.equal(decide(healthy()), true);
    });

    it("置信不足（5 次全放行）→ 回弹窗", () => {
        assert.equal(decide(healthy({sampleCount: 5, allowCount: 5})), false);
    });

    it("样本闸门：K1 表态不足 minSamples → 回弹窗（fail-closed）", () => {
        const rows = keys.map((key) => policyRow(key.featureKey, key.layer, key.layer === 1 ? {sampleCount: 3, allowCount: 3} : {sampleCount: 20, allowCount: 20}));
        assert.equal(decide(rowsToMap(rows)), false);
    });

    it("K1 用户拒绝 = 一票否决", () => {
        assert.equal(decide(healthy({denyCount: 1, allowCount: 19})), false);
    });

    it("K1 被回撤过（active=false）= 一票否决", () => {
        assert.equal(decide(healthy({active: false})), false);
    });

    it("K2-K4 的 deny 不牵连无辜组合，只稀释置信（样本够厚仍可通过）", () => {
        // K2（同工具同命令、跨目录）累计 100 样本 3 拒；K1/K3/K4 干净厚样本。
        const rows = keys.map((key) => {
            if (key.layer === 2) return policyRow(key.featureKey, key.layer, {sampleCount: 100, allowCount: 97, denyCount: 3});
            return policyRow(key.featureKey, key.layer, {sampleCount: 60, allowCount: 60});
        });
        assert.equal(decide(rowsToMap(rows)), true);
    });

    it("组 deny 传染：命中组被拒过 → 整组否决", () => {
        const groups: LlmGroupRule[] = [{
            id: "g1",
            matcher: {tool: "pwsh", command: "docker*", dir: ""},
            sampleCount: 20,
            allowCount: 20,
            denyCount: 1,
            active: true,
            updatedAt: 1
        }];
        assert.equal(decide(healthy(), groups), false);
    });

    it("组先验喂样本闸门：K1 只有 2 次表态，组聚合替代后达标", () => {
        const rows = keys.map((key) => policyRow(key.featureKey, key.layer, key.layer === 1 ? {sampleCount: 2, allowCount: 2} : {sampleCount: 20, allowCount: 20}));
        const groups: LlmGroupRule[] = [{
            id: "g1",
            matcher: {tool: "pwsh", command: "docker*", dir: ""},
            sampleCount: 20,
            allowCount: 20,
            denyCount: 0,
            active: true,
            updatedAt: 1
        }];
        assert.equal(decide(rowsToMap(rows), groups), true);
    });

    it("停用的组规则不参与（不传染也不喂样本）", () => {
        const groups: LlmGroupRule[] = [{
            id: "g1",
            matcher: {tool: "pwsh", command: "docker*", dir: ""},
            sampleCount: 20,
            allowCount: 20,
            denyCount: 1,
            active: false,
            updatedAt: 1
        }];
        assert.equal(decide(healthy(), groups), true);
    });
});
