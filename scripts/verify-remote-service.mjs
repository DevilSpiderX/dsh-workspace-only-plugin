#!/usr/bin/env node
/**
 * Remote 服务 wire 契约三方一致性看守（T22）。
 *
 * 事故背景：Gateway 的 source-mode 用 `Function.prototype.toString()` 从方法
 * 形参名提取 `args` 的 wire 字段名（gateway 的 `methodParameterNames`），而
 * `lib/remote-service.js` 是全压缩产物、形参名被 mangle 成 `e`/`t`，曾使全部
 * 带参端点报 `args fields do not match the descriptor: unexpected "..."`
 * （白名单添加/移除、权限选择栏、三键卡片应答全数失效）。修复后 wire 名固化
 * 在 `REMOTE_WIRES`（字符串字面量、免疫压缩）并注册 strict 描述符，但三方
 * 契约仍必须一致，本脚本逐项看守：
 *
 *   1. 源码形参名 == `REMOTE_WIRES`（source-mode 兜底通道 + 位置传参顺序）；
 *   2. `lib/` 产物的 `REMOTE_WIRES`/`REMOTE_METHODS` == 源码（导出面在压缩后
 *      存活、表未漂移），且各方法形参个数与 wire 个数一致；
 *   3. 客户端 `call()` 发出的 args 键都是 `REMOTE_WIRES` 的子集
 *      （gateway 对缺省 src-json 参数放行，但 wire 外的键必报 unexpected）。
 *
 * 用法：`node scripts/verify-remote-service.mjs`（需先 `pnpm build` 生成 lib/）。
 */
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

let pass = 0;
let total = 0;
function check(ok, label) {
    total += 1;
    if (ok) pass += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}

/** 模拟 gateway 的 `methodParameterNames`：取形参段按逗号切分。 */
function parameterNames(source, method) {
    const match = new RegExp(`async\\s+${method}\\(([^)]*)\\)`).exec(source);
    if (match === null) return null;
    const body = match[1].trim();
    return body === "" ? [] : body.split(",").map((part) => part.trim());
}

/**
 * 解析 `call("method", {a, b})` 调用点的 args 键。
 * 兼容简写属性（`{dir, sessionId}`）与显式键（`{requestId: ask.requestId}`）。
 */
function callArgumentKeys(source) {
    const found = new Map();
    const pattern = /\.call\("(\w+)",\s*\{([^}]*)\}\)/g;
    for (const match of source.matchAll(pattern)) {
        const keys = match[2].trim() === ""
            ? []
            : match[2].split(",").map((part) => part.split(":")[0].trim());
        found.set(match[1], [...(found.get(match[1]) ?? []), keys]);
    }
    return found;
}

const srcSource = read("src/host/remote-service.js");
const srcModule = await import(pathToFileURL(join(ROOT, "src/host/remote-service.js")).href);
const wires = srcModule.REMOTE_WIRES;

// 1. 源码形参名 == REMOTE_WIRES。
for (const [method, expected] of Object.entries(wires)) {
    const names = parameterNames(srcSource, method);
    const ok = names !== null
        && names.length === expected.length
        && names.every((name, index) => name === expected[index]);
    check(ok, `src params ${method}(${names?.join(", ") ?? "?"}) == wires (${expected.join(", ")})`);
}

// 2. lib 产物：表存活且未漂移 + 形参个数与 wire 个数一致（strict 位置传参）。
let libSource = null;
try {
    libSource = read("lib/remote-service.js");
} catch {
    console.error("FAIL  lib/remote-service.js 缺失——先跑 pnpm build");
    process.exit(1);
}
const libModule = await import(pathToFileURL(join(ROOT, "lib/remote-service.js")).href);
check(JSON.stringify(libModule.REMOTE_WIRES) === JSON.stringify(wires), "lib REMOTE_WIRES == src REMOTE_WIRES");
check(JSON.stringify(libModule.REMOTE_METHODS) === JSON.stringify(srcModule.REMOTE_METHODS), "lib REMOTE_METHODS == src REMOTE_METHODS");
for (const [method, expected] of Object.entries(wires)) {
    const names = parameterNames(libSource, method);
    check(names !== null && names.length === expected.length,
        `lib arity ${method}(${names?.length ?? "?"} params) == ${expected.length} wires`);
}

// 3. 客户端 args 键必须是 wire 集合的子集（缺省放行，wire 外的键必报 unexpected）。
for (const file of ["src/client/settings-store.js", "src/client/index.jsx"]) {
    for (const [method, occurrences] of callArgumentKeys(read(file))) {
        const expected = wires[method];
        if (expected === undefined) {
            check(false, `${file} call("${method}") 不在 REMOTE_WIRES 里`);
            continue;
        }
        for (const keys of occurrences) {
            const ok = keys.every((key) => expected.includes(key));
            check(ok, `${file} call("${method}", {${keys.join(", ")}}) ⊆ wires (${expected.join(", ")})`);
        }
    }
}

console.log(`${pass}/${total} passed`);
if (pass !== total) process.exitCode = 1;
