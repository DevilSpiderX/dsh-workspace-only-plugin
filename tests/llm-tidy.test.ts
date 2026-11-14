/**
 * llm-tidy.ts 单点测试（LLM 整理产物的校验/组计数/模型路由）：服务级
 * 流程（防抖/审计/fail-safe）在 `scripts/verify-learn.ts`。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {commandNameOf, computeGroupCounts, parseTidyOutput, resolveTidyModel} from "../src/host/llm-tidy.ts";
import type {LearnedPolicy} from "../src/host/learn-db.ts";

describe("parseTidyOutput（LLM 输出严格校验：只信三段 glob）", () => {
    it("合法输出取 matcher 三段，数字字段一律无视（LLM 无法虚报计数）", () => {
        const parsed = parseTidyOutput('{"groups":[{"tool":"pwsh","command":"docker*","dir":"","sampleCount":999,"allowCount":999,"denyCount":0}]}');
        assert.ok(parsed !== void 0);
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].tool, "pwsh");
        assert.equal(parsed[0].command, "docker*");
        assert.equal(parsed[0].dir, "");
    });

    it("非法 JSON / 非对象 / 空 groups 一律弃用整轮", () => {
        assert.equal(parseTidyOutput("not json"), void 0);
        assert.equal(parseTidyOutput("42"), void 0);
        assert.equal(parseTidyOutput('{"groups":[]}'), void 0);
    });

    it("三段全空=匹配一切的废规则，弃用整轮", () => {
        assert.equal(parseTidyOutput('{"groups":[{"tool":"","command":"","dir":""}]}'), void 0);
    });

    it("超组数 / 不安全字符 / 超长 glob 弃用整轮", () => {
        const many = {groups: Array.from({length: 51}, () => ({tool: "pwsh", command: "x", dir: ""}))};
        assert.equal(parseTidyOutput(JSON.stringify(many)), void 0);
        assert.equal(parseTidyOutput('{"groups":[{"tool":"pwsh","command":"中文*","dir":""}]}'), void 0);
        const long = {groups: [{tool: "pwsh", command: "x".repeat(257), dir: ""}]};
        assert.equal(parseTidyOutput(JSON.stringify(long)), void 0);
    });
});

describe("computeGroupCounts（组计数=K1 精确样本实算，不可虚报）", () => {
    const row = (over: Partial<LearnedPolicy>): LearnedPolicy => ({
        id: "id",
        featureKey: "k",
        layer: 1,
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

    it("只聚合 layer=1 且匹配 matcher 的行", () => {
        const counts = computeGroupCounts({tool: "pwsh", command: "docker*", dir: ""}, [
            row({featureKey: "a", sampleCount: 5, allowCount: 4, denyCount: 1}),
            row({featureKey: "b", layer: 2, sampleCount: 100, allowCount: 100}),
            row({featureKey: "c", commandName: "curl", sampleCount: 7, allowCount: 7})
        ]);
        assert.deepEqual(counts, {sampleCount: 5, allowCount: 4, denyCount: 1});
    });
});

describe("resolveTidyModel（模型路由：auto=跟随当前模型）", () => {
    it("auto 交给默认模型，推理等级不叠加", () => {
        const fallback = {provider: "p", model: "m"};
        assert.equal(resolveTidyModel("auto", "default", fallback), fallback);
        assert.equal(resolveTidyModel("auto", "high", fallback), fallback);
    });

    it("provider::model 解析，推理等级默认省略", () => {
        assert.deepEqual(resolveTidyModel("prov::model-x", "default", void 0), {provider: "prov", model: "model-x"});
        assert.deepEqual(resolveTidyModel("prov::model-x", "high", void 0), {provider: "prov", model: "model-x", reasoningEffortId: "high"});
    });

    it("畸形配置解析失败（不猜模型）", () => {
        assert.equal(resolveTidyModel("no-double-colon", "default", void 0), void 0);
        assert.equal(resolveTidyModel("::m", "default", void 0), void 0);
        assert.equal(resolveTidyModel("p::", "default", void 0), void 0);
    });
});

describe("commandNameOf（命令名=首词小写，与 PolicyInput 对齐）", () => {
    it("取首词并小写", () => {
        assert.equal(commandNameOf("Docker Run -v x"), "docker");
        assert.equal(commandNameOf(""), "");
    });
});
