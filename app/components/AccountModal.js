'use client';

import { useState, useEffect, useRef } from 'react';
import {
    X, Cloud, LogOut, Shield, Mail, User as UserIcon, RefreshCw,
    CheckCircle2, Clock, HardDrive, Edit3, Save, ArrowRightLeft,
    Plus, Trash2, Camera
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

/**
 * 账户管理弹窗
 * 显示用户信息、编辑个人资料、同步状态、切换账号、退出登录
 */
export default function AccountModal() {
    const { showAccountModal, accountModalSwitcher, setShowAccountModal, setShowLoginModal } = useAppStore();
    const [authUser, setAuthUser] = useState(null);
    const [syncStatus, setSyncStatus] = useState(null);
    const [signingOut, setSigningOut] = useState(false);

    // 编辑状态
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');

    // 切换账号面板
    const [showSwitcher, setShowSwitcher] = useState(false);
    const [accountHistory, setAccountHistory] = useState([]);
    const avatarInputRef = useRef(null);

    useEffect(() => {
        if (!showAccountModal) return;
        let unmounted = false;
        (async () => {
            try {
                const { isSupabaseConfigured } = await import('../lib/supabase');
                if (!isSupabaseConfigured || unmounted) return;
                const { onAuthChange, getAccountHistory } = await import('../lib/auth');
                const { onSyncStatusChange } = await import('../lib/supabase-sync');
                onAuthChange(user => {
                    if (!unmounted) {
                        setAuthUser(user);
                        if (user) setEditName(user.displayName || '');
                    }
                });
                onSyncStatusChange(status => { if (!unmounted) setSyncStatus(status); });
                setAccountHistory(getAccountHistory());
            } catch { }
        })();
        return () => { unmounted = true; };
    }, [showAccountModal]);

    // 重置状态 & 初始化 switcher
    useEffect(() => {
        if (!showAccountModal) {
            setEditing(false);
            setSaveMsg('');
            setShowSwitcher(false);
        } else if (accountModalSwitcher) {
            setShowSwitcher(true);
        }
    }, [showAccountModal, accountModalSwitcher]);

    if (!showAccountModal || !authUser) return null;

    const handleSaveProfile = async () => {
        if (!editName.trim()) return;
        setSaving(true);
        setSaveMsg('');
        try {
            const { updateUserProfile } = await import('../lib/auth');
            await updateUserProfile({ displayName: editName.trim() });
            setSaveMsg('已保存');
            setEditing(false);
            setTimeout(() => setSaveMsg(''), 2000);
        } catch (err) {
            setSaveMsg('保存失败: ' + (err.message || '未知错误'));
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        // 压缩为 200x200 的 data URL
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const size = 200;
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                // 居中裁剪
                const min = Math.min(img.width, img.height);
                const sx = (img.width - min) / 2;
                const sy = (img.height - min) / 2;
                ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                try {
                    const { updateUserProfile } = await import('../lib/auth');
                    await updateUserProfile({ photoURL: dataUrl });
                    setSaveMsg('头像已更新');
                    setTimeout(() => setSaveMsg(''), 2000);
                } catch (err) {
                    setSaveMsg('上传失败');
                }
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // 重置以允许再次选择同一文件
    };

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            const { stopCloudSync } = await import('../lib/persistence');
            await stopCloudSync();
            const auth = await import('../lib/auth');
            await auth.signOut();
            setShowAccountModal(false);
        } catch (err) {
            console.error('Sign out error:', err);
        } finally {
            setSigningOut(false);
        }
    };

    const handleSwitchToAccount = async (account) => {
        // 先退出当前账号
        try {
            const { stopCloudSync } = await import('../lib/persistence');
            await stopCloudSync();
            const auth = await import('../lib/auth');
            await auth.signOut();
        } catch { }
        setShowAccountModal(false);
        // 延时打开登录弹窗（用户需要重新认证）
        setTimeout(() => setShowLoginModal(true), 300);
    };

    const handleAddNewAccount = () => {
        // 不退出当前账号，直接打开登录窗
        // 如果用户成功登录新账号，Firebase 会自动切换
        // 如果用户取消，原账号状态保持不变
        setShowAccountModal(false);
        setTimeout(() => setShowLoginModal(true), 300);
    };

    const handleRemoveFromHistory = async (uid) => {
        const { removeAccountFromHistory, getAccountHistory } = await import('../lib/auth');
        removeAccountFromHistory(uid);
        setAccountHistory(getAccountHistory());
    };

    const handleManualSync = async () => {
        try {
            const { flushSync } = await import('../lib/supabase-sync');
            await flushSync();
        } catch { }
    };

    const initial = (authUser.displayName || authUser.email || '?')[0].toUpperCase();
    const createdAt = authUser.metadata?.creationTime
        ? new Date(authUser.metadata.creationTime).toLocaleDateString()
        : null;
    const lastSignIn = authUser.metadata?.lastSignInTime
        ? new Date(authUser.metadata.lastSignInTime).toLocaleDateString()
        : null;
    const providerName = authUser.providerData?.[0]?.providerId === 'google.com' ? 'Google' : '邮箱密码';

    // 其他历史账号（排除当前）
    const otherAccounts = accountHistory.filter(a => a.uid !== authUser.uid);

    // 同步状态指示
    const syncInfo = (() => {
        if (!syncStatus) return { icon: <Cloud size={16} />, text: '云同步已开启', color: 'var(--accent)' };
        if (syncStatus.syncing) return { icon: <RefreshCw size={16} className="spin" />, text: '正在同步...', color: 'var(--accent)' };
        if (syncStatus.pending > 0) return { icon: <Clock size={16} />, text: `${syncStatus.pending} 项待同步`, color: '#f59e0b' };
        if (syncStatus.idle) return { icon: <Cloud size={16} />, text: '自动同步已暂停', color: '#94a3b8' };
        if (syncStatus.lastSync) return { icon: <CheckCircle2 size={16} />, text: `已同步 · ${new Date(syncStatus.lastSync).toLocaleTimeString()}`, color: '#22c55e' };
        return { icon: <Cloud size={16} />, text: '云同步已开启', color: 'var(--accent)' };
    })();

    return (
        <div className="login-modal-overlay" onClick={() => setShowAccountModal(false)}>
            <div className="account-modal" onClick={e => e.stopPropagation()}>
                {/* 关闭按钮 */}
                <button className="login-modal-close" onClick={() => setShowAccountModal(false)}>
                    <X size={18} />
                </button>

                {/* === 切换账号面板 === */}
                {showSwitcher ? (
                    <div style={{ padding: '4px 0' }}>
                        <h3 style={{ fontSize: 17, fontWeight: 700, textAlign: 'center', marginBottom: 16, color: 'var(--text-primary)' }}>切换账号</h3>

                        {/* 当前账号 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--accent-light)' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff', fontWeight: 700, fontSize: 16 }}>
                                {authUser.photoURL ? (
                                    <img src={authUser.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <span>{initial}</span>
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{authUser.displayName || '用户'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{authUser.email}</div>
                            </div>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontWeight: 600, flexShrink: 0 }}>当前</span>
                        </div>

                        {/* 历史账号 */}
                        {otherAccounts.map(acc => (
                            <div key={acc.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s' }} className="account-switcher-item" onClick={() => handleSwitchToAccount(acc)}>
                                <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff', fontWeight: 700, fontSize: 16 }}>
                                    {acc.photoURL ? (
                                        <img src={acc.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span>{(acc.displayName || acc.email || '?')[0].toUpperCase()}</span>
                                    )}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{acc.displayName || '用户'}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{acc.email}</div>
                                </div>
                                <button
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', alignItems: 'center' }}
                                    onClick={(e) => { e.stopPropagation(); handleRemoveFromHistory(acc.uid); }}
                                    title="移除记录"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))}

                        {/* 添加新账号 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s' }} className="account-switcher-item" onClick={handleAddNewAccount}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '2px dashed var(--border-medium)' }}>
                                <Plus size={20} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>添加其他账号</div>
                            </div>
                        </div>

                        <button style={{ display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '14px 0 4px', fontFamily: 'var(--font-ui)' }} onClick={() => setShowSwitcher(false)}>
                            ← 返回账户详情
                        </button>
                    </div>
                ) : (
                    /* === 账户详情面板 === */
                    <>
                        {/* 用户头部 */}
                        <div className="account-modal-profile">
                            <div className="account-modal-avatar-wrap" onClick={() => avatarInputRef.current?.click()} style={{ cursor: 'pointer' }} title="点击更换头像">
                                {authUser.photoURL ? (
                                    <img src={authUser.photoURL} alt="" className="account-modal-avatar" />
                                ) : (
                                    <div className="account-modal-avatar-letter">{initial}</div>
                                )}
                                <div className="account-modal-avatar-overlay">
                                    <Camera size={18} />
                                </div>
                                <span className="account-modal-status-dot" style={{ background: syncInfo.color }} />
                            </div>
                            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />

                            {/* 昵称 — 可编辑 */}
                            {editing ? (
                                <div className="account-modal-edit-name">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        placeholder="输入昵称"
                                        className="account-modal-name-input"
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveProfile(); if (e.key === 'Escape') setEditing(false); }}
                                    />
                                    <button
                                        className="account-modal-save-btn"
                                        onClick={handleSaveProfile}
                                        disabled={saving || !editName.trim()}
                                    >
                                        <Save size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="account-modal-name-row">
                                    <h2 className="account-modal-name">{authUser.displayName || '用户'}</h2>
                                    <button className="account-modal-edit-btn" onClick={() => setEditing(true)} title="编辑昵称">
                                        <Edit3 size={13} />
                                    </button>
                                </div>
                            )}
                            {saveMsg && <p className="account-modal-save-msg">{saveMsg}</p>}
                            <p className="account-modal-email">{authUser.email}</p>
                        </div>

                        {/* 同步状态卡片 */}
                        <div className="account-modal-sync-card" onClick={handleManualSync} title="点击立即同步">
                            <div className="account-modal-sync-icon" style={{ color: syncInfo.color }}>
                                {syncInfo.icon}
                            </div>
                            <div className="account-modal-sync-info">
                                <div className="account-modal-sync-label">云同步状态</div>
                                <div className="account-modal-sync-value" style={{ color: syncInfo.color }}>
                                    {syncInfo.text}
                                </div>
                            </div>
                        </div>

                        {/* 账户信息 */}
                        <div className="account-modal-details">
                            <div className="account-modal-detail-row">
                                <Mail size={14} />
                                <span className="account-modal-detail-label">邮箱</span>
                                <span className="account-modal-detail-value">{authUser.email}</span>
                            </div>
                            <div className="account-modal-detail-row">
                                <Shield size={14} />
                                <span className="account-modal-detail-label">登录方式</span>
                                <span className="account-modal-detail-value">{providerName}</span>
                            </div>
                            {createdAt && (
                                <div className="account-modal-detail-row">
                                    <UserIcon size={14} />
                                    <span className="account-modal-detail-label">注册时间</span>
                                    <span className="account-modal-detail-value">{createdAt}</span>
                                </div>
                            )}
                            {lastSignIn && (
                                <div className="account-modal-detail-row">
                                    <Clock size={14} />
                                    <span className="account-modal-detail-label">上次登录</span>
                                    <span className="account-modal-detail-value">{lastSignIn}</span>
                                </div>
                            )}
                            <div className="account-modal-detail-row">
                                <HardDrive size={14} />
                                <span className="account-modal-detail-label">数据存储</span>
                                <span className="account-modal-detail-value">本地 + 云端</span>
                            </div>
                        </div>

                        {/* 操作按钮组 */}
                        <div className="account-modal-actions">
                            <button
                                className="account-modal-action-btn account-modal-switch-btn"
                                onClick={() => setShowSwitcher(true)}
                            >
                                <ArrowRightLeft size={15} />
                                切换账号
                            </button>
                            <button
                                className="account-modal-action-btn account-modal-logout-btn"
                                onClick={handleSignOut}
                                disabled={signingOut}
                            >
                                <LogOut size={15} />
                                {signingOut ? '退出中...' : '退出登录'}
                            </button>
                        </div>

                        <p className="account-modal-footer">
                            退出后数据仅保存在本地，不再同步到云端
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
