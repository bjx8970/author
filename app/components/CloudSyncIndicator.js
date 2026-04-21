'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudOff, LogOut, RefreshCw, CheckCircle2, User, ArrowRightLeft } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';

/**
 * 顶栏云同步状态指示器
 * - 未登录：显示灰色云图标 + "登录同步"，点击打开偏好设置
 * - 已登录：显示用户头像 + 绿色圆点，点击弹出账户菜单
 */
export default function CloudSyncIndicator() {
    const { setShowLoginModal, setShowAccountModal, setShowSyncGuideModal } = useAppStore();
    const { t } = useI18n();
    const [authUser, setAuthUser] = useState(null);
    const [syncStatus, setSyncStatus] = useState(null);
    const [firebaseAvailable, setFirebaseAvailable] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const btnRef = useRef(null);

    useEffect(() => {
        let unmounted = false;
        (async () => {
            try {
                const { isSupabaseConfigured } = await import('../lib/supabase');
                if (!isSupabaseConfigured || unmounted) return;
                setFirebaseAvailable(true);
                const { onAuthChange, initAuth } = await import('../lib/auth');
                const { onSyncStatusChange } = await import('../lib/supabase-sync');
                initAuth();
                onAuthChange(user => { if (!unmounted) setAuthUser(user); });
                onSyncStatusChange(status => { if (!unmounted) setSyncStatus(status); });
            } catch { /* Supabase 未配置 */ }
        })();
        return () => { unmounted = true; };
    }, []);

    if (!firebaseAvailable) {
        const isElectron = typeof window !== 'undefined' && window.electron;

        if (isElectron) {
            // Electron 环境下 Firebase 必定可用，即使暂时加载未完成也应该走正常未登录的流程
            return (
                <button
                    id="tour-cloud-sync"
                    className="cloud-sync-indicator cloud-sync-login"
                    onClick={() => setShowLoginModal(true)}
                    title="登录以开启云同步"
                >
                    <CloudOff size={15} />
                    <span className="cloud-sync-label">{t('cloudSync.sync') || '同步'}</span>
                </button>
            );
        }

        // 非 Electron 环境（Web/Vercel）且未配置 Firebase
        return (
            <button
                id="tour-cloud-sync"
                className="cloud-sync-indicator cloud-sync-login"
                onClick={() => setShowSyncGuideModal(true)}
                title={t('settings.syncGuide') || '云同步指南'}
            >
                <CloudOff size={15} />
                <span className="cloud-sync-label">{t('cloudSync.sync') || '同步'}</span>
            </button>
        );
    }

    const handleSignOut = async () => {
        try {
            const { stopCloudSync } = await import('../lib/persistence');
            await stopCloudSync();
            const auth = await import('../lib/auth');
            await auth.signOut();
        } catch (err) {
            console.error('Sign out error:', err);
        }
        setMenuOpen(false);
    };

    // 同步状态文字
    const getSyncText = () => {
        if (!syncStatus) return null;
        if (syncStatus.syncing) return '同步中...';
        if (syncStatus.pending > 0) return `${syncStatus.pending} 项待同步`;
        if (syncStatus.lastSync) return `已同步 ${new Date(syncStatus.lastSync).toLocaleTimeString()}`;
        return null;
    };

    // 未登录状态
    if (!authUser) {
        return (
            <button
                id="tour-cloud-sync"
                className="cloud-sync-indicator cloud-sync-login"
                onClick={() => setShowLoginModal(true)}
                title="登录以开启云同步"
            >
                <CloudOff size={15} />
                <span className="cloud-sync-label">登录同步</span>
            </button>
        );
    }

    // 已登录状态
    const initial = (authUser.displayName || authUser.email || '?')[0].toUpperCase();

    return (
        <>
            <button
                id="tour-cloud-sync"
                ref={btnRef}
                className="cloud-sync-indicator cloud-sync-active"
                onClick={() => setMenuOpen(!menuOpen)}
                title={authUser.displayName || authUser.email}
            >
                {authUser.photoURL ? (
                    <img src={authUser.photoURL} alt="" className="cloud-sync-avatar" />
                ) : (
                    <span className="cloud-sync-avatar-letter">{initial}</span>
                )}
                <span className="cloud-sync-dot" />
                {getSyncText() && (
                    <span className="cloud-sync-status-text">{getSyncText()}</span>
                )}
            </button>

            {menuOpen && createPortal(
                <>
                    <div className="cloud-sync-menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <div
                        className="cloud-sync-menu"
                        style={{
                            top: btnRef.current ? btnRef.current.getBoundingClientRect().bottom + 8 : 48,
                            right: 16,
                        }}
                    >
                        <div className="cloud-sync-menu-header">
                            {authUser.photoURL ? (
                                <img src={authUser.photoURL} alt="" className="cloud-sync-menu-avatar" />
                            ) : (
                                <div className="cloud-sync-menu-avatar-letter">{initial}</div>
                            )}
                            <div className="cloud-sync-menu-info">
                                <div className="cloud-sync-menu-name">
                                    {authUser.displayName || authUser.email}
                                </div>
                                {authUser.displayName && (
                                    <div className="cloud-sync-menu-email">{authUser.email}</div>
                                )}
                            </div>
                        </div>

                        {syncStatus && (
                            <div className="cloud-sync-menu-status">
                                {syncStatus.syncing ? (
                                    <><RefreshCw size={12} className="spin" /> 正在同步...</>
                                ) : syncStatus.pending > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                                        <div>{syncStatus.pending} 项待同步</div>
                                        {syncStatus.keys && syncStatus.keys.length > 0 && (
                                            <div style={{
                                                maxHeight: 120, overflowY: 'auto',
                                                fontSize: 11, color: 'var(--text-muted)',
                                                background: 'var(--bg-primary)', padding: '6px 8px',
                                                borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4
                                            }}>
                                                {syncStatus.keys.map(k => (
                                                    <div key={k} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={k}>
                                                        • {k}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : syncStatus.lastSync ? (
                                    <><CheckCircle2 size={12} style={{ color: '#22c55e' }} /> 上次同步: {new Date(syncStatus.lastSync).toLocaleTimeString()}</>
                                ) : (
                                    <><Cloud size={12} style={{ color: 'var(--accent)' }} /> 云同步已开启</>
                                )}
                            </div>
                        )}

                        <div className="cloud-sync-menu-divider" />

                        <button
                            className="cloud-sync-menu-item"
                            onClick={() => { setShowAccountModal(true); setMenuOpen(false); }}
                        >
                            <User size={14} /> 账户设置
                        </button>
                        <button
                            className="cloud-sync-menu-item"
                            onClick={() => { setShowAccountModal(true, true); setMenuOpen(false); }}
                        >
                            <ArrowRightLeft size={14} /> 切换账号
                        </button>
                        <button
                            className="cloud-sync-menu-item cloud-sync-menu-logout"
                            onClick={handleSignOut}
                        >
                            <LogOut size={14} /> 退出登录
                        </button>
                    </div>
                </>,
                document.body
            )}
        </>
    );
}
