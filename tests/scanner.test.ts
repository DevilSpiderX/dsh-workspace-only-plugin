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
    shellEntries,
    toWindowsSpelling,
    toolAccessKind
} from "../src/host/scanner.ts";

const winRoot = "C:\\work\\project";
const posixRoot = "/home/me/project";

describe("shellEntries（命令开关与正则碎片，T46）", () => {
    it("`cmd /c` 的开关不产生路径条目（生产机主因）", () => {
        assert.deepEqual(shellEntries("cmd /c \"mvnw.cmd -o test\"", winRoot, "pwsh"), []);
        assert.deepEqual(shellEntries("cmd /c \"mvnw.cmd -o test\"", winRoot, "bash"), []);
        assert.deepEqual(shellEntries("cmd /k dir", winRoot, "pwsh"), []);
    });

    it("开关被豁免，但引号内的越界路径照样拦", () => {
        const entries = shellEntries("cmd /c \"type C:\\tmp\\x\"", winRoot, "pwsh");
        assert.deepEqual(entries.map((entry) => entry.path), ["C:\\tmp\\x"]);
        assert.equal(entries[0].outside, true);
    });

    it("非白名单命令的 /c、/etc 仍是路径（方向锁不放宽）", () => {
        assert.equal(shellEntries("cat /c", winRoot, "pwsh")[0]?.outside, true);
        assert.equal(shellEntries("cat /etc", winRoot, "pwsh")[0]?.outside, true);
        assert.equal(shellEntries("cmd /c/Users/Devil", winRoot, "pwsh")[0]?.outside, true);
    });

    it("反斜杠转义序列不产生路径条目，硬 UNC 仍拦", () => {
        assert.deepEqual(shellEntries("Where-Object { $_.FullName -notmatch '\\\\target\\\\' }", winRoot, "pwsh"), []);
        assert.deepEqual(shellEntries("Get-ChildItem | ? { $_.Name -like '\\d' }", winRoot, "pwsh"), []);
        const unc = shellEntries("type '\\\\server\\share\\x'", winRoot, "pwsh");
        assert.equal(unc.some((entry) => entry.outside === true), true);
    });
});

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

describe("toWindowsSpelling（MSYS 盘符写法归一，T41）", () => {
    it("单字母段=盘符：/c/x 与 /cygdrive/c/x", () => {
        assert.equal(toWindowsSpelling("/c/Code/internal"), "C:\\Code\\internal");
        assert.equal(toWindowsSpelling("/cygdrive/c/Code"), "C:\\Code");
        assert.equal(toWindowsSpelling("/c"), "C:\\");
        assert.equal(toWindowsSpelling("/C/"), "C:\\");
    });

    it("多字母段与相对写法原样返回（POSIX 根不受影响）", () => {
        assert.equal(toWindowsSpelling("/etc/passwd"), "/etc/passwd");
        assert.equal(toWindowsSpelling("/usr/local/bin"), "/usr/local/bin");
        assert.equal(toWindowsSpelling("/cc/Code"), "/cc/Code");
        assert.equal(toWindowsSpelling("c/Code"), "c/Code");
        assert.equal(toWindowsSpelling("C:\\Code"), "C:\\Code");
    });
});

describe("MSYS 盘符形态与盘符形态互相命中（T41：白名单不同写法不再失效）", () => {
    it("目标 /c/... 落在白名单 C:\\Code 内", () => {
        assert.equal(lexicallyWithin("/c/Code/internal/business-platform-server-wt1", "C:\\Code"), true);
        assert.equal(lexicallyWithin("/c/Code/internal/a.txt", "c:\\code"), true);
        assert.equal(lexicallyWithin("/cygdrive/c/Code/x", "C:\\Code"), true);
    });

    it("反向：盘符目标落在 /c/... 条目内", () => {
        assert.equal(lexicallyWithin("C:\\Code\\internal\\a.txt", "/c/Code"), true);
    });

    it("逃逸与跨盘符仍判外部", () => {
        assert.equal(lexicallyWithin("/c/Other/x", "C:\\Code"), false);
        assert.equal(lexicallyWithin("/d/Code/x", "C:\\Code"), false);
        assert.equal(lexicallyWithin("/c/Code/../Other/x", "C:\\Code"), false);
    });

    it("两侧都不是 Windows 形态时不做归一（POSIX 语义保持）", () => {
        assert.equal(lexicallyWithin("/c/Code/x", "/c"), true);
        assert.equal(lexicallyWithin("/c/Code/x", "/home/me"), false);
        assert.equal(lexicallyWithin("/etc/passwd", posixRoot), false);
    });

    it("sameLocation 跨拼写成立", () => {
        assert.equal(sameLocation("/c/Code", "C:\\Code"), true);
        assert.equal(sameLocation("/c/Code", "C:\\Other"), false);
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

    it("MSYS 目标命中盘符形态 deny 规则（T41）", () => {
        assert.equal(denyMatch("/c/secret/a.pem", ["C:\\secret\\"]), "C:\\secret\\");
        assert.equal(denyMatch("/c/secret/a.pem", ["C:\\secret\\*.pem"]), "C:\\secret\\*.pem");
        assert.equal(denyMatch("/c/other/a.pem", ["C:\\secret\\*.pem"]), void 0);
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

    it("Windows 宿主上 MSYS 写法归一为盘符写法（T41：卡片目录与白名单同拼写）", () => {
        assert.equal(directoryOf("/c/Code/internal/a.txt", true), "C:\\Code\\internal");
        assert.equal(directoryOf("/c/Code/internal/business-platform-server-wt1", true), "C:\\Code\\internal");
        assert.equal(directoryOf("/c/Code/internal/", true), "C:\\Code\\internal\\");
    });

    it("POSIX 宿主上保持原写法（那是根下的 c 目录，不是盘符）", () => {
        assert.equal(directoryOf("/c/Code/internal/a.txt", false), "/c/Code/internal");
        assert.equal(directoryOf("/home/me/a.txt", false), "/home/me");
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
