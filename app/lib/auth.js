'use client';

// ==================== Supabase Auth 封装 ====================
// 提供统一的认证接口，供 SettingsPanel 和 persistence 层使用

import { supabase, isSupabaseConfigured } from './supabase';

// ==================== 用户对象规范化 ====================

/**
 * 将 Supabase 用户对象转换为与原 Firebase 用户形状兼容的结构
 * 对外暴露 uid / displayName / photoURL / providerData / metadata
 */
function normalizeUser(supabaseUser) {
    if (!supabaseUser) return null;
    const meta = supabaseUser.user_metadata || {};
    const appMeta = supabaseUser.app_metadata || {};
    return {
        uid: supabaseUser.id,
        email: supabaseUser.email,
        displayName: meta.full_name || meta.name || null,
        photoURL: meta.avatar_url || meta.picture || null,
        providerData: [{
            // 将 Supabase provider 名称映射为与 Firebase 兼容的 providerId 格式
            providerId: appMeta.provider
                ? (appMeta.provider === 'email' ? 'password' : `${appMeta.provider}.com`)
                : 'password',
        }],
        metadata: {
            creationTime: supabaseUser.created_at,
            lastSignInTime: supabaseUser.last_sign_in_at,
        },
        // 保留原始引用，供需要时访问
        _raw: supabaseUser,
    };
}

// ==================== 状态管理 ====================

let _currentUser = null;
const _listeners = new Set();

// 初始化认证状态监听（应在应用启动时调用一次）
export function initAuth() {
    if (!isSupabaseConfigured || !supabase) return;

    supabase.auth.onAuthStateChange((event, session) => {
        const normalized = normalizeUser(session?.user ?? null);
        _currentUser = normalized;
        // 记录登录过的账号到历史
        if (normalized) saveAccountToHistory(normalized);
        _listeners.forEach(fn => {
            try { fn(normalized); } catch (e) { console.error('[auth] listener error:', e); }
        });
    });
}

// ==================== 账号历史 ====================

const ACCOUNT_HISTORY_KEY = 'author-account-history';

function saveAccountToHistory(user) {
    if (typeof window === 'undefined' || !user) return;
    try {
        const history = getAccountHistory();
        const existing = history.findIndex(a => a.uid === user.uid);
        const entry = {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            photoURL: user.photoURL || '',
            provider: user.providerData?.[0]?.providerId || 'password',
            lastLogin: Date.now(),
        };
        if (existing >= 0) {
            history[existing] = entry;
        } else {
            history.unshift(entry);
        }
        // 最多保存 5 个账号
        localStorage.setItem(ACCOUNT_HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
    } catch {}
}

export function getAccountHistory() {
    if (typeof window === 'undefined') return [];
    try {
        return JSON.parse(localStorage.getItem(ACCOUNT_HISTORY_KEY) || '[]');
    } catch { return []; }
}

export function removeAccountFromHistory(uid) {
    if (typeof window === 'undefined') return;
    try {
        const history = getAccountHistory().filter(a => a.uid !== uid);
        localStorage.setItem(ACCOUNT_HISTORY_KEY, JSON.stringify(history));
    } catch {}
}

// 获取当前登录用户
export function getCurrentUser() {
    return _currentUser;
}

// 是否已登录
export function isSignedIn() {
    return _currentUser !== null;
}

// 注册认证状态变化回调
export function onAuthChange(callback) {
    _listeners.add(callback);
    // 立即通知当前状态
    if (_currentUser !== undefined) callback(_currentUser);
    return () => _listeners.delete(callback);
}

// ==================== 登录方法 ====================

// 邮箱 + 密码登录
export async function signInWithEmail(email, password) {
    if (!supabase) throw new Error('Supabase 未配置');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return normalizeUser(data.user);
}

// 邮箱 + 密码注册
export async function signUpWithEmail(email, password) {
    if (!supabase) throw new Error('Supabase 未配置');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return normalizeUser(data.user);
}

// 退出登录
export async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
}

// ==================== 工具方法 ====================

// 获取用户显示信息
export function getUserProfile() {
    if (!_currentUser) return null;
    return {
        uid: _currentUser.uid,
        email: _currentUser.email,
        displayName: _currentUser.displayName,
        photoURL: _currentUser.photoURL,
    };
}

// 更新用户个人资料（昵称 / 头像）
export async function updateUserProfile({ displayName, photoURL }) {
    if (!supabase) throw new Error('未登录');
    const updateData = {};
    if (displayName !== undefined) updateData.full_name = displayName;
    if (photoURL !== undefined) updateData.avatar_url = photoURL;
    const { data, error } = await supabase.auth.updateUser({ data: updateData });
    if (error) throw error;
    // 刷新内部缓存
    const normalized = normalizeUser(data.user);
    _currentUser = normalized;
    _listeners.forEach(fn => { try { fn(_currentUser); } catch {} });
}

// 切换账号：先退出再打开登录弹窗
export async function switchAccount() {
    if (!supabase) return;
    await supabase.auth.signOut();
}
