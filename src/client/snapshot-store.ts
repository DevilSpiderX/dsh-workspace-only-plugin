/**
 * 自带 snapshot store：0.1 的 `@deepseek-ai/dsh-client-runtime` 模块在
 * DSH 0.2 模块表里已不存在（不是 seed word），替代品
 * `@deepseek-ai/dsh-client-store` 的 update 语义还在演进，所以本插件
 * 自带需要的这 ~15 行。`update` 接受替换值，或编辑草稿的 mutator
 * （返回 undefined 则保留已改的草稿）。
 *
 * 注意（契约）：`update` 的浅草稿 `{...state}` 对数组不安全——集合状态用
 * 对象包裹（`{ entries: [...] }`）走草稿模式，或整替返回新数组。
 */
export type SnapshotMutator<T> = (draft: T) => T | void;

export interface SnapshotStore<T extends object> {
    getSnapshot(): T;
    update(next: T | SnapshotMutator<T>): void;
    subscribe(listener: (state: T) => void): () => void;
}

export const createSnapshotStore = <T extends object>(initial: T): SnapshotStore<T> => {
    let state = initial;
    const listeners = new Set<(state: T) => void>();
    return {
        getSnapshot: () => state,
        update(next: T | SnapshotMutator<T>): void {
            if (typeof next === "function") {
                const draft = {...state};
                const result = (next as SnapshotMutator<T>)(draft);
                state = result === void 0 ? draft : result;
            } else {
                state = next;
            }
            for (const listener of [...listeners]) listener(state);
        },
        subscribe(listener: (state: T) => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
};
