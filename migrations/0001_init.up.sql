-- Migration: 0001_init
-- UP: learn.sqlite3 初始结构（id 主键一律 uuidv7；AGENTS.md 数据库约定）。
-- 注意：splitter 不支持块注释，迁移文件只写 `--` 行注释。
CREATE TABLE IF NOT EXISTS hit_events (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command TEXT,
    token TEXT NOT NULL,
    shape_sig TEXT NOT NULL,
    role TEXT NOT NULL,
    shape TEXT,
    hit_reason TEXT NOT NULL,
    is_focus INTEGER NOT NULL,
    session_id TEXT,
    verdict TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_shape ON hit_events(shape_sig, at);
CREATE INDEX IF NOT EXISTS idx_events_time ON hit_events(at);
CREATE TABLE IF NOT EXISTS learned_exemptions (
    id TEXT PRIMARY KEY,
    shape TEXT NOT NULL UNIQUE,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    timeout_count INTEGER NOT NULL DEFAULT 0,
    exempt INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approval_events (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    tool TEXT NOT NULL,
    command TEXT,
    dir TEXT NOT NULL,
    reason TEXT,
    targets TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0,
    verdict TEXT NOT NULL,
    channel TEXT NOT NULL,
    ms INTEGER NOT NULL,
    session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_time ON approval_events(at);
CREATE INDEX IF NOT EXISTS idx_approval_verdict ON approval_events(verdict, at);
