import { useState } from 'react';
import { useToast } from '../../../shared/ui';
import type { UserProfile } from '../types';

interface AuthPageProps {
  onAuthSuccess: (payload: { token: string; user: UserProfile }) => void;
}

function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      showToast('请输入邮箱', 'error');
      return;
    }
    if (!password.trim()) {
      showToast('请输入密码', 'error');
      return;
    }
    if (mode === 'register' && !displayName.trim()) {
      showToast('请输入昵称', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const result = mode === 'register'
        ? await window.bidmind?.user.register({ email: normalizedEmail, password, displayName: displayName.trim() })
        : await window.bidmind?.user.login({ email: normalizedEmail, password });
      if (!result?.success || !result.user || !result.token) {
        showToast(result?.message || (mode === 'register' ? '注册失败' : '登录失败'), 'error');
        return;
      }
      showToast(mode === 'register' ? '注册成功，已自动登录' : '登录成功', 'success');
      onAuthSuccess({ token: result.token, user: result.user });
    } catch (error) {
      showToast(error instanceof Error ? error.message : (mode === 'register' ? '注册失败' : '登录失败'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-card">
        <header>
          <span className="section-kicker">BidMind 账号</span>
          <h2>{mode === 'register' ? '创建账号' : '登录账号'}</h2>
          <p>登录后可使用用户中心、头像、项目历史与个性化配置。</p>
        </header>

        <div className="auth-mode-tabs" role="tablist" aria-label="登录注册切换">
          <button
            type="button"
            className={`auth-mode-tab ${mode === 'login' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`auth-mode-tab ${mode === 'register' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => setMode('register')}
          >
            注册
          </button>
        </div>

        <div className="auth-form">
          {mode === 'register' ? (
            <label>
              昵称
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="请输入昵称" />
            </label>
          ) : null}
          <label>
            邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
          </label>
          <button type="button" className="primary-action" disabled={submitting} onClick={submit}>
            {submitting ? '提交中...' : mode === 'register' ? '注册并登录' : '登录'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default AuthPage;
