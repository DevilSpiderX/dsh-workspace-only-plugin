/**
 * ask.ts 单点测试（判决词汇与回答解析）：会合点/回退链的集成行为由
 * smoke（tmp/smoke）与人工验收覆盖。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {CHANNEL, CHOICE, choiceFromAnswer, DENY_CAUSE, LABELS, normalizeChoice} from "../src/host/ask.ts";

describe("normalizeChoice（决策 token 归一化）", () => {
    it("合法值直通，未知值一律拒绝（fail-closed）", () => {
        assert.equal(normalizeChoice("once"), CHOICE.once);
        assert.equal(normalizeChoice("always"), CHOICE.always);
        assert.equal(normalizeChoice("deny"), CHOICE.deny);
        assert.equal(normalizeChoice("bogus"), CHOICE.deny);
        assert.equal(normalizeChoice(undefined), CHOICE.deny);
    });
});

describe("choiceFromAnswer（问答 label 反查，LABELS 即匹配键）", () => {
    const batch = (label: unknown) => ({answers: [{id: "workspace-only", selected: [label]}]});

    it("三键 label 各自反查", () => {
        assert.equal(choiceFromAnswer(batch(LABELS.once)), CHOICE.once);
        assert.equal(choiceFromAnswer(batch(LABELS.always)), CHOICE.always);
        assert.equal(choiceFromAnswer(batch(LABELS.deny)), CHOICE.deny);
    });

    it("未知 label / 空批次一律拒绝", () => {
        assert.equal(choiceFromAnswer(batch("别的文案")), CHOICE.deny);
        assert.equal(choiceFromAnswer({}), CHOICE.deny);
        assert.equal(choiceFromAnswer(undefined), CHOICE.deny);
    });
});

describe("DENY_CAUSE（agent 契约词汇，稳定不改）", () => {
    it("五个 host 侧判别值", () => {
        assert.deepEqual(Object.values(DENY_CAUSE).sort(), ["cancelled", "no-channel", "timeout", "user-denied", "user-rejected"]);
    });

    it("CHANNEL 六通道值（历史契约）", () => {
        assert.deepEqual(Object.values(CHANNEL).sort(), ["always-batch", "fast-deny", "none", "panel", "question", "system-dialog"]);
    });
});
