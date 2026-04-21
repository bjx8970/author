'use client';

// ==================== Supabase Auth 封装 ====================
// 提供统一的认证接口，供 SettingsPanel 和 persistence 层使用

import { supabase, isSupabaseConfigured } from './supabase';

// ==================== 用户对象归一化 ====================
// 将 Supabase 用户对象转换为应用内统一格式

function normalizeUser(supabaseUser) {
    if (!supabaseUser) return null;
    return {
        uid: supabaseUser.id,
        id: supabaseUser.id,
        email: supabaseUser.email,
        displayName: supabaseUser.user_metadata?.display_name || supabaseUser.user_metadata?.full_name || null,
        photoURL: supabaseUser.user_metadata?.avatar_url || null,
        metadata: {
            creationTime: supabaseUser.created_at,
            lastSignInTime: supabaseUser.last_sign_in_at,
        },
        providerData: [{ providerId: 'password' }],
    };
}

// ==================== 状态管理 ====================

let _currentUser = null;
const _listeners = new Set();

// 初始化认证状态监听（应在应用启动时调用一次）
export function initAuth() {
    if (!isSupabaseConfigured || !supabase) return;

    // 获取当前会话
    supabase.auth.getSession().then(({ data: { session } }) => {
        const normalized = normalizeUser(session?.user ?? null);
        _currentUser = normalized;
        if (normalized) saveAccountToHistory(normalized);
        _listeners.forEach(fn => {
            try { fn(normalized); } catch (e) { console.error('[auth] listener error:', e); }
        });
    });

    // 监听后续状态变化
    supabase.auth.onAuthStateChange((_event, session) => {
        const normalized = normalizeUser(session?.user ?? null);
        _currentUser = normalized;
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
            provider: 'password',
            lastLogin: Date.now(),
        };
        if (existing >= 0) {
            history[existing] = entry;
        } else {
            history.unshift(entry);
        }
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
    // Supabase 注册后可能需要邮件验证，user 可能为 null
    if (!data.user) throw new Error('注册成功，请检查邮箱完成验证后登录');
    return normalizeUser(data.user);
}

// 退出登录
export async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
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
    const metadata = {};
    if (displayName !== undefined) metadata.display_name = displayName;
    if (photoURL !== undefined) metadata.avatar_url = photoURL;

    const { data, error } = await supabase.auth.updateUser({ data: metadata });
    if (error) throw error;

    // 刷新内部缓存
    const normalized = normalizeUser(data.user);
    _currentUser = normalized;
    _listeners.forEach(fn => { try { fn(normalized); } catch {} });
}

// 切换账号：先退出
export async function switchAccount() {
    if (!supabase) return;
    await supabase.auth.signOut();
}
