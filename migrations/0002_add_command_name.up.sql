-- Migration: 0002_add_command_name
-- UP: hit_events 新增 token 所属命令的归一名（五段签名 `工具|命令|角色|形态|引号` 落库）。
-- 只加列、不 DROP 重建：老数据全保留（老行 command_name 为 NULL 是合法历史）；
-- 老四段 shape_sig 与新五段签名字符串天然异键、精确匹配永不命中，无需清理。
-- 注意：splitter 不支持块注释，迁移文件只写 `--` 行注释。
ALTER TABLE hit_events ADD COLUMN command_name TEXT;
