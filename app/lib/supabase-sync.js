'use client';

// ==================== Supabase 同步层 ====================
// 本地优先 + 云端智能同步
// 数据变化时启动同步，5分钟无变化后停止定时器，直到下次变化

import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrentUser } from './auth';

// ==================== 配置 ====================

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 分钟
const IDLE_TIMEOUT = 5 * 60 * 1000;  // 5 分钟无变化后停止自动同步
const TABLE_NAME = 'user_data';       // user_data(user_id, key, value, updated_at)

// ==================== 同步队列 ====================

const _pendingWrites = new Map();    // key → { value, timestamp }
const _pendingDeletes = new Set();   // 待删除的 key 集合
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
            keys: Array.from(_pendingWrites.keys()),
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
            // PGRST116 = 未找到行，属于正常情况
            if (error.code === 'PGRST116') return undefined;
            throw error;
        }
        return data?.value;
    } catch (err) {
        console.warn('[supabase-sync] GET failed:', key, err.message);
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

    // 启动定时同步（如果还没启动）
    ensureSyncTimer();

    // 重置空闲检测
    resetIdleTimer();
}

/**
 * 将数据加入删除队列
 * @param {string} key - 存储键名
 */
export function supabaseDel(key) {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return;

    // 写队列中若有该 key 先移除
    _pendingWrites.delete(key);
    _pendingDeletes.add(key);

    ensureSyncTimer();
    resetIdleTimer();
}

/**
 * 启动同步定时器（如果未运行）
 */
function ensureSyncTimer() {
    if (!_syncTimer) {
        _syncTimer = setInterval(flushSync, SYNC_INTERVAL);
        console.log('[supabase-sync] sync timer started');
    }
}

/**
 * 停止同步定时器
 */
function clearSyncTimer() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
        console.log('[supabase-sync] sync timer stopped (idle)');
    }
}

/**
 * 重置空闲检测定时器
 * 每次数据变化时调用；5 分钟无新变化则停止自动同步
 */
function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        // 5 分钟无变化，先做一次最终同步，然后停止定时器
        flushSync().then(() => {
            clearSyncTimer();
            notifySyncStatus({
                syncing: false,
                pending: 0,
                lastSync: Date.now(),
                idle: true,
            });
            console.log('[supabase-sync] auto-sync paused: no data changes for 5 minutes');
        });
    }, IDLE_TIMEOUT);
}

// ==================== 批量同步 ====================

/**
 * 将队列中的数据批量写入 Supabase
 * 由定时器自动调用，也可手动调用（如退出登录前）
 */
