/**
 * 自带 snapshot store：0.1 的 `@deepseek-ai/dsh-client-runtime` 模块在
 * DSH 0.2 模块表里已不存在（不是 seed word），替代品
 * `@deepseek-ai/dsh-client-store` 的 update 语义还在演进，所以本插件
 * 自带需要的这 ~15 行。`update` 接受替换值，或编辑草稿的 mutator
 * （返回 undefined 则保留已改的草稿）。
 */
export const createSnapshotStore = (initial) => {
    let state = initial;
    const listeners = new Set();
    return {
        getSnapshot: () => state,
        update(next) {
            if (typeof next === "function") {
                const draft = {...state};
                const result = next(draft);
                state = result === void 0 ? draft : result;
            } else {
                state = next;
            }
            for (const listener of [...listeners]) listener(state);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
};
