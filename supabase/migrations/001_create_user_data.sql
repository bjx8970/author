-- ============================================================
--  Author App — Supabase 数据库迁移
--  版本：001  创建云同步数据表并启用行级安全策略（RLS）
-- ============================================================
--
--  使用方法：
--    在 Supabase 项目的 SQL 编辑器（Dashboard → SQL Editor）中
--    粘贴并执行此文件内容，或使用 Supabase CLI：
--      supabase db push
--
--  支持自部署 Supabase：
--    此迁移文件同样适用于自部署实例，无需任何修改。
-- ============================================================

-- ==================== 创建用户数据表 ====================

CREATE TABLE IF NOT EXISTS user_data (
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL,
    value       JSONB,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

-- 为 user_id 建立索引，加快按用户查询的速度
CREATE INDEX IF NOT EXISTS user_data_user_id_idx ON user_data (user_id);

-- ==================== 启用行级安全策略（RLS）====================
-- RLS 确保每个用户只能读写自己的数据，即使客户端直接访问 Supabase 也安全

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

-- 查询策略：用户只能读取自己的数据
CREATE POLICY "users_select_own_data"
    ON user_data
    FOR SELECT
    USING (auth.uid() = user_id);

-- 写入策略：用户只能写入自己的数据
CREATE POLICY "users_insert_own_data"
    ON user_data
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 更新策略：用户只能更新自己的数据
CREATE POLICY "users_update_own_data"
    ON user_data
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 删除策略：用户只能删除自己的数据
CREATE POLICY "users_delete_own_data"
    ON user_data
    FOR DELETE
    USING (auth.uid() = user_id);

-- ==================== 自动更新 updated_at ====================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_data_updated_at
    BEFORE UPDATE ON user_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
