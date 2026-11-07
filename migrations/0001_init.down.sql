-- Migration: 0001_init
-- DOWN: 破坏性回退（用户约定允许破坏性更新：数据可丢，直接重建）。
DROP TABLE IF EXISTS hit_events;
DROP TABLE IF EXISTS learned_exemptions;
DROP TABLE IF EXISTS approval_events;
