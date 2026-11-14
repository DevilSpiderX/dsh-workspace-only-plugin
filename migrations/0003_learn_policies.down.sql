-- Migration: 0003_learn_policies
-- DOWN: 三表整体移除（学习数据可由事件重放重建，破坏性可接受）。
DROP TABLE IF EXISTS llm_tidy_runs;
DROP TABLE IF EXISTS llm_group_rules;
DROP TABLE IF EXISTS learned_policies;