export async function flushSync() {
    const user = getCurrentUser();
    if (!isSupabaseConfigured || !supabase || !user) return;

    // 登录后第一次同步 — 强制执行真实同步（即使队列为空）
    if (_firstSyncAfterLogin) {
        _firstSyncAfterLogin = false;
        if (_pendingWrites.size === 0 && _pendingDeletes.size === 0) {
            notifySyncStatus({ syncing: true, pending: 0 });
            await new Promise(r => setTimeout(r, 800));
            notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
            return;
        }
    } else if (_pendingWrites.size === 0 && _pendingDeletes.size === 0) {
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
        return;
    }
    if (_isSyncing) return; // 防止并发

    _isSyncing = true;
    notifySyncStatus({ syncing: true, pending: _pendingWrites.size });

    // 取出当前队列快照
    const writeEntries = Array.from(_pendingWrites.entries());
    const deleteKeys = Array.from(_pendingDeletes);
    _pendingWrites.clear();
    _pendingDeletes.clear();

    try {
        // 批量写入（upsert）
        if (writeEntries.length > 0) {
            const deepClean = (obj) => {
                if (obj === undefined) return null;
                if (obj === null || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(deepClean);
                const cleanObj = {};
                for (const k in obj) {
                    const v = deepClean(obj[k]);
                    if (v !== undefined) cleanObj[k] = v;
                }
                return cleanObj;
            };

            const rows = writeEntries.map(([key, { value }]) => ({
                user_id: user.uid,
                key,
                value: deepClean(value),
                updated_at: new Date().toISOString(),
            }));

            const { error: upsertError } = await supabase
                .from(TABLE_NAME)
                .upsert(rows, { onConflict: 'user_id,key' });

            if (upsertError) throw upsertError;
        }

        // 批量删除
        if (deleteKeys.length > 0) {
            const { error: deleteError } = await supabase
                .from(TABLE_NAME)
                .delete()
                .eq('user_id', user.uid)
                .in('key', deleteKeys);

            if (deleteError) throw deleteError;
        }

        const total = writeEntries.length + deleteKeys.length;
        console.log(`[supabase-sync] synced ${total} items`);
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
    } catch (err) {
        console.error('[supabase-sync] batch sync failed:', err.message);
        // 失败的写回队列，等下次重试
        for (const [key, data] of writeEntries) {
            if (!_pendingWrites.has(key)) {
                _pendingWrites.set(key, data);
            }
        }
        for (const key of deleteKeys) {
            _pendingDeletes.add(key);
        }
        notifySyncStatus({ syncing: false, pending: _pendingWrites.size, error: err.message });
    } finally {
        _isSyncing = false;
    }
}

/**
 * 首次登录时，从 Supabase 拉取全部数据并合并到本地
 * @param {Function} localGet - 本地读取函数 (key) => value
 * @param {Function} localSet - 本地写入函数 (key, value) => void
 * @returns {Promise<number>} 合并的数据条数
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
        if (!rows || rows.length === 0) return 0;

        let merged = 0;
        for (const row of rows) {
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

        console.log(`[supabase-sync] pulled ${rows.length} items, merged ${merged}`);
        return merged;
    } catch (err) {
        console.warn('[supabase-sync] pull failed:', err.message);
        return 0;
    }
}

/**
 * 强制从云端拉取全部数据，无视本地状态直接覆盖
 * 用户手动点击"从云端同步"时调用
 * @param {Function} localSet - 本地写入函数 (key, value) => void或Promise
 * @returns {Promise<number>} 覆盖的数据条数
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
        for (const row of rows || []) {
            const key = row.key;
            const cloudValue = row.value;

            if (cloudValue !== undefined && cloudValue !== null) {
                // 数据完整性防御性日志
                if (key.startsWith('author-settings-nodes')) {
                    if (Array.isArray(cloudValue)) {
                        const brokenItems = cloudValue.filter(n => n.type === 'item' && !n.parentId);
                        if (brokenItems.length > 0) {
                            console.warn(`[supabase-sync] ⚠️ 发现 ${brokenItems.length} 个缺失 parentId 的游离设定条目:`, brokenItems.map(n => n.name));
                        }
                    } else if (cloudValue === null || typeof cloudValue !== 'object') {
                        console.warn(`[supabase-sync] ⚠️ 异常的设定数据结构:`, cloudValue);
                    }
                } else if (key.startsWith('author-chapters')) {
                    if (!Array.isArray(cloudValue) || cloudValue.length === 0) {
                        console.warn(`[supabase-sync] ⚠️ 拉取到空章节数据:`, key);
                    }
                }

                await localSet(key, cloudValue);
                pulledCount++;
            }
        }

        console.log(`[supabase-sync] force pulled ${rows?.length ?? 0} items, overwritten ${pulledCount} local items`);
        notifySyncStatus({ syncing: false, pending: 0, lastSync: Date.now() });
        return pulledCount;
    } catch (err) {
        console.error('[supabase-sync] force pull failed:', err.message);
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
    _pendingDeletes.clear();
    _firstSyncAfterLogin = true; // 下次登录后重新强制首次同步
    notifySyncStatus({ pending: 0, syncing: false });
}

/**
 * 页面卸载前，尝试同步剩余数据
 */
export function setupBeforeUnloadSync() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', () => {
        if (_pendingWrites.size > 0 || _pendingDeletes.size > 0) {
            flushSync().catch(() => { });
        }
    });
}

// ==================== 兼容旧名称（别名导出）====================
// 供仍使用旧名称的调用方过渡

/** @deprecated 请使用 supabaseGet */
export const firestoreGet = supabaseGet;
/** @deprecated 请使用 supabaseEnqueue */
export const firestoreEnqueue = supabaseEnqueue;
/** @deprecated 请使用 supabaseDel */
export const firestoreDel = supabaseDel;
