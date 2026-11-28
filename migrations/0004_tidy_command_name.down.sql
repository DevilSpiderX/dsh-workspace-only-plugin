-- Migration: 0004_tidy_command_name
-- DOWN: 撤销 1) 新增列与 2) 的建表（组规则表结构自 0003 起未变，重建后与 0003 形态一致）；
-- 被清掉的组规则数据不恢复——它们可由审批事件重新整理生成。
-- 注意：splitter 不支持块注释，迁移文件只写 `--` 行注释。
DROP TABLE IF EXISTS llm_group_rules;
CREATE TABLE IF NOT EXISTS llm_group_rules (
    id TEXT PRIMARY KEY,
    matcher TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
ALTER TABLE approval_events DROP COLUMN command_name;
