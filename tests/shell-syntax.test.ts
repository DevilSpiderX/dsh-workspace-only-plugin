/**
 * shell-syntax.ts 单点测试（语法分析层的函数级语义）：命令级集成用例在
 * `scripts/verify-scanner.ts` 的改善/回归组。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {classifyShape, hasHardPathShape, isRegexShapedText, isWindowsSlashSwitch, parseShellWords, shapeSignature} from "../src/host/shell-syntax.ts";
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

    it("Windows 原生命令的斜杠开关是 command-switch，不是路径（T46）", () => {
        // 生产机主因：`cmd /c "mvnw.cmd ..."` 的 `/c` 曾被归 abs-path 并判越界。
        const pwsh = rolesOf("cmd /c \"mvnw.cmd -o test\"", "pwsh");
        assert.deepEqual(pwsh, [["cmd", "command"], ["/c", "command-switch"], ["\"mvnw.cmd -o test\"", "arg"]]);
        // Git Bash 里同样跑 cmd（两条数据源、两个方言口径一致）。
        assert.deepEqual(rolesOf("cmd /c \"mvnw.cmd -o test\"", "bash"), pwsh);
        // 同类开关：`/k`、带值的 `/e:on`、findstr 的 `/R`。
        assert.deepEqual(rolesOf("cmd /K dir", "pwsh"), [["cmd", "command"], ["/K", "command-switch"], ["dir", "arg"]]);
        assert.deepEqual(
            rolesOf("cmd /e:on /v:on /c dir", "pwsh"),
            [["cmd", "command"], ["/e:on", "command-switch"], ["/v:on", "command-switch"], ["/c", "command-switch"], ["dir", "arg"]]
        );
        assert.deepEqual(rolesOf("findstr /R foo x.txt", "bash"), [["findstr", "command"], ["/R", "command-switch"], ["foo", "pattern-arg"], ["x.txt", "arg"]]);
    });

    it("非白名单命令与多段写法仍是 arg（开关豁免不放宽真路径，T46）", () => {
        assert.deepEqual(rolesOf("cat /etc", "bash"), [["cat", "command"], ["/etc", "arg"]]);
        assert.deepEqual(rolesOf("cat /c", "pwsh"), [["cat", "command"], ["/c", "arg"]]);
        // MSYS 盘符写法是多段，不是单段开关形态。
        assert.deepEqual(rolesOf("cmd /c/Users/Devil", "pwsh"), [["cmd", "command"], ["/c/Users/Devil", "arg"]]);
        assert.deepEqual(rolesOf("cd /c/Users/Devil", "bash"), [["cd", "command"], ["/c/Users/Devil", "arg"]]);
    });
});

describe("isWindowsSlashSwitch（T46 判据直测）", () => {
    it("白名单命令 + 单段开关形态才成立", () => {
        assert.equal(isWindowsSlashSwitch("cmd", "/c"), true);
        assert.equal(isWindowsSlashSwitch("cmd.exe", "/k"), true);
        assert.equal(isWindowsSlashSwitch("findstr", "/R"), true);
        assert.equal(isWindowsSlashSwitch("reg", "/e:on"), true);
        // 命令名大小写不敏感（pwsh cmdlet 归一已小写，这里兜住裸写法）。
        assert.equal(isWindowsSlashSwitch("CMD", "/c"), true);
    });

    it("非白名单命令、多段写法、非开关形态一律 false（fail-closed）", () => {
        assert.equal(isWindowsSlashSwitch("cat", "/etc"), false);
        assert.equal(isWindowsSlashSwitch("cd", "/c/Users/Devil"), false);
        assert.equal(isWindowsSlashSwitch("cmd", "/c/Users/Devil"), false);
        assert.equal(isWindowsSlashSwitch("cmd", "/"), false);
        assert.equal(isWindowsSlashSwitch("cmd", "/1"), false);
        assert.equal(isWindowsSlashSwitch("", "/c"), false);
        assert.equal(isWindowsSlashSwitch(void 0, "/c"), false);
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
