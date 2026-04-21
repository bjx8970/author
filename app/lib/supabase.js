'use client';

// ==================== Supabase 初始化 ====================
// 支持官方 Supabase 云服务及自部署实例
// 通过 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY 配置
// 自部署时只需将 URL 指向自己的 Supabase 实例即可

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 是否已配置 Supabase（用户/开发者是否填好了环境变量）
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default supabase;
