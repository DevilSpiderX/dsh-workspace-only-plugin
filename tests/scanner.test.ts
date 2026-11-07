/**
 * scanner.ts 单点测试（函数级、细粒度）：命令级集成用例在
 * `scripts/verify-scanner.ts`，这里只钉纯函数的单点语义。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
    denyMatch,
    directoryOf,
    expandHomeSpelling,
    genericTargets,
    globToRegExp,
    isPlatformTempTarget,
    lexicallyWithin,
    pathReason,
    sameLocation,
    sensitiveMatch,
    toolAccessKind
} from "../src/host/scanner.ts";

const winRoot = "C:\\work\\project";
const posixRoot = "/home/me/project";

describe("expandHomeSpelling（家目录写法展开）", () => {
    const env = {HOME: "/home/me", USERPROFILE: "C:\\Users\\me"};

    it("~ 与 ~/x 按 HOME 展开", () => {
        assert.equal(expandHomeSpelling("~", env), "/home/me");
        assert.equal(expandHomeSpelling("~/x", env), "/home/me/x");
        assert.equal(expandHomeSpelling("~\\x", env), "/home/me\\x");
    });

    it("$HOME/${HOME} 与分隔符边界", () => {
        assert.equal(expandHomeSpelling("$HOME/secret", env), "/home/me/secret");
        assert.equal(expandHomeSpelling("${HOME}/secret", env), "/home/me/secret");
        // 不到边界就不算家目录写法（`$HOMEDIR` 绝不误读）。
        assert.equal(expandHomeSpelling("$HOMEDIR/x", env), void 0);
        assert.equal(expandHomeSpelling("~user/x", env), void 0);
    });

    it("cmd/pwsh 写法按 USERPROFILE 展开", () => {
        assert.equal(expandHomeSpelling("%USERPROFILE%\\x", env), "C:\\Users\\me\\x");
        assert.equal(expandHomeSpelling("$env:USERPROFILE\\x", env), "C:\\Users\\me\\x");
    });

    it("env 缺失返回 undefined（fail-safe 按外部判定）", () => {
        assert.equal(expandHomeSpelling("~/x", {}), void 0);
        assert.equal(expandHomeSpelling("", env), void 0);
        assert.equal(expandHomeSpelling("src/x", env), void 0);
    });
});

describe("lexicallyWithin（词法包含）", () => {
    it("win 形态大小写不敏感", () => {
        assert.equal(lexicallyWithin("c:\\work\\PROJECT\\src", winRoot), true);
        assert.equal(lexicallyWithin("C:\\tmp\\x", winRoot), false);
    });

    it("逃逸与绝对路径", () => {
        assert.equal(lexicallyWithin("../x", posixRoot), false);
        assert.equal(lexicallyWithin("/etc/passwd", posixRoot), false);
        assert.equal(lexicallyWithin("~/x", posixRoot), false);
        assert.equal(lexicallyWithin("src/x", posixRoot), true);
    });
});

describe("denyMatch（deny 规则）", () => {
    it("分隔符结尾=目录前缀包含，否则 glob", () => {
        assert.equal(denyMatch("/etc/passwd", ["/etc/"]), "/etc/");
        assert.equal(denyMatch("C:\\work\\project\\x.pem", ["*.pem"]), "*.pem");
        assert.equal(denyMatch("C:\\other\\a.txt", ["C:\\secret\\"]), void 0);
    });

    it("两侧都做家目录展开", () => {
        assert.equal(denyMatch("~/secret/a.txt", ["~/secret/"]), "~/secret/");
    });
});

describe("globToRegExp（glob 编译）", () => {
    it("* / ? 与大小写不敏感", () => {
        assert.equal(globToRegExp("*.env").test("APP.env"), true);
        assert.equal(globToRegExp("id_rsa?").test("id_rsa1"), true);
        assert.equal(globToRegExp("*.env").test("app.env.local"), false);
    });
});

describe("directoryOf（白名单目录推导）", () => {
    it("文件取父目录，目录形态取本身", () => {
        assert.equal(directoryOf("C:\\tmp\\a.txt"), "C:\\tmp");
        assert.equal(directoryOf("C:\\tmp\\"), "C:\\tmp\\");
        assert.equal(directoryOf("~"), "~");
    });
});

describe("isPlatformTempTarget（平台临时豁免）", () => {
    const tempRoot = "C:\\Temp";

    it("仅临时根下第一层 dsh-*/.dsh-* 子树豁免", () => {
        assert.equal(isPlatformTempTarget("C:\\Temp\\dsh-shell-x\\a", tempRoot), true);
        assert.equal(isPlatformTempTarget("C:\\Temp\\.dsh-y\\a", tempRoot), true);
        assert.equal(isPlatformTempTarget("C:\\Temp", tempRoot), false);
        assert.equal(isPlatformTempTarget("C:\\Temp\\other\\dsh-x", tempRoot), false);
        assert.equal(isPlatformTempTarget("D:\\Temp\\dsh-x", tempRoot), false);
    });
});

describe("sensitiveMatch（敏感文件，T4）", () => {
    const config = {patterns: ["*.env", "*.pem"], allowPatterns: ["*.env.example"], alwaysPatterns: ["*.pem"]};

    it("patterns 命中、allow 豁免、always 豁免", () => {
        assert.equal(sensitiveMatch("app.env", config)?.pattern, "*.env");
        assert.equal(sensitiveMatch(".env.example", config), void 0);
        // alwaysPatterns（"总是允许此类文件"）先于 patterns 豁免。
        assert.equal(sensitiveMatch("server.pem", config), void 0);
        assert.equal(sensitiveMatch("notes.txt", config), void 0);
    });
});

describe("sameLocation / toolAccessKind / pathReason", () => {
    it("同位置判定（win 大小写）", () => {
        assert.equal(sameLocation("C:\\a", "c:\\A\\"), true);
        assert.equal(sameLocation("C:\\a", "C:\\b"), false);
        assert.equal(sameLocation("", "C:\\b"), false);
    });

    it("纯读取器=read，shell/未知=write", () => {
        assert.equal(toolAccessKind("read"), "read");
        assert.equal(toolAccessKind("grep"), "read");
        assert.equal(toolAccessKind("bash"), "write");
        assert.equal(toolAccessKind("mcp-unknown"), "write");
    });

    it("安全路径静默、越界路径报警", () => {
        assert.equal(pathReason("src\\a.txt", winRoot, "target"), void 0);
        assert.notEqual(pathReason("C:\\tmp\\x", winRoot, "target"), void 0);
        assert.notEqual(pathReason("~\\x", winRoot, "target"), void 0);
    });
});

describe("genericTargets（保守扫描，T8）", () => {
    it("只收路径形态叶子，跳过普通文本与超长值", () => {
        const entries = genericTargets({name: "mcp__x", arguments: {
            good: "C:\\outside\\x",
            rel: "src/x",
            note: "hello world",
            big: "a".repeat(5000)
        }}, winRoot);
        assert.deepEqual(entries.map((entry) => entry.path), ["C:\\outside\\x"]);
    });
});
