'use client';

// ==================== Supabase 初始化 ====================
// 支持 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY
// 同时支持自部署 Supabase 实例（只需修改环境变量 URL 即可）

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Supabase 是否已配置
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// 懒加载单例（防止热更新时重复创建）
let _client = null;

export function getSupabaseClient() {
    if (!isSupabaseConfigured) return null;
    if (!_client) {
        _client = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
        });
    }
    return _client;
}

export const supabase = isSupabaseConfigured ? getSupabaseClient() : null;
