'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Mail, Lock, CheckCircle2, XCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/useI18n';
import { useAuthAction } from '../lib/useAuthAction';
import { legalDocUrl } from '../lib/constants';

/**
 * 独立注册弹窗
 * 支持邮箱密码注册
 */
export default function RegisterModal() {
    const { showRegisterModal, setShowRegisterModal, setShowLoginModal } = useAppStore();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const { t, language } = useI18n();

    const closeModal = useCallback(() => setShowRegisterModal(false), [setShowRegisterModal]);
    const { loading, error, run, resetError } = useAuthAction(closeModal, t('registerModal.registerFailed'));

    // 注册有额外的前置校验，需要手动管理 error
    const [localError, setLocalError] = useState('');
    const displayError = localError || error;

    useEffect(() => {
        if (showRegisterModal) {
            setEmail('');
            setPassword('');
            setConfirmPassword('');
            setLocalError('');
        }
    }, [showRegisterModal]);

    if (!showRegisterModal) return null;

    const handleEmailRegister = () => {
        // 前置校验（这部分是 Register 独有的，不属于通用 auth 流程）
        if (password !== confirmPassword) {
            setLocalError(t('registerModal.passwordMismatch'));
            return;
        }
        if (password.length < 6) {
            setLocalError(t('registerModal.passwordTooShort'));
            return;
        }
        setLocalError('');
        run(async () => {
            const auth = await import('../lib/auth');
            await auth.signUpWithEmail(email, password);
        });
    };

    const switchToLogin = () => {
        setShowRegisterModal(false);
        setTimeout(() => setShowLoginModal(true), 150);
    };

    // 密码强度指示
    const pwStrength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
    const pwColors = ['', '#ef4444', '#f59e0b', '#22c55e'];
    const pwLabels = ['', t('registerModal.pwStrengthWeak'), t('registerModal.pwStrengthMedium'), t('registerModal.pwStrengthStrong')];

    // 法律文档链接 — 通过集中化的工具函数生成
    const termsUrl = legalDocUrl('github', 'TERMS', language);
    const privacyUrl = legalDocUrl('github', 'PRIVACY', language);
    const termsUrlMirror = legalDocUrl('gitee', 'TERMS', language);
    const privacyUrlMirror = legalDocUrl('gitee', 'PRIVACY', language);

    return (
        <div className="login-modal-overlay" onClick={() => setShowRegisterModal(false)}>
            <div className="login-modal register-modal" onClick={e => e.stopPropagation()}>
                <button className="login-modal-close" onClick={() => setShowRegisterModal(false)}>
                    <X size={18} />
                </button>

                {/* 头部 */}
                <div className="login-modal-header">
                    <div className="login-modal-icon">
                        <img src="/author-logo.png" alt="Author" className="login-modal-logo-img" />
                    </div>
                    <h2 className="login-modal-title">{t('registerModal.title')}</h2>
                    <p className="login-modal-desc">{t('registerModal.desc')}</p>
                </div>

                {/* 邮箱注册表单 — 放在上面 */}
                <div className="login-modal-form">
                    <div className="login-modal-input-wrap">
                        <Mail size={15} className="login-modal-input-icon" />
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder={t('registerModal.emailPlaceholder')}
                            autoComplete="email"
                            className="login-modal-input"
                        />
                    </div>
                    <div className="login-modal-input-wrap">
                        <Lock size={15} className="login-modal-input-icon" />
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder={t('registerModal.passwordPlaceholder')}
                            autoComplete="new-password"
                            className="login-modal-input"
                        />
                    </div>
                    {/* 密码强度条 */}
                    {password.length > 0 && (
                        <div className="register-pw-strength">
                            <div className="register-pw-bar">
                                <div className="register-pw-fill" style={{ width: `${(pwStrength / 3) * 100}%`, background: pwColors[pwStrength] }} />
                            </div>
                            <span style={{ color: pwColors[pwStrength], fontSize: 11 }}>{pwLabels[pwStrength]}</span>
                        </div>
                    )}
                    <div className="login-modal-input-wrap">
                        <CheckCircle2 size={15} className="login-modal-input-icon" />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder={t('registerModal.confirmPasswordPlaceholder')}
                            autoComplete="new-password"
                            onKeyDown={e => { if (e.key === 'Enter' && email && password && confirmPassword) handleEmailRegister(); }}
                            className="login-modal-input"
                        />
                    </div>
                </div>

                {displayError && (
                    <div className="login-modal-error">
                        <XCircle size={13} /> {displayError}
                    </div>
                )}

                <button
                    className="login-modal-submit-btn"
                    onClick={handleEmailRegister}
                    disabled={loading || !email || !password || !confirmPassword}
                >
                    {loading ? t('registerModal.registering') : t('registerModal.registerBtn')}
                </button>

                <p className="login-modal-terms">
                    {t('registerModal.agreeTerms')}
                    <a href={termsUrl} target="_blank" rel="noopener noreferrer">{t('registerModal.termsOfService')}</a>
                    <span className="legal-mirror-link">(<a href={termsUrlMirror} target="_blank" rel="noopener noreferrer">{t('registerModal.mirrorLink')}</a>)</span>
                    {t('registerModal.and')}
                    <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{t('registerModal.privacyPolicy')}</a>
                    <span className="legal-mirror-link">(<a href={privacyUrlMirror} target="_blank" rel="noopener noreferrer">{t('registerModal.mirrorLink')}</a>)</span>
                </p>

                <div className="login-modal-switch">
                    {t('registerModal.hasAccount')}<button onClick={switchToLogin}>{t('registerModal.backToLogin')}</button>
                </div>
            </div>
        </div>
    );
}
