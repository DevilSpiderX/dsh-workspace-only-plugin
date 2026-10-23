/**
 * 升级自检（任务 E3）。每次 dsh 升级后运行一次：
 *
 *   node scripts/check-compat.mjs [--asar <path/to/app.asar>]
 *
 * 对正在运行的 dsh 安装探测本插件依赖的确切契约，一旦发现漂移就打印可读的
 * 差异报告——绝不静默放过。探测来源按顺序为：profile node_modules
 * （$DSH_HOME/profiles/<name>/node_modules），然后是 Desktop 的 app.asar
 * （内嵌读取器），最后是 --asar。退出码 0 表示全部探测通过。
 *
 * 探测：
 *   1. `dsh-user-approval` 结果词汇与审计配对字段形状；
 *   2. `dsh-tools` `tools/pre-execute` 决策词汇（allow/deny/ask/cancel）；
 *   3. `dsh-session` 插件记录通道（`appendPluginRecord`/`pluginRecordOf`）；
 *   4. `dsh-user-questions` 问答接缝（`user-questions/request`，NO_PROVIDER）；
 *   5. `dsh-api-remotes` 转发事件白名单（approval/request、user-questions/request）；
 *   6. `schemastery` 的 `.volatile()` 字段（E1 配置通道）；
 *   7. client 模块表请求（lib/client.js 中每个 `require()` 都必须是某个已发布
 *      client bundle 已经请求过的模块）；
 *  11. `dsh-sandbox`/`dsh-sandbox-policy` 的升权语义，任务 T1 的跳过条件依赖
 *      于此（同档位放行、严格更宽档位阶梯、`ctx.sandboxPolicy` 解析）；
 *  12. `dsh-home-paths` 主目录解析，内置默认白名单依赖于此（非空 `$DSH_HOME`
 *      优先、空值视为未设置、波浪号展开、resolve）。
 */
