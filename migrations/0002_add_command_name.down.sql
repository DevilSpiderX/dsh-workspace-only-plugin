-- Migration: 0002_add_command_name
-- DOWN: 删除命令名列（老行的 NULL 列随之丢弃，破坏性可接受）。
ALTER TABLE hit_events DROP COLUMN command_name;
