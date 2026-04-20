-- ==================== Author App — Supabase 数据库初始化 ====================
-- 执行方式：在 Supabase 项目的 SQL 编辑器中粘贴并运行此脚本

-- 1. 创建用户数据表
CREATE TABLE IF NOT EXISTS user_data (
    user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key      TEXT        NOT NULL,
    value    JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

-- 2. 启用行级安全策略（Row Level Security）
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

-- 3. 策略：用户只能访问自己的数据
CREATE POLICY "Users can manage their own data"
    ON user_data
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 4. 创建索引，加速按 user_id 查询
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data (user_id);
