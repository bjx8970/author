'use client';

// ==================== Supabase 同步层 ====================
// 本地优先 + 云端智能同步
// 数据变化时启动同步，5分钟无变化后停止定时器，直到下次变化
//
// 数据表结构（需在 Supabase 中建表，参见 supabase/migrations/）：
//   user_data(user_id uuid, key text, value jsonb, updated_at timestamptz)
//   启用 Row Level Security：用户只能访问自己的数据

import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrentUser } from './auth';

// ==================== 配置 ====================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 分钟
const IDLE_TIMEOUT = 5 * 60 * 1000;  // 5 分钟无变化后停止自动同步
const TABLE_NAME = 'user_data';

// ==================== 同步队列 ====================

const _pendingWrites = new Map();    // key → { value, timestamp }
let _syncTimer = null;
let _isSyncing = false;
let _idleTimer = null;               // 空闲检测定时器
let _firstSyncAfterLogin = true;     // 登录后第一次同步标志（强制真实同步）

// 同步状态回调
let _syncStatusCallback = null;
export function onSyncStatusChange(callback) {
    _syncStatusCallback = callback;
}

function notifySyncStatus(status) {
    if (_syncStatusCallback) {
        _syncStatusCallback({
            ...status,
            keys: Array.from(_pendingWrites.keys())
        });
    }
}

// ==================== 读写接口 ====================

/**
 * 从 Supabase 读取数据
 * @param {string} key - 存储键名
 * @returns {Promise<any>} 数据值，不存在返回 undefined
 */
export async function supabaseGet(key) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return undefined;

    try {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('value')
            .eq('user_id', user.uid)
            .eq('key', key)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return undefined; // 未找到
            throw error;
        }
        return data?.value;
    } catch (err) {
        console.warn('[supabase] GET failed:', key, err.message);
        return undefined;
    }
}

/**
 * 将数据加入同步队列（不立即写入 Supabase）
 * 同时启动/重置空闲检测定时器
 * @param {string} key - 存储键名
 * @param {any} value - 要存储的值
 */
export function supabaseEnqueue(key, value) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return;

    _pendingWrites.set(key, { value, timestamp: Date.now() });
    notifySyncStatus({ pending: _pendingWrites.size });

    ensureSyncTimer();
    resetIdleTimer();
}

/**
 * 启动同步定时器（如果未运行）
 */
function ensureSyncTimer() {
    if (!_syncTimer) {
        _syncTimer = setInterval(flushSync, SYNC_INTERVAL);
        console.log('[supabase] sync timer started');
    }
}

/**
 * 停止同步定时器
 */
function clearSyncTimer() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
        console.log('[supabase] sync timer stopped (idle)');
    }
}

/**
 * 重置空闲检测定时器
 */
function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        flushSync().then(() => {
            clearSyncTimer();
            notifySyncStatus({
                syncing: false,
                pending: 0,
                lastSync: Date.now(),
                idle: true,
            });
            console.log('[supabase] auto-sync paused: no data changes for 5 minutes');
        });
    }, IDLE_TIMEOUT);
}

/**
 * 立即删除数据（加入队列等待批量处理）
 * @param {string} key - 存储键名
 */
export async function supabaseDel(key) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return;

    _pendingWrites.set(key, { value: '_AUTHOR_DELETE_' });

    if (!_isSyncing && !_syncTimer) {
        ensureSyncTimer();
    }
    resetIdleTimer();
}

// ==================== 批量同步 ====================

/**
 * 将队列中的数据批量写入 Supabase
 */
export async function flushSync() {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return;

    // 登录后第一次同步 — 强制执行真实同步（即使队列为空）
    if (_firstSyncAfterLogin) {
        _firstSyncAfterLogin = false;
        if (_pendingWrites.size === 0) {
            notifySyncStatus({ syncing: true, pending: 0 });
            await new Promise(r => setTimeout(r, 800));
            notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
            return;
        }
    } else if (_pendingWrites.size === 0) {
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
        return;
    }
    if (_isSyncing) return;

    _isSyncing = true;
    notifySyncStatus({ syncing: true, pending: _pendingWrites.size });

    const entries = Array.from(_pendingWrites.entries());
    _pendingWrites.clear();

    try {
        // 分离删除和写入操作
        const toDelete = entries.filter(([, { value }]) => value === '_AUTHOR_DELETE_').map(([key]) => key);
        const toUpsert = entries.filter(([, { value }]) => value !== '_AUTHOR_DELETE_');

        // 批量删除
        if (toDelete.length > 0) {
            const { error } = await supabase
                .from(TABLE_NAME)
                .delete()
                .eq('user_id', user.uid)
                .in('key', toDelete);
            if (error) throw error;
        }

        // 批量写入（upsert）
        if (toUpsert.length > 0) {
            const rows = toUpsert.map(([key, { value }]) => ({
                user_id: user.uid,
                key,
                value: value === undefined ? null : value,
                updated_at: new Date().toISOString(),
            }));

            // Supabase 单次 upsert 建议不超过 500 行
            const BATCH_LIMIT = 450;
            for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
                const chunk = rows.slice(i, i + BATCH_LIMIT);
                const { error } = await supabase
                    .from(TABLE_NAME)
                    .upsert(chunk, { onConflict: 'user_id,key' });
                if (error) throw error;
            }
        }

        console.log(`[supabase] synced ${entries.length} items`);
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
    } catch (err) {
        console.error('[supabase] batch sync failed:', err.message);
        // 失败写回队列等待重试
        for (const [key, data] of entries) {
            if (!_pendingWrites.has(key)) {
                _pendingWrites.set(key, data);
            }
        }
        notifySyncStatus({ syncing: false, pending: _pendingWrites.size, error: err.message });
    } finally {
        _isSyncing = false;
    }
}

