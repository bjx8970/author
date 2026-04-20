'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Mail, Lock, XCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';
import { useAuthAction } from '../lib/useAuthAction';

/**
 * 独立登录弹窗（仅登录，注册入口跳转 RegisterModal）
 * 支持邮箱密码登录
 */
export default function LoginModal() {
    const { showLoginModal, setShowLoginModal, setShowRegisterModal } = useAppStore();
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const { t } = useI18n();

    const closeModal = useCallback(() => setShowLoginModal(false), [setShowLoginModal]);
    const { loading, error, run } = useAuthAction(closeModal, t('loginModal.loginFailed'));

    useEffect(() => {
        if (showLoginModal) {
            setAuthEmail('');
            setAuthPassword('');
        }
    }, [showLoginModal]);

    if (!showLoginModal) return null;

    const handleEmailLogin = () => run(async () => {
        const auth = await import('../lib/auth');
        await auth.signInWithEmail(authEmail, authPassword);
    });

    const switchToRegister = () => {
        setShowLoginModal(false);
        setTimeout(() => setShowRegisterModal(true), 150);
    };

    return (
        <div className="login-modal-overlay" onClick={() => setShowLoginModal(false)}>
            <div className="login-modal" onClick={e => e.stopPropagation()}>
                <button className="login-modal-close" onClick={() => setShowLoginModal(false)}>
                    <X size={18} />
                </button>

                {/* 头部 - Author Logo */}
                <div className="login-modal-header">
                    <div className="login-modal-icon">
                        <img src="/author-logo.png" alt="Author" className="login-modal-logo-img" />
                    </div>
                    <h2 className="login-modal-title">{t('loginModal.title')}</h2>
                    <p className="login-modal-desc">{t('loginModal.desc')}</p>
                </div>

                {/* 邮箱密码表单 */}
                <div className="login-modal-form">
                    <div className="login-modal-input-wrap">
                        <Mail size={15} className="login-modal-input-icon" />
                        <input
                            type="email"
                            value={authEmail}
                            onChange={e => setAuthEmail(e.target.value)}
                            placeholder={t('loginModal.emailPlaceholder')}
                            autoComplete="email"
                            className="login-modal-input"
                        />
                    </div>
                    <div className="login-modal-input-wrap">
                        <Lock size={15} className="login-modal-input-icon" />
                        <input
                            type="password"
                            value={authPassword}
                            onChange={e => setAuthPassword(e.target.value)}
                            placeholder={t('loginModal.passwordPlaceholder')}
                            autoComplete="current-password"
                            onKeyDown={e => { if (e.key === 'Enter' && authEmail && authPassword) handleEmailLogin(); }}
                            className="login-modal-input"
                        />
                    </div>
                </div>

                {error && (
                    <div className="login-modal-error">
                        <XCircle size={13} /> {error}
                    </div>
                )}

                <button
                    className="login-modal-submit-btn"
                    onClick={handleEmailLogin}
                    disabled={loading || !authEmail || !authPassword}
                >
                    {loading ? t('loginModal.loggingIn') : t('loginModal.loginBtn')}
                </button>

                <div className="login-modal-switch">
                    {t('loginModal.noAccount')}<button onClick={switchToRegister}>{t('loginModal.registerNow')}</button>
                </div>
            </div>
        </div>
    );
}
