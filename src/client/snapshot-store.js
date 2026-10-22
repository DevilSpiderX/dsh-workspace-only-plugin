// Self-contained snapshot store: the 0.1 `@deepseek-ai/dsh-client-runtime`
// module no longer exists in the DSH 0.2 module table (it is not a seed
// word), and the replacement `@deepseek-ai/dsh-client-store` keeps
// evolving its update semantics, so this plugin carries the ~15 lines it
// needs. `update` accepts either a replacement value or a mutator that
// edits a draft (returning undefined keeps the mutated draft).
export const createSnapshotStore = (initial) => {
	let state = initial;
	const listeners = new Set();
	return {
		getSnapshot: () => state,
		update(next) {
			if (typeof next === "function") {
				const draft = { ...state };
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
