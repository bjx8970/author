'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, LogOut, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useI18n } from '../lib/useI18n';

/**
 * 退出前同步询问弹窗 (仅 Electron / 客户端有效)
 * 全局挂载，监听 onExitSyncRequest 事件
 */
export default function ExitSyncModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [mounted, setMounted] = useState(false);
    const { t } = useI18n();

    useEffect(() => {
        setMounted(true);
        if (typeof window === 'undefined' || !window.electronAPI) return;

        window.electronAPI.onExitSyncRequest(() => {
            // 当主进程拦截到窗口关闭时触发
            setIsOpen(true);
        });
    }, []);

    const handleExitDirectly = () => {
        if (!window.electronAPI) return;
        window.electronAPI.allowClose();
    };

    const handleSyncAndExit = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        
        try {
            const { flushSync } = await import('../lib/supabase-sync');
            await flushSync();
        } catch (err) {
            console.error('Exit sync failed:', err);
        } finally {
            // 同步完无论失败与否都直接关闭
            if (window.electronAPI) {
                window.electronAPI.allowClose();
            }
        }
    };

    const handleCancel = () => {
        // 取消退出，关闭弹窗并通知主进程取消本次关闭
        setIsOpen(false);
        setIsSyncing(false);
        if (window.electronAPI && window.electronAPI.cancelClose) {
            window.electronAPI.cancelClose();
        }
    };

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
            <div className="modal" style={{ maxWidth: 360, textAlign: 'center' }}>
                <div style={{ padding: '24px 16px 16px' }}>
                    <AlertCircle size={48} style={{ color: 'var(--accent)', margin: '0 auto 16px' }} />
                    <h2 style={{ marginBottom: 16, fontSize: 18 }}>{t('exitSyncModal.title')}</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                        {t('exitSyncModal.desc')}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <button 
                            className="btn btn-primary" 
                            style={{ width: '100%', justifyContent: 'center', height: 40 }}
                            onClick={handleSyncAndExit}
                            disabled={isSyncing}
                        >
                            {isSyncing ? (
                                <>{t('exitSyncModal.syncing')}</>
                            ) : (
                                <><CheckCircle2 size={16} /> {t('exitSyncModal.syncAndExit')}</>
                            )}
                        </button>
                        
                        <button 
                            className="btn btn-secondary" 
                            style={{ width: '100%', justifyContent: 'center', height: 40, background: 'transparent', border: 'none' }}
                            onClick={handleExitDirectly}
                            disabled={isSyncing}
                        >
                            <LogOut size={16} /> {t('exitSyncModal.exitDirectly')}
                        </button>

                        <button
                            className="btn btn-secondary"
                            style={{ width: '100%', justifyContent: 'center', height: 40, opacity: 0.8 }}
                            onClick={handleCancel}
                            disabled={isSyncing}
                        >
                            <ArrowLeft size={16} /> {t('exitSyncModal.cancel')}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