import {closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

const failures = [];
const passes = [];

function record(ok, title, detail) {
    if (ok) passes.push(title);
    else failures.push({title, detail});
}

/** 最小 asar 读取器：返回 `path/in/asar` 处的文件文本，找不到则返回 undefined。 */
function readAsar(asarPath, entry) {
    let handle;
    try {
        handle = openSync(asarPath, "r");
    } catch {
        return void 0;
    }
    try {
        const head = Buffer.alloc(16);
        readSync(handle, head, 0, 16, 0);
        const headerSize = head.readUInt32LE(4);
        const header = Buffer.alloc(headerSize);
        readSync(handle, header, 0, headerSize, 8);
        const stringSize = header.readUInt32LE(4);
        const index = JSON.parse(header.toString("utf8", 8, 8 + stringSize));
        const dataStart = 8 + headerSize;
        let node = index;
        for (const part of entry.split("/")) {
            node = (node.files ?? {})[part];
            if (node === void 0) return void 0;
        }
        if (node.files !== void 0) return void 0;
        const offset = dataStart + Number(node.offset);
        const size = Number(node.size);
        const body = Buffer.alloc(size);
        readSync(handle, body, 0, size, offset);
        return body.toString("utf8");
    } catch {
        return void 0;
    } finally {
        closeSync(handle);
    }
}

/** 可解析 `@deepseek-ai/<pkg>` 源码的候选根目录。 */
function candidateRoots() {
    const roots = [];
    const asarArg = process.argv.indexOf("--asar");
    const explicit = asarArg >= 0 ? process.argv[asarArg + 1] : void 0;
    const asars = [
        explicit,
        process.env.DSH_ASAR,
        join(homedir(), "AppData", "Local", "Programs", "DeepSeek Harness", "resources", "app.asar"),
        "C:\\Program Files\\DeepSeek Harness\\resources\\app.asar",
        "D:\\Program Files\\DeepSeek Harness\\resources\\app.asar",
        "E:\\Program Files\\DeepSeek Harness\\resources\\app.asar",
        "C:\\Programs\\DeepSeek Harness\\resources\\app.asar",
        "D:\\Programs\\DeepSeek Harness\\resources\\app.asar",
        "E:\\Programs\\DeepSeek Harness\\resources\\app.asar",
        "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
    ].filter((value) => typeof value === "string" && value !== "");
    for (const asar of asars) if (existsSync(asar)) roots.push({kind: "asar", base: asar});
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const profiles = join(dshHome, "profiles");
    if (existsSync(profiles)) {
        for (const name of readdirSync(profiles)) {
            const modules = join(profiles, name, "node_modules", "@deepseek-ai");
            if (existsSync(modules)) roots.push({kind: "dir", base: modules});
        }
    }
    return roots;
}

/** 在所有候选根目录中定位一个打包的源文件。 */
function locate(pkg, file, roots) {
    for (const root of roots) {
        const entry = `dsh/node_modules/@deepseek-ai/${pkg}/${file}`;
        if (root.kind === "asar") {
            const text = readAsar(root.base, entry);
            if (text !== void 0) return {text, origin: root.base};
        } else {
            const path = join(root.base, pkg, file);
            if (existsSync(path) && statSync(path).isFile()) return {text: readFileSync(path, "utf8"), origin: path};
        }
    }
    return void 0;
}

function main() {
    const roots = candidateRoots();
    if (roots.length === 0) {
        console.error("check-compat: no dsh installation found — pass --asar <path/to/app.asar> or set DSH_HOME/DSH_ASAR");
        process.exit(1);
    }
    console.log(`check-compat: ${roots.length} source root(s): ${roots.map((root) => root.base).join(", ")}`);

    // 1. dsh-user-approval：封闭结果词汇 + 审计配对字段形状。
    {
        const found = locate("dsh-user-approval", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "dsh-user-approval present", "package not found in any source root");
        } else {
            const expected = ["allowed-once", "rejected", "cancelled", "unavailable"];
            const missing = expected.filter((outcome) => !found.text.includes(`"${outcome}"`));
            record(missing.length === 0, "approval outcome vocabulary", missing.length === 0 ? void 0 : `OUTCOMES drifted: ${missing.map((value) => JSON.stringify(value)).join(", ")} no longer appears in ${found.origin}`);
            const shapes = ['session.append("approval/asked"', 'session.append("approval/decided"', "toolName", "outcome"];
            const gone = shapes.filter((needle) => !found.text.includes(needle));
            record(gone.length === 0, "approval audit pair shape", gone.length === 0 ? void 0 : `audit fields drifted: ${gone.join(", ")} missing in ${found.origin}`);
            record(found.text.includes("ApprovalRequestId"), "ApprovalRequestId export", "ApprovalRequestId is gone; update lib/approval-compat.js");
        }
    }

    // 2. dsh-tools：pre-execute 决策词汇。
    {
        const found = locate("dsh-tools", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "dsh-tools present", "package not found in any source root");
        } else {
            const shapes = ['kind: "allow"', 'kind: "deny"', 'gate.kind === "ask"', 'decision.kind === "cancel"', '"tools/pre-execute"'];
            const gone = shapes.filter((needle) => !found.text.includes(needle));
            record(gone.length === 0, "pre-execute decision vocabulary", gone.length === 0 ? void 0 : `pre-execute contract drifted in ${found.origin}: missing ${gone.join(", ")}`);
        }
    }

    // 3. dsh-session：插件记录通道与已知事件类型。
    {
        const found = locate("dsh-session", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "dsh-session present", "package not found in any source root");
        } else {
            const shapes = ["function appendPluginRecord", "function pluginRecordOf", "isPluginRecordType", "ignorable: true"];
            const gone = shapes.filter((needle) => !found.text.includes(needle));
            record(gone.length === 0, "plugin-record channel", gone.length === 0 ? void 0 : `plugin-record API drifted in ${found.origin}: missing ${gone.join(", ")} — lib/session-state.js must be revisited`);
            const events = ['"sandbox/mode"', '"approval/asked"', '"approval/decided"'];
            const goneEvents = events.filter((needle) => !found.text.includes(needle));
            record(goneEvents.length === 0, "known session event types", goneEvents.length === 0 ? void 0 : `session event vocabulary drifted in ${found.origin}: missing ${goneEvents.join(", ")}`);
        }
    }

    // 4. dsh-user-questions：三键门禁所依托的问答接缝。
    {
        const found = locate("dsh-user-questions", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "dsh-user-questions present", "package not found — the three-choice question degrades to the system dialog fallback");
        } else {
            const shapes = ['"user-questions/request"', '"NO_PROVIDER"', "async ask(request)", "askTimed"];
            const gone = shapes.filter((needle) => !found.text.includes(needle));
            record(gone.length === 0, "user-questions ask seam", gone.length === 0 ? void 0 : `question seam drifted in ${found.origin}: missing ${gone.join(", ")}`);
        }
    }

    // 5. dsh-api-remotes：双向使用的转发事件白名单。
    {
        const found = locate("dsh-api-remotes", "lib/types/remote-events.js", roots) ?? locate("dsh-api-remotes", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "dsh-api-remotes present", "forwarded-event allowlist not found — client question/answer routing cannot be verified");
        } else {
            const has = (names) => names.some((needle) => found.text.includes(needle));
            const ok = has(["'approval/request'", '"approval/request"']) && has(["'user-questions/request'", '"user-questions/request"']);
            record(ok, "forwarded-event allowlist", ok ? void 0 : `approval/request or user-questions/request dropped from the allowlist in ${found.origin}; host→client asking breaks`);
        }
    }

    // 6. schemastery：volatile 配置字段（任务 E1）。
    {
        const found = locate("schemastery", "lib/index.mjs", roots) ?? locate("schemastery", "lib/index.cjs", roots);
        if (found === void 0) {
            record(false, "schemastery present", "package not found in any source root");
        } else {
            record(found.text.includes("volatile"), "volatile() config fields", "schemastery lost .volatile(); the E1 configuration channel must be revisited");
        }
    }

    // 8. client 模块表：lib/client.js 中每个 `require()` 都必须是某个已发布
    //    client bundle 已经请求过的模块。浏览器模块表是冻结的（PLATFORM_MODULES +
    //    声明的 dsh.client.external），因此已发布 bundle 都没请求过的 id 会导致
    //    插件激活被拒。
    {
        const baselineOwners = ["dsh-client-ui-layout", "dsh-client-ui-chat", "dsh-client-locale", "dsh-client-ui-conversation"];
        const baseline = new Set();
        for (const pkg of baselineOwners) {
            const found = locate(pkg, "lib/client.js", roots);
            if (found === void 0) continue;
            for (const match of found.text.matchAll(/require\("([^"]+)"\)/g)) baseline.add(match[1]);
        }
        const mine = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
        const requested = [...mine.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
        const unknown = requested.filter((spec) => !baseline.has(spec));
        record(baseline.size > 0 && unknown.length === 0, "client module table requests", baseline.size === 0 ? "no shipped client bundle found to derive the platform seed baseline" : unknown.length === 0 ? void 0 : `lib/client.js requires ${unknown.map((value) => JSON.stringify(value)).join(", ")} which no shipped client bundle requests — likely absent from the frozen platform module table (dsh-client-modules README: PLATFORM_MODULES + dsh.client.external)`);
    }

    // 11. dsh-sandbox / dsh-sandbox-policy 升权语义（任务 T1）：同档位不弹窗放行、
    //     严格更宽档位阶梯，以及跳过条件用来解析当前档位的 policy 服务。
    {
        const found = locate("dsh-sandbox", "lib/index.js", roots);
        const policy = locate("dsh-sandbox-policy", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "escalation semantics (T1)", "dsh-sandbox not found in any source root — the T1 skip condition cannot be verified");
        } else {
            const shapes = ["const WIDER_MODES", "const ESCALATION_TARGETS", "if (mode === effectiveMode) return effectiveMode;", "function validateEscalationArgs"];
            const policyShapes = policy === void 0 ? ['"sandboxPolicy" service'] : ['super(ctx, "sandboxPolicy")', "overrideOf"];
            const gone = [...shapes.filter((needle) => !found.text.includes(needle)), ...(policy === void 0 ? policyShapes : policyShapes.filter((needle) => !policy.text.includes(needle)))];
            record(gone.length === 0, "escalation semantics (T1)", gone.length === 0 ? void 0 : `escalation contract drifted: missing ${gone.join(", ")} — re-verify the lib/index.js skip condition before trusting it`);
        }
    }

    // 12. dsh-home-paths 主目录解析（内置默认白名单以同样方式解析 harness
    //     主目录）：非空 `$DSH_HOME` 优先、空值视为未设置、`~` 写法会展开，
    //     最终结果解析为绝对路径。
    {
        const found = locate("dsh-home-paths", "lib/index.js", roots);
        if (found === void 0) {
            record(false, "home resolution (builtin whitelist)", "dsh-home-paths not found in any source root — the builtinAlwaysDirs home resolution cannot be verified");
        } else {
            const shapes = ["function resolveDshHome(", "function expandHomePath(", "fromEnv.trim().length > 0", "return resolve(expandHomePath("];
            const gone = shapes.filter((needle) => !found.text.includes(needle));
            record(gone.length === 0, "home resolution (builtin whitelist)", gone.length === 0 ? void 0 : `home-path contract drifted in ${found.origin}: missing ${gone.join(", ")} — re-verify lib/scanner.js builtinAlwaysDirs before trusting the built-in whitelist`);
        }
    }

    // 13. T13 通知挂载面契约：徽章所在的会话标题 actions 槽位（紧跟子代理目录
    //     下拉之后）与徽章点击跳转所用的 uiWorkspace.openSession 导航（子代理
    //     目标必须是其 SubagentAddress——见 AGENTS.md）。T19：toast 的
    //     shell.overlay 浮层面随 toast 一并移除，不再看守。
    {
        const conversation = locate("dsh-client-ui-conversation", "lib/client.js", roots);
        const workspace = locate("dsh-client-ui-workspace", "lib/client.js", roots);
        const checks = [
            [conversation, "conversation.session.header.actions", "the header badge seat is gone — the T13 badge registration in lib/client.js must be revisited"],
            [workspace, "openSession", "uiWorkspace.openSession is gone — the T13 badge click-through must be revisited"]
        ];
        const gone = checks.filter(([found, needle]) => found === void 0 || !found.text.includes(needle));
        record(gone.length === 0, "notice surface contracts (T13)", gone.length === 0 ? void 0 : `T13 contract drifted: ${gone.map(([found, needle, why]) => `${found === void 0 ? "package missing" : `no ${needle}`} — ${why}`).join("; ")}`);
    }
    // 14. 共享 UI 原语以 shell seed 形态内联在冻结模块表中
    //     （`PLATFORM_MODULES` + `seed.ts` 内联 `dsh-client-ui-primitives`；
    //     app.asar 的 node_modules 里没有独立包，包路径探测会把活模块误报为
    //     已消失）。模块表的验证方式与探测 8 相同：已发布 client bundle 必须
    //     请求该 id——没有任何已发布 bundle 请求过的模块不在表中，插件 bundle
    //     无法解析它。（T19 起 Toast 原语不再使用，但包仍被控件与图标引用。）
    {
        const owners = ["dsh-client-ui-layout", "dsh-client-ui-chat", "dsh-client-locale", "dsh-client-ui-conversation", "dsh-client-ui-workspace"];
        let seeded = false;
        for (const pkg of owners) {
            const found = locate(pkg, "lib/client.js", roots);
            if (found === void 0) continue;
            if ([...found.text.matchAll(/require\("([^"]+)"\)/g)].some((match) => match[1] === "@deepseek-ai/dsh-client-ui-primitives")) {
                seeded = true;
                break;
            }
        }
        record(seeded, "shared UI primitive seed", seeded ? void 0 : "no shipped client bundle requests @deepseek-ai/dsh-client-ui-primitives — the shared UI primitives are missing from the frozen module table and the plugin controls cannot resolve them");
    }

    for (const title of passes) console.log(`PASS  ${title}`);
    for (const failure of failures) {
        console.log(`FAIL  ${failure.title}`);
        console.log(`      ${failure.detail}`);
    }
    console.log(`${passes.length}/${passes.length + failures.length} probes passed`);
    if (failures.length > 0) {
        console.log("check-compat: dsh drifted from the verified 0.2.1-rc.2 contracts — see the differences above before trusting the gate.");
        process.exitCode = 1;
    }
}

main();
