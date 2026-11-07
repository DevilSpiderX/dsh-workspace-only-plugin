/**
 * learn.ts 单点测试（判决分类/归纳判定的函数级语义）：服务级闭环在
 * `scripts/verify-learn.ts`。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {decidesExemption, shapeSignature, verdictClass} from "../src/host/learn.ts";

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
        assert.equal(shapeSignature({tool: "bash", role: "arg", shape: null, quote: "none"}), "bash|arg|plain|none");
    });
});
