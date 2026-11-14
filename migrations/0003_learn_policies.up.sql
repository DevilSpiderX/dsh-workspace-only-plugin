-- Migration: 0003_learn_policies
-- UP: T39 学习层重设计 —— 审批意图策略表（learned_policies，L2 自动通过）、
-- LLM 归并组规则表（llm_group_rules）与 LLM 整理审计表（llm_tidy_runs）。
-- id 主键一律 uuidv7（AGENTS.md 数据库约定）；只写 `--` 行注释。
CREATE TABLE IF NOT EXISTS learned_policies (
    id TEXT PRIMARY KEY,
    feature_key TEXT NOT NULL UNIQUE,
    layer INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command_name TEXT NOT NULL DEFAULT '',
    dir TEXT NOT NULL DEFAULT '',
    sample_count INTEGER NOT NULL DEFAULT 0,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'stat',
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policies_tool ON learned_policies(tool, layer);
CREATE TABLE IF NOT EXISTS llm_group_rules (
    id TEXT PRIMARY KEY,
    matcher TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_tidy_runs (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    model TEXT NOT NULL,
    prompt_digest TEXT,
    output_json TEXT,
    status TEXT NOT NULL,
    applied_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tidy_time ON llm_tidy_runs(created_at);
