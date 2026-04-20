'use client';

// ==================== Supabase 初始化 ====================
// 使用环境变量配置，支持 Next.js NEXT_PUBLIC_ 前缀

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Supabase 是否已配置（用户/开发者是否填好了环境变量）
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            // 使用隐式流程，无需服务端回调路由，适合 SPA / Electron
            flowType: 'implicit',
            persistSession: true,
            autoRefreshToken: true,
        },
    })
    : null;

export default supabase;
