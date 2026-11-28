/**
 * llm-tidy.ts 单点测试（LLM 整理产物的校验/组计数/模型路由）：服务级
 * 流程（防抖/审计/fail-safe）在 `scripts/verify-learn.ts`。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {commandNameOf, computeGroupCounts, createLlmTidyService, looksLikeDir, parseTidyOutput, resolveTidyModel} from "../src/host/llm-tidy.ts";
import {unavailableDb} from "../src/host/learn-db.ts";
import type {ApprovalEvent, LearnDb, LearnedPolicy, LlmGroupRule} from "../src/host/learn-db.ts";

describe("parseTidyOutput（LLM 输出严格校验：只信三段 glob）", () => {
    it("合法输出取 matcher 三段，数字字段一律无视（LLM 无法虚报计数）", () => {
        const parsed = parseTidyOutput('{"groups":[{"tool":"pwsh","command":"docker*","dir":"C:\\\\proj","sampleCount":999,"allowCount":999,"denyCount":0}]}');
        assert.ok(parsed !== void 0);
        assert.equal(parsed.matchers.length, 1);
        assert.equal(parsed.matchers[0].tool, "pwsh");
        assert.equal(parsed.matchers[0].command, "docker*");
        assert.equal(parsed.matchers[0].dir, "C:\\proj");
        assert.equal(parsed.dropped, 0);
    });

    it("非法 JSON / 非对象 / 空 groups 一律弃用整轮", () => {
        assert.equal(parseTidyOutput("not json"), void 0);
        assert.equal(parseTidyOutput("42"), void 0);
        assert.equal(parseTidyOutput('{"groups":[]}'), void 0);
    });

    it("三段全空=匹配一切的废规则，逐组丢弃（无有效组时整轮 failed）", () => {
        const parsed = parseTidyOutput('{"groups":[{"tool":"","command":"","dir":""}]}');
        assert.ok(parsed !== void 0);
        assert.equal(parsed.matchers.length, 0);
        assert.equal(parsed.dropped, 1);
    });

    it("T45：dir 是安全关键维度——纯通配/空串的组一律丢弃", () => {
        const parsed = parseTidyOutput(JSON.stringify({groups: [
            {tool: "pwsh", command: "docker*", dir: "*"},
            {tool: "pwsh", command: "docker*", dir: ""},
            {tool: "pwsh", command: "docker*", dir: "?*"},
            {tool: "pwsh", command: "docker*", dir: "C:\\proj"}
        ]}));
        assert.ok(parsed !== void 0);
        assert.deepEqual(parsed.matchers.map((m) => m.dir), ["C:\\proj"]);
        assert.equal(parsed.dropped, 3);
    });

    it("T45：tool 与 command 也不允许纯通配（跨工具/跨命令泛化）", () => {
        const parsed = parseTidyOutput(JSON.stringify({groups: [
            {tool: "*", command: "docker*", dir: "C:\\proj"},
            {tool: "", command: "docker*", dir: "C:\\proj"},
            {tool: "pwsh", command: "*", dir: "C:\\proj"},
            {tool: "pwsh", command: "", dir: "C:\\proj"}
        ]}));
        assert.ok(parsed !== void 0);
        assert.equal(parsed.matchers.length, 0);
        assert.equal(parsed.dropped, 4);
    });

    it("超组数弃用整轮；超长 glob / 不安全字符只丢该组", () => {
        const many = {groups: Array.from({length: 51}, () => ({tool: "pwsh", command: "x", dir: "C:\\p"}))};
        assert.equal(parseTidyOutput(JSON.stringify(many)), void 0);
        const mix = parseTidyOutput(JSON.stringify({groups: [
            {tool: "pwsh", command: "中文*", dir: "C:\\p"},
            {tool: "pwsh", command: "x".repeat(257), dir: "C:\\p"},
            {tool: "pwsh", command: "ok", dir: "C:\\p"}
        ]}));
        assert.ok(mix !== void 0);
        assert.deepEqual(mix.matchers.map((m) => m.command), ["ok"]);
        assert.equal(mix.dropped, 2);
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

describe("commandNameOf（历史行的命令名回落：不可知即空串）", () => {
    it("取首词并小写", () => {
        assert.equal(commandNameOf("Docker Run -v x"), "docker");
        assert.equal(commandNameOf(""), "");
    });

    it("T45：脚本碎片不当命令名（变量/调用运算符/类型转换/赋值/关键字）", () => {
        assert.equal(commandNameOf("$javap -p -c 'x'"), "");
        assert.equal(commandNameOf("& 'C:\\Programs\\Git\\bin\\sh.exe' -x y"), "");
        assert.equal(commandNameOf("[xml]$s = Get-Content x"), "");
        assert.equal(commandNameOf("$env:MYSQL_PWD='hello123!'; mysql -u"), "");
        assert.equal(commandNameOf("$root='c:\\code'; Get-ChildItem"), "");
        assert.equal(commandNameOf("if (Test-Path x) { y }"), "");
        assert.equal(commandNameOf("foreach ($f in $files) { }"), "");
    });
});

describe("looksLikeDir（T45：扫描器误报的模式串不进 prompt）", () => {
    it("绝对路径与家目录写法算目录", () => {
        assert.equal(looksLikeDir("C:\\Code"), true);
        assert.equal(looksLikeDir("C:/Code"), true);
        assert.equal(looksLikeDir("/c/Users/Devil/Downloads"), true);
        assert.equal(looksLikeDir("\\\\server\\share"), true);
        assert.equal(looksLikeDir("~/proj"), true);
    });

    it("模式串/命令片段/相对路径不算目录", () => {
        assert.equal(looksLikeDir(""), false);
        assert.equal(looksLikeDir("*"), false);
        assert.equal(looksLikeDir("\\target\\"), false);
        assert.equal(looksLikeDir("/fire/|\"/law/|fire/api/v1|law/api/v1"), false);
        assert.equal(looksLikeDir("C:\\Code\\*"), false);
        assert.equal(looksLikeDir("relative\\path"), false);
    });
});

/** 最小假库：只实现整理流程用到的面（其余沿用不可用 stub 的空实现）。 */
const fakeDb = (events: readonly ApprovalEvent[], over: Partial<LearnDb> = {}): LearnDb => {
    const rules: LlmGroupRule[] = [];
    return {
        ...unavailableDb(""),
        available: true,
        detail: "",
        searchApprovals: () => [...events],
        policies: () => [k1Row()],
        groupRules: () => [...rules],
        writeGroupRule: (rule) => {
            rules.push(rule);
        },
        removeGroupRule: (id) => {
            const index = rules.findIndex((rule) => rule.id === id);
            if (index < 0) return false;
            rules.splice(index, 1);
            return true;
        },
        recordTidyRun: () => {
        },
        ...over
    };
};

