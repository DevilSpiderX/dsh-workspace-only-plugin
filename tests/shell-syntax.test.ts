/**
 * shell-syntax.ts 单点测试（语法分析层的函数级语义）：命令级集成用例在
 * `scripts/verify-scanner.ts` 的改善/回归组。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {classifyShape, hasHardPathShape, isRegexShapedText, parseShellWords, shapeSignature} from "../src/host/shell-syntax.ts";
import type {ShellWord} from "../src/host/shell-syntax.ts";

const rolesOf = (command: string, dialect: "bash" | "pwsh" = "bash"): Array<[string, string]> =>
    parseShellWords(command, dialect)
        .filter((word: ShellWord) => !/^[|;&()<>]+$/.test(word.raw.trim()) && !/^\d+[<>]$|&>>?$/.test(word.raw.trim()))
        .map((word: ShellWord) => [word.raw, word.role]);

describe("parseShellWords（角色标注）", () => {
    it("命令边界与重定向目标", () => {
        assert.deepEqual(rolesOf("echo hi > out.log"), [["echo", "command"], ["hi", "arg"], ["out.log", "redirect-target"]]);
        assert.deepEqual(rolesOf("a; b"), [["a", "command"], ["b", "command"]]);
    });

    it("赋值前缀不消费命令位（T7）", () => {
        assert.deepEqual(rolesOf("FOO=/etc/x node a.js"), [["FOO=/etc/x", "assign-value"], ["node", "command"], ["a.js", "arg"]]);
    });

    it("模式参数位：bash 命令第一裸词 / pwsh -Pattern 值", () => {
        assert.deepEqual(rolesOf("awk '/x/' f"), [["awk", "command"], ["'/x/'", "pattern-arg"], ["f", "arg"]]);
        assert.deepEqual(rolesOf("Select-String -Pattern '/x/'", "pwsh"), [["Select-String", "command"], ["-Pattern", "arg"], ["'/x/'", "pattern-arg"]]);
    });

    it("注释作为 comment 输出（调用方丢弃）", () => {
        assert.deepEqual(rolesOf("grep x y # tail"), [["grep", "command"], ["x", "pattern-arg"], ["y", "arg"], ["# tail", "comment"]]);
    });

    it("引号形态与单引号字面量", () => {
        const [, word] = parseShellWords("echo '$HOME'");
        assert.equal(word.quote, "single");
        assert.equal(word.value, "$HOME");
    });

    it("bash 转义与 pwsh 双引号转义", () => {
        const [, bash] = parseShellWords("echo a\\ b");
        assert.equal(bash.value, "a b");
        const [, pwsh] = parseShellWords("echo \"a\"\"b\"", "pwsh");
        assert.equal(pwsh.value, "a\"b");
    });

    it("未闭合引号按保守词输出（fail-closed）", () => {
        const words = parseShellWords("echo 'abc");
        assert.equal(words.length, 2);
        assert.equal(words[1].value, "abc");
    });
});

describe("classifyShape（形态分类）", () => {
    it("正则字面量与 loose", () => {
        assert.equal(classifyShape("/^\\//"), "regex-literal");
        assert.equal(classifyShape("/^\\d+$/"), "regex-literal");
        assert.equal(classifyShape("/foo/"), "regex-literal-loose");
    });

    it("真实路径形态归 abs-path（不豁免、不可学）", () => {
        assert.equal(classifyShape("/etc/x"), "abs-path");
        assert.equal(classifyShape("/usr/bin/"), "abs-path");
        assert.equal(classifyShape("/foo/bar/"), "abs-path");
        assert.equal(classifyShape("/etc/passwd"), "abs-path");
    });

    it("T15 注释碎片", () => {
        assert.equal(classifyShape("//"), "comment-slash");
        assert.equal(classifyShape("/* comment */"), "comment-slash");
        assert.equal(classifyShape("/*"), "abs-path");
        assert.equal(classifyShape("//server/share/x"), "abs-path");
    });

    it("反斜杠转义序列归 regex-escape，路径样词归 soft-path", () => {
        assert.equal(classifyShape("\\\\target\\\\"), "regex-escape");
        assert.equal(classifyShape("\\d"), "regex-escape");
        assert.equal(classifyShape("\\"), "regex-escape");
        assert.equal(classifyShape("\\\\server\\share"), "abs-path");
        assert.equal(classifyShape("foo\\bar"), "soft-path");
        assert.equal(classifyShape("src/x"), "soft-path");
        assert.equal(classifyShape("hello"), void 0);
    });
});

describe("isRegexShapedText（正则形态文本）", () => {
    it("锚点/转义片段豁免，混合嫌疑不豁免", () => {
        assert.equal(isRegexShapedText("/^\\s+,"), true);
        assert.equal(isRegexShapedText("/^\\// {print}"), true);
        assert.equal(isRegexShapedText("/etc/x"), false);
        // 模式体里嵌着裸绝对路径：保守上报。
        assert.equal(isRegexShapedText("/x/ /etc/y"), false);
    });
});

describe("hasHardPathShape（硬路径特征）", () => {
    it("盘符/UNC/家目录/逃逸/斜杠 UNC", () => {
        assert.equal(hasHardPathShape("C:\\x"), true);
        assert.equal(hasHardPathShape("\\\\server\\share"), true);
        assert.equal(hasHardPathShape("//server/share/x"), true);
        assert.equal(hasHardPathShape("~/x"), true);
        assert.equal(hasHardPathShape("a/../x"), true);
        assert.equal(hasHardPathShape("/etc/x"), false);
    });
});

describe("shapeSignature（学习层归纳键）", () => {
    it("判别维度全保留（五段：工具|命令|角色|形态|引号）", () => {
        assert.equal(
            shapeSignature({tool: "bash", command: "awk", role: "pattern-arg", shape: "regex-literal", quote: "single"}),
            "bash|awk|pattern-arg|regex-literal|single"
        );
        assert.equal(shapeSignature({tool: "pwsh", command: "get-childitem", role: "arg", shape: null, quote: "none"}), "pwsh|get-childitem|arg|plain|none");
        assert.equal(shapeSignature({tool: "pwsh", role: "arg", shape: "regex-escape", quote: "single"}), "pwsh||arg|regex-escape|single");
    });
});
