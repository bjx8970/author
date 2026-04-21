'use client';

// ==================== Supabase Auth 封装 ====================
// 提供统一的认证接口，供 SettingsPanel 和 persistence 层使用

import { supabase, isSupabaseConfigured } from './supabase';

// ==================== 状态管理 ====================

let _currentUser = null;
const _listeners = new Set();

// 初始化认证状态监听（应在应用启动时调用一次）
export function initAuth() {
    if (!isSupabaseConfigured || !supabase) return;

    // 获取当前会话
    supabase.auth.getSession().then(({ data: { session } }) => {
        const user = session?.user ?? null;
        _currentUser = user ? _toUserProfile(user) : null;
        if (_currentUser) saveAccountToHistory(_currentUser);
        _listeners.forEach(fn => {
            try { fn(_currentUser); } catch (e) { console.error('[auth] listener error:', e); }
        });
    });

    // 监听后续变化
    supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user ?? null;
        _currentUser = user ? _toUserProfile(user) : null;
        if (_currentUser) saveAccountToHistory(_currentUser);
        _listeners.forEach(fn => {
            try { fn(_currentUser); } catch (e) { console.error('[auth] listener error:', e); }
        });
    });
}

// 将 Supabase user 对象转换为统一格式
function _toUserProfile(user) {
    return {
        uid: user.id,
        id: user.id,
        email: user.email || '',
        displayName: user.user_metadata?.display_name || user.user_metadata?.full_name || '',
        photoURL: user.user_metadata?.avatar_url || user.user_metadata?.photoURL || '',
        providerData: [{ providerId: 'password' }],
        metadata: {
            creationTime: user.created_at,
            lastSignInTime: user.last_sign_in_at,
        },
    };
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
    if (error) throw new Error(error.message);
    return _toUserProfile(data.user);
}

// 邮箱 + 密码注册
export async function signUpWithEmail(email, password) {
    if (!supabase) throw new Error('Supabase 未配置');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('注册成功，请检查邮箱完成验证');
    return _toUserProfile(data.user);
}

// 退出登录
export async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
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
    const updates = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (photoURL !== undefined) updates.photoURL = photoURL;
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw new Error(error.message);
    // 刷新内部缓存
    _currentUser = _toUserProfile(data.user);
    _listeners.forEach(fn => { try { fn(_currentUser); } catch {} });
}

// 切换账号：先退出再打开登录弹窗
export async function switchAccount() {
    if (!supabase) return;
    await supabase.auth.signOut();
}
