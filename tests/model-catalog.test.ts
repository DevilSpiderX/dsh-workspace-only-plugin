/**
 * T39-fix：模型目录解析单测（src/client/model-catalog.ts）。
 * 契约钉子：modelCatalog() 的 `{ok, value}` 结果包裹解包（bug：直接取 raw.groups 取空）、
 * ModelReasoningEffort 是对象 {id, name}（value 用 id、label 用 name）、defaultEffort 按 id 匹配。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {defaultEffortId, parseCatalogGroups, parseEfforts} from "../src/client/model-catalog.ts";
import type {CatalogGroupLike} from "../src/client/model-catalog.ts";

test("parseCatalogGroups 解开 {ok, value} 结果包裹", () => {
    const raw = {
        ok: true,
        value: {
            groups: [{id: "prov-a", name: "Provider A", models: [{id: "m1", name: "Model One"}]}],
            default: {provider: "prov-a", model: "m1"},
            routableProviders: [],
            failures: []
        }
    };
    const groups = parseCatalogGroups(raw);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.id, "prov-a");
    assert.equal(groups[0]?.name, "Provider A");
    assert.equal(groups[0]?.models[0]?.id, "m1");
    assert.equal(groups[0]?.models[0]?.name, "Model One");
});

test("parseCatalogGroups：ok:false 取空（fail-safe 下拉只剩跟随当前模型）", () => {
    assert.deepEqual(parseCatalogGroups({ok: false, error: "boom"}), []);
});

test("parseCatalogGroups 兼容裸 ModelCatalog 形态", () => {
    const groups = parseCatalogGroups({groups: [{id: "p", name: "P", models: [{id: "m", name: "M"}]}]});
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.models[0]?.id, "m");
});

test("parseCatalogGroups：畸形分组/模型条目跳过、不整包拒绝", () => {
    const groups = parseCatalogGroups({
        ok: true,
        value: {
            groups: [
                null,
                {id: 42, name: "bad"},
                {id: "g1", name: "G1", models: [null, {name: "no-id"}, {id: "ok-m", name: "OK"}]},
                {id: "g2", name: "G2", models: "not-array"}
            ]
        }
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.id, "g1");
    assert.equal(groups[0]?.models.length, 1);
    assert.equal(groups[0]?.models[0]?.id, "ok-m");
});

test("parseEfforts：对象条目取 id/name（value=id、label=name），字符串条目容错 id=name", () => {
    const efforts = parseEfforts([
        {id: "high", name: "High", description: "deep"},
        {id: "low", name: "Low"},
        {id: "nameless"},
        "legacy",
        null,
        {name: "no-id"}
    ]);
    assert.deepEqual(efforts, [
        {id: "high", name: "High"},
        {id: "low", name: "Low"},
        {id: "nameless", name: "nameless"},
        {id: "legacy", name: "legacy"}
    ]);
});

test("parseEfforts：非数组/空取空", () => {
    assert.deepEqual(parseEfforts(undefined), []);
    assert.deepEqual(parseEfforts("x"), []);
    assert.deepEqual(parseEfforts([]), []);
});

test("defaultEffortId：按 effort id 精确匹配", () => {
    const model = {
        id: "m",
        name: "M",
        efforts: [{id: "high", name: "High"}, {id: "low", name: "Low"}],
        defaultEffort: "low"
    };
    assert.equal(defaultEffortId(model), "low");
});

test("defaultEffortId：无命中取第一个 effort；无 efforts → undefined（「默认」）", () => {
    assert.equal(defaultEffortId({id: "m", name: "M", efforts: [{id: "high", name: "High"}], defaultEffort: "gone"}), "high");
    assert.equal(defaultEffortId({id: "m", name: "M", efforts: []}), undefined);
    assert.equal(defaultEffortId({id: "m", name: "M", efforts: [{id: "high", name: "High"}]}), "high");
});

test("完整目录经 {ok,value} 解析后 efforts 齐全（bug 2 回归钉）", () => {
    const groups: CatalogGroupLike[] = parseCatalogGroups({
        ok: true,
        value: {
            groups: [{
                id: "xiaomi-token-plan-cn",
                name: "xiaomi-token-plan-cn",
                models: [{
                    id: "MiMo-V2.6-Pro",
                    name: "MiMo-V2.6-Pro",
                    reasoning: {
                        efforts: [{id: "high", name: "High"}, {id: "low", name: "Low"}],
                        defaultEffort: "high"
                    }
                }]
            }]
        }
    });
    const model = groups[0]?.models[0];
    assert.equal(model?.efforts.length, 2);
    assert.equal(model?.efforts[0]?.id, "high");
    assert.equal(model?.efforts[0]?.name, "High");
    assert.equal(defaultEffortId(model!), "high");
});
