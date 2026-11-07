/**
 * UUIDv7 生成器（时间有序，零依赖）。
 *
 * 布局（RFC 9562）：48 位 unix 毫秒（big-endian）+ 12 位 rand_a +
 * version 7 + 62 位 rand_b + variant 10。同毫秒内 rand_a 单调递增
 * （耗尽借位到时间戳），时钟回拨也不倒退 —— 保证 id 即时间序，
 * 数据库主键一律使用它（AGENTS.md「数据库 id 一律 uuidv7」条目）。
 */
import {randomBytes} from "node:crypto";

let lastMs = -1;
let lastRandA = 0;

export function uuidv7(now: number = Date.now()): string {
    let ms = Math.trunc(now);
    if (ms <= lastMs) {
        // 同毫秒递增；时钟回拨一律保持单调（借位到时间戳）。
        lastRandA += 1;
        if (lastRandA > 0xfff) {
            lastMs = ms = lastMs + 1;
            lastRandA = randomBytes(2).readUInt16BE(0) & 0xfff;
        } else {
            ms = lastMs;
        }
    } else {
        lastMs = ms;
        lastRandA = randomBytes(2).readUInt16BE(0) & 0xfff;
    }
    const bytes = randomBytes(16);
    const ts = BigInt(ms);
    bytes[0] = Number((ts >> 40n) & 0xffn);
    bytes[1] = Number((ts >> 32n) & 0xffn);
    bytes[2] = Number((ts >> 24n) & 0xffn);
    bytes[3] = Number((ts >> 16n) & 0xffn);
    bytes[4] = Number((ts >> 8n) & 0xffn);
    bytes[5] = Number(ts & 0xffn);
    bytes[6] = ((lastRandA >> 8) & 0x0f) | 0x70;
    bytes[7] = lastRandA & 0xff;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUIDv7 的规范形态（测试/校验用）。 */
export const UUIDV7_PATTERN = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
