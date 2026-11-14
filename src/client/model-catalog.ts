/**
 * 模型目录解析（纯函数、无 React 依赖，可单测）。
 *
 * 契约（dsh `remote.session.modelCatalog()`，T39-fix）：响应是**结果包裹**
 * `{ok: true, value: ModelCatalog}`（官方 subagent-model-selection-card-controller
 * 用 `response.ok`/`response.value.groups` 解包）；裸 ModelCatalog 形态也兼容。
 * `ModelReasoningEffort` 是对象 `{id, name, description?}`——下拉 value 用 `effort.id`、
 * label 用 `effort.name`，`defaultEffort` 按 effort **id** 匹配（原实现按 string[] 过滤全丢）。
 */

/** 单个推理等级（对象条目；字符串条目容错为 id=name）。 */
export interface EffortLike {
    readonly id: string;
    readonly name: string;
}

/** 目录里的一个模型。 */
export interface CatalogModelLike {
    readonly id: string;
    readonly name: string;
    readonly badge?: string | undefined;
    /** 推理等级（畸形/缺省=空，下拉只剩「默认」）。 */
    readonly efforts: readonly EffortLike[];
    readonly defaultEffort?: string | undefined;
}

/** 一个 provider 分组（下拉的分组标题 = name）。 */
export interface CatalogGroupLike {
    readonly id: string;
    readonly name: string;
    readonly models: readonly CatalogModelLike[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
    const value = source[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 解析 efforts（对象条目取 id/name；字符串条目容错 id=name；畸形条目跳过）。 */
export function parseEfforts(raw: unknown): EffortLike[] {
    if (!Array.isArray(raw)) return [];
    const out: EffortLike[] = [];
    for (const entry of raw) {
        if (typeof entry === "string" && entry.length > 0) {
            out.push({ id: entry, name: entry });
            continue;
        }
        if (!isRecord(entry)) continue;
        const id = stringField(entry, "id");
        if (id === undefined) continue;
        out.push({ id, name: stringField(entry, "name") ?? id });
    }
    return out;
}

function parseModel(raw: unknown): CatalogModelLike | undefined {
    if (!isRecord(raw)) return undefined;
    const id = stringField(raw, "id");
    if (id === undefined) return undefined;
    const reasoning = isRecord(raw.reasoning) ? raw.reasoning : undefined;
    return {
        id,
        name: stringField(raw, "name") ?? id,
        badge: stringField(raw, "badge"),
        efforts: reasoning === undefined ? [] : parseEfforts(reasoning.efforts),
        defaultEffort: reasoning === undefined ? undefined : stringField(reasoning, "defaultEffort"),
    };
}

/**
 * 解析 modelCatalog() 响应：
 * ① `{ok, value}` 结果包裹（ok===false → []，否则取 value）；
 * ② 裸 ModelCatalog 形态兼容；
 * ③ 畸形分组/模型条目跳过（fail-safe，绝不整包拒绝）。
 */
export function parseCatalogGroups(raw: unknown): CatalogGroupLike[] {
    if (!isRecord(raw)) return [];
    let payload: unknown = raw;
    if ("ok" in raw || "value" in raw) {
        if (raw.ok === false) return [];
        if (raw.ok !== true && !("groups" in raw)) return [];
        payload = isRecord(raw.value) ? raw.value : raw;
    }
    if (!isRecord(payload) || !Array.isArray(payload.groups)) return [];
    const out: CatalogGroupLike[] = [];
    for (const group of payload.groups) {
        if (!isRecord(group)) continue;
        const id = stringField(group, "id");
        if (id === undefined || !Array.isArray(group.models)) continue;
        const models: CatalogModelLike[] = [];
        for (const model of group.models) {
            const parsed = parseModel(model);
            if (parsed !== undefined) models.push(parsed);
        }
        out.push({ id, name: stringField(group, "name") ?? id, models });
    }
    return out;
}

/**
 * 找 `defaultEffort` 命中的 effort id（按 id 精确匹配；无命中取第一个 effort 的 id；
 * 无 efforts → undefined =「默认」）。
 */
export function defaultEffortId(model: CatalogModelLike): string | undefined {
    if (model.defaultEffort !== undefined && model.efforts.some((effort) => effort.id === model.defaultEffort)) {
        return model.defaultEffort;
    }
    return model.efforts[0]?.id;
}