/** 一条 K1 精确样本行（组计数实算的来源；零样本组会被丢弃）。 */
const k1Row = (over: Partial<LearnedPolicy> = {}): LearnedPolicy => ({
    id: "p1",
    featureKey: "bash|cat|/etc",
    layer: 1,
    tool: "bash",
    commandName: "cat",
    dir: "/etc",
    sampleCount: 5,
    allowCount: 5,
    denyCount: 0,
    active: true,
    source: "stat",
    updatedAt: 1,
    ...over
});

const sampleEvent = (verdict: string): ApprovalEvent => ({
    id: "id",
    at: Date.now(),
    tool: "bash",
    command: "cat /etc/hosts",
    commandName: "cat",
    dir: "/etc",
    reason: "outside",
    targets: "/etc/hosts",
    sensitive: false,
    verdict,
    channel: "card",
    ms: 10,
    sessionId: "s1"
});

describe("createLlmTidyService（T43：库句柄在用时取当前值 + 等就绪）", () => {
    const options = {assist: () => true, model: () => "p::m", reasoningEffort: () => "default"};

    it("装配时库还是不可用快照，就绪后照常整理（不再恒定 db unavailable）", async () => {
        const readyDb = fakeDb([sampleEvent("once")]);
        let current: LearnDb = unavailableDb("opening");
        let release: () => void = () => {
        };
        const ready = new Promise<void>((resolve) => {
            release = resolve;
        });
        const service = createLlmTidyService({
            db: () => current,
            ready,
            askModel: async () => '{"groups":[{"tool":"bash","command":"cat","dir":"/etc"}]}',
            resolveDefaultModel: () => ({provider: "p", model: "m"})
        }, options);
        const pending = service.run();
        current = readyDb;
        release();
        const summary = await pending;
        assert.equal(summary.status, "ok");
        assert.equal(summary.appliedCount, 1);
    });

    it("库确实不可用时报出具体原因", async () => {
        const service = createLlmTidyService({
            db: () => unavailableDb("migration failed: file is not a database"),
            askModel: async () => "{}",
            resolveDefaultModel: () => ({provider: "p", model: "m"})
        }, options);
        const summary = await service.run();
        assert.equal(summary.status, "failed");
        assert.match(summary.detail, /^db unavailable: migration failed/u);
    });

    it("就绪信号永不 resolve 也不挂住（上限等待后按不可用处理）", async () => {
        const service = createLlmTidyService({
            db: () => unavailableDb("still opening"),
            ready: new Promise<void>(() => {
            }),
            readyWaitMs: 5,
            askModel: async () => "{}",
            resolveDefaultModel: () => ({provider: "p", model: "m"})
        }, options);
        const summary = await service.run();
        assert.equal(summary.status, "failed");
        assert.match(summary.detail, /^db unavailable: still opening$/u);
    });

    it("开关关闭时仍先报 skipped（不需要碰库）", async () => {
        const service = createLlmTidyService({
            db: () => unavailableDb("never opened"),
            askModel: async () => "{}",
            resolveDefaultModel: () => ({provider: "p", model: "m"})
        }, {...options, assist: () => false});
        const summary = await service.run();
        assert.equal(summary.status, "skipped");
    });
});
