-- Migration: 0004_tidy_command_name
-- UP: T45 —— 两件事。
-- 1) approval_events 新增 command_name：LLM 整理投影必须用**与 L2 同一口径**的命令名
--    （归一 basename + pwsh 小写），旧实现现算 `command` 首词，把 `$javap`、`&`、
--    `[xml]$s`、`$env:MYSQL_PWD='hello123!';` 这类脚本碎片当命令名喂给模型，
--    归纳出的组规则与真实特征键永远对不上。只加列不重建：老行 command_name 为 NULL
--    是合法历史，整理投影对 NULL 回落到收紧后的首词推断（不可知即空串）。
-- 2) llm_group_rules 清空重建：T45 之前的产物是**整批垃圾**（现网 19 组里 12 组零样本、
--    19 组 dir 全为 `*` 等于放弃目录维度、多组命令名是脚本碎片），且组规则本就可以由
--    审批事件重新整理生成——按仓库约定「破坏性变更直接写在 up 里、不做数据迁移」整表清掉。
--    历史仍可在 llm_tidy_runs.output_json 追溯。
-- 注意：splitter 不支持块注释，迁移文件只写 `--` 行注释。
ALTER TABLE approval_events ADD COLUMN command_name TEXT;
DROP TABLE IF EXISTS llm_group_rules;
CREATE TABLE llm_group_rules (
    id TEXT PRIMARY KEY,
    matcher TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    allow_count INTEGER NOT NULL DEFAULT 0,
    deny_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
