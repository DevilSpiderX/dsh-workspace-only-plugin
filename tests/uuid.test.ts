/**
 * uuid.ts 单点测试（UUIDv7 形态、时间序、单调性）。
 */
import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {uuidv7, UUIDV7_PATTERN} from "../src/host/uuid.ts";

describe("uuidv7（时间有序 UUID）", () => {
    it("符合 UUIDv7 规范形态（version 7 / variant 10）", () => {
        for (let i = 0; i < 100; i += 1) {
            assert.match(uuidv7(), UUIDV7_PATTERN);
        }
    });

    it("高 48 位是 unix 毫秒", () => {
        // 用未来时间：过去/回拨时刻由单调性接管（那是另一个用例的契约）。
        const now = Date.now() + 60_000;
        const id = uuidv7(now);
        const ts = BigInt("0x" + id.replace(/-/g, "").slice(0, 12));
        assert.equal(Number(ts), now);
    });

    it("同毫秒严格单调递增", () => {
        const now = 1_794_000_000_000;
        let previous = uuidv7(now);
        for (let i = 0; i < 2000; i += 1) {
            const next = uuidv7(now);
            assert.ok(next > previous, `${next} > ${previous}`);
            previous = next;
        }
    });

    it("时钟回拨不倒退", () => {
        const base = uuidv7(1_794_000_000_000);
        const afterRollback = uuidv7(1_793_000_000_000);
        assert.ok(afterRollback > base);
    });

    it("批量唯一", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 5000; i += 1) ids.add(uuidv7());
        assert.equal(ids.size, 5000);
    });
});
