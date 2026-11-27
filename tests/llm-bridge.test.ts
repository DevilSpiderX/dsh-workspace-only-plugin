/**
 * `llm-bridge.ts` 单点测试（T42）：可选服务取用面。宿主 `llm` /
 * `agentDefaultModel` 是可缺席的 cordis Service，未 inject 时属性直访问会被
 * proxy 抛 `cannot get property "…" without inject` —— 桥接层必须只经
 * `services.get()` 取，并按缺失降级。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {createTidyBridge, type OptionalServices} from "../src/host/llm-bridge.ts";

/** 用普通对象伪造 `ctx.get`（不经 cordis 的 get trap）。 */
function servicesOf(table: Record<string, unknown>, throwOn?: string): OptionalServices {
    return {
        get(name: string): unknown {
            if (name === throwOn) throw new Error("boom");
            return table[name];
        }
    };
}

const model = {provider: "deepseek", model: "deepseek-v4.1-flash"};

describe("createTidyBridge（可选服务桥接）", () => {
    it("全部服务缺席时 askModel 抛可读错误、默认模型返回 undefined", async () => {
        const bridge = createTidyBridge(servicesOf({}));
        await assert.rejects(
            () => bridge.askModel(model, "sys", "user", new AbortController().signal),
            /llm service unavailable/
        );
        assert.equal(bridge.resolveDefaultModel(), void 0);
    });

    it("services 本身缺席（无 ctx.get 的 composition）也不炸", async () => {
        const bridge = createTidyBridge(void 0);
        await assert.rejects(() => bridge.askModel(model, "s", "u", new AbortController().signal), /llm service unavailable/);
        assert.equal(bridge.resolveDefaultModel(), void 0);
    });

    it("get 抛错按服务缺席处理（不让可选能力影响门禁）", async () => {
        const bridge = createTidyBridge(servicesOf({}, "llm"));
        await assert.rejects(() => bridge.askModel(model, "s", "u", new AbortController().signal), /llm service unavailable/);
        assert.equal(bridge.resolveDefaultModel(), void 0);
    });

    it("形态不符的服务（无 stream / 无 currentSelection）按缺席处理", async () => {
        const bridge = createTidyBridge(servicesOf({llm: {nope: 1}, agentDefaultModel: {other: true}}));
        await assert.rejects(() => bridge.askModel(model, "s", "u", new AbortController().signal), /llm service unavailable/);
        assert.equal(bridge.resolveDefaultModel(), void 0);
    });

    it("收 text-delta 文本，stop/max-tokens 正常结束", async () => {
        const calls: unknown[] = [];
        const llm = {
            async *stream(options: unknown) {
                calls.push(options);
                yield {type: "text-delta", text: "hello "};
                yield {type: "text-delta", text: "world"};
                yield {type: "finish", reason: {kind: "stop"}};
            }
        };
        const bridge = createTidyBridge(servicesOf({llm}));
        assert.equal(await bridge.askModel(model, "sys", "prompt", new AbortController().signal), "hello world");
        const options = calls[0] as {provider: string; model: string; system?: string; messages: unknown[]};
        assert.equal(options.provider, "deepseek");
        assert.equal(options.model, "deepseek-v4.1-flash");
        assert.equal(options.system, "sys");
        assert.deepEqual(options.messages, [{role: "user", content: [{type: "text", text: "prompt"}]}]);
    });

    it("reasoningEffortId 存在时透传为 reasoningEffort", async () => {
        const calls: Array<{reasoningEffort?: unknown}> = [];
        const llm = {
            async *stream(options: {reasoningEffort?: unknown}) {
                calls.push(options);
                yield {type: "finish", reason: {kind: "stop"}};
            }
        };
        const bridge = createTidyBridge(servicesOf({llm}));
        await bridge.askModel({...model, reasoningEffortId: "high"}, "s", "u", new AbortController().signal);
        assert.equal(calls[0]?.reasoningEffort, "high");
        await bridge.askModel(model, "s", "u", new AbortController().signal);
        assert.equal(Object.hasOwn(calls[1] ?? {}, "reasoningEffort"), false);
    });

    it("异常 finish（error/aborted/tool-calls）转成失败", async () => {
        for (const kind of ["error", "aborted", "tool-calls"]) {
            const llm = {
                async *stream() {
                    yield {type: "text-delta", text: "x"};
                    yield {type: "finish", reason: {kind}};
                }
            };
            const bridge = createTidyBridge(servicesOf({llm}));
            await assert.rejects(() => bridge.askModel(model, "s", "u", new AbortController().signal), new RegExp(`llm finish: ${kind}`));
        }
    });

    it("currentSelection 正常返回时映射为 ModelRef", () => {
        const bridge = createTidyBridge(servicesOf({
            agentDefaultModel: {currentSelection: () => ({provider: "p", model: "m", reasoningEffort: "low"})}
        }));
        assert.deepEqual(bridge.resolveDefaultModel(), {provider: "p", model: "m", reasoningEffortId: "low"});
    });

    it("currentSelection 返回 undefined/空 model 或抛错时返回 undefined", () => {
        const cases: unknown[] = [
            {currentSelection: () => void 0},
            {currentSelection: () => ({provider: "p", model: ""})},
            {currentSelection: () => ({provider: "p"})},
            {currentSelection: () => { throw new Error("inactive"); }}
        ];
        for (const agentDefaultModel of cases) {
            const bridge = createTidyBridge(servicesOf({agentDefaultModel}));
            assert.equal(bridge.resolveDefaultModel(), void 0);
        }
    });
});