/**
 * 首次登录时，从 Supabase 拉取全部数据并合并到本地
 */
export async function pullAllFromCloud(localGet, localSet) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return 0;

    try {
        const { data: rows, error } = await supabase
            .from(TABLE_NAME)
            .select('key, value, updated_at')
            .eq('user_id', user.uid);

        if (error) throw error;

        let merged = 0;
        for (const row of (rows || [])) {
            const key = row.key;
            const cloudValue = row.value;
            const localData = await localGet(key);

            const isLocalEmptyOrDefault = (key, data) => {
                if (data === undefined || data === null) return true;
                if (Array.isArray(data)) {
                    if (data.length === 0) return true;
                    if (key.startsWith('author-chapters')) {
                        const hasContent = data.some(item =>
                            item.type !== 'volume' &&
                            ((item.content && item.content.trim() !== '') || (item.wordCount > 0) || (item.title && item.title !== '未命名章节'))
                        );
                        return !hasContent;
                    }
                    if (key.startsWith('author-settings-nodes')) {
                        const hasItems = data.some(item => item.type === 'item');
                        const hasSpecialContent = data.some(node =>
                            node.type === 'special' &&
                            (node.content?.title || node.content?.synopsis)
                        );
                        return !hasItems && !hasSpecialContent;
                    }
                    if (key === 'author-works-index') {
                        if (data.length === 1 && data[0].id === 'work-default' && data[0].name === '默认作品') {
                            return true;
                        }
                    }
                    return false;
                }
                if (typeof data === 'object') {
                    if (Object.keys(data).length === 0) return true;
                }
                if (typeof data === 'string' && data.trim() === '') return true;
                return false;
            };

            if (isLocalEmptyOrDefault(key, localData)) {
                await localSet(key, cloudValue);
                merged++;
            } else if (Array.isArray(localData) && Array.isArray(cloudValue)) {
                let isIdBased = false;
                const localMap = new Map();
                for (const item of localData) {
                    if (item && item.id) {
                        isIdBased = true;
                        localMap.set(item.id, { ...item });
                    }
                }

                if (isIdBased) {
                    let hasDeltas = false;
                    for (const item of cloudValue) {
                        if (item && item.id) {
                            const localItem = localMap.get(item.id);
                            if (!localItem) {
                                localMap.set(item.id, { ...item });
                                hasDeltas = true;
                            } else {
                                const localTime = new Date(localItem.updatedAt || 0).getTime();
                                const cloudTime = new Date(item.updatedAt || 0).getTime();
                                if (cloudTime > localTime) {
                                    localMap.set(item.id, { ...item });
                                    hasDeltas = true;
                                }
                            }
                        }
                    }
                    if (hasDeltas) {
                        await localSet(key, Array.from(localMap.values()));
                        merged++;
                    }
                }
            }
        }

        console.log(`[supabase] pulled ${(rows || []).length} items, merged ${merged}`);
        return merged;
    } catch (err) {
        console.warn('[supabase] pull failed:', err.message);
        return 0;
    }
}

/**
 * 强制从云端拉取全部数据，无视本地状态直接覆盖
 */
export async function forcePullFromCloud(localSet) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return 0;

    notifySyncStatus({ syncing: true, pending: 0 });
    try {
        const { data: rows, error } = await supabase
            .from(TABLE_NAME)
            .select('key, value')
            .eq('user_id', user.uid);

        if (error) throw error;

        let pulledCount = 0;
        for (const row of (rows || [])) {
            const key = row.key;
            const value = row.value;

            if (key.startsWith('author-settings-nodes')) {
                const nodes = value;
                if (Array.isArray(nodes)) {
                    const brokenItems = nodes.filter(n => n.type === 'item' && !n.parentId);
                    if (brokenItems.length > 0) {
                        console.warn(`[supabase] ⚠️ 发现 ${brokenItems.length} 个缺失 parentId 的游离设定条目:`, brokenItems.map(n => n.name));
                    }
                }
            } else if (key.startsWith('author-chapters')) {
                if (!Array.isArray(value) || value.length === 0) {
                    console.warn(`[supabase] ⚠️ 拉取到空章节数据:`, key);
                }
            }

            if (value !== undefined && value !== null) {
                await localSet(key, value);
                pulledCount++;
            }
        }

        console.log(`[supabase] force pulled ${(rows || []).length} items, overwritten ${pulledCount} local items`);
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
        return pulledCount;
    } catch (err) {
        console.error('[supabase] force pull failed:', err.message);
        notifySyncStatus({ syncing: false, pending: 0, error: err.message });
        throw err;
    }
}

// ==================== 清理 ====================

/**
 * 停止同步定时器（退出登录时调用）
 */
export function stopSync() {
    clearSyncTimer();
    if (_idleTimer) {
        clearTimeout(_idleTimer);
        _idleTimer = null;
    }
    _pendingWrites.clear();
    _firstSyncAfterLogin = true;
    notifySyncStatus({ pending: 0, syncing: false });
}

/**
 * 页面卸载前，尝试同步剩余数据
 */
export function setupBeforeUnloadSync() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', () => {
        if (_pendingWrites.size > 0) {
            flushSync().catch(() => { });
        }
    });
}
