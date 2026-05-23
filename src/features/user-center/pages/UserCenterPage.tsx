import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../shared/ui';
import type { UserProfile, UserSessionInfo } from '../types';

interface UserCenterPageProps {
  user: UserProfile;
  token: string;
  onUserChange: (user: UserProfile) => void;
  onLogout: () => void;
}

function UserCenterPage({ user, token, onUserChange, onLogout }: UserCenterPageProps) {
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [company, setCompany] = useState(user.company || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  useEffect(() => {
    setDisplayName(user.display_name || '');
    setCompany(user.company || '');
    setPhone(user.phone || '');
  }, [user.company, user.display_name, user.phone]);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const avatarUrl = useMemo(() => {
    if (!user.avatar_url) return '';
    if (user.avatar_url.startsWith('http')) return user.avatar_url;
    return `${user.avatar_url}${user.avatar_url.includes('?') ? '&' : '?'}t=${encodeURIComponent(user.updated_at || '')}`;
  }, [user.avatar_url, user.updated_at]);
  const currentSessionCount = sessions.filter((item) => item.is_current).length;

  const formatTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const loadSessions = async (silent = false) => {
    try {
      setSessionLoading(true);
      const result = await window.bidmind?.user.listSessions(token);
      if (!result?.success) {
        if (!silent) {
          showToast(result?.message || '读取登录设备失败', 'error');
        }
        return;
      }
      setSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch (error) {
      if (!silent) {
        showToast(error instanceof Error ? error.message : '读取登录设备失败', 'error');
      }
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions(true);
  }, [token]);

  const saveProfile = async () => {
    try {
      setSaving(true);
      const result = await window.bidmind?.user.updateProfile({
        token,
        displayName: displayName.trim(),
        company: company.trim(),
        phone: phone.trim(),
      });
      if (!result?.success || !result.user) {
        showToast(result?.message || '保存用户信息失败', 'error');
        return;
      }
      onUserChange(result.user);
      showToast('用户信息已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存用户信息失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    try {
      const result = await window.bidmind?.user.uploadAvatar({ token, file });
      if (!result?.success || !result.user) {
        showToast(result?.message || '上传头像失败', 'error');
        return;
      }
      onUserChange(result.user);
      showToast('头像已更新', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '上传头像失败', 'error');
    }
  };

  const handleChooseAvatar = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void uploadAvatar(file);
    };
    input.click();
  };

  const handleLogout = async () => {
    try {
      await window.bidmind?.user.logout(token);
    } catch {
      // ignore
    }
    onLogout();
  };

  const handleChangePassword = async () => {
    if (!oldPassword.trim()) {
      showToast('请输入旧密码', 'error');
      return;
    }
    if (!newPassword.trim()) {
      showToast('请输入新密码', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('新密码至少 6 位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'error');
      return;
    }
    if (oldPassword === newPassword) {
      showToast('新密码不能和旧密码一致', 'error');
      return;
    }
    try {
      setChangingPassword(true);
      const result = await window.bidmind?.user.changePassword({ token, oldPassword, newPassword });
      if (!result?.success) {
        showToast(result?.message || '修改密码失败', 'error');
        return;
      }
      showToast(result.message || '密码已更新', 'success');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      void loadSessions(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '修改密码失败', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogoutAll = async () => {
    try {
      setLogoutAllLoading(true);
      const result = await window.bidmind?.user.logoutAll(token);
      if (!result?.success) {
        showToast(result?.message || '退出全部设备失败', 'error');
        return;
      }
      showToast(result.message || '已退出全部设备', 'success');
      onLogout();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '退出全部设备失败', 'error');
    } finally {
      setLogoutAllLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-panel compact-hero">
        <div className="hero-copy">
          <span className="section-kicker">用户中心</span>
          <h2>管理账号信息与头像</h2>
          <p>账号信息会用于多项目协作展示，建议完善昵称、联系方式和组织信息。</p>
        </div>
      </section>

      <section className="panel user-center-panel">
        <div className="user-avatar-box">
          {avatarUrl ? <img src={avatarUrl} alt="用户头像" /> : <span>{(user.display_name || user.email || 'U').slice(0, 1).toUpperCase()}</span>}
          <button type="button" className="secondary-action" onClick={handleChooseAvatar}>上传头像</button>
        </div>

        <div className="user-profile-form">
          <label>
            邮箱
            <input value={user.email} readOnly />
          </label>
          <label>
            昵称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="请输入昵称" />
          </label>
          <label>
            所属单位
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="请输入单位名称" />
          </label>
          <label>
            联系电话
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入联系电话" />
          </label>
        </div>

        <div className="user-profile-actions">
          <button type="button" className="primary-action" onClick={saveProfile} disabled={saving}>{saving ? '保存中...' : '保存信息'}</button>
          <button type="button" className="danger-action" onClick={handleLogout}>退出登录</button>
        </div>
      </section>

      <section className="panel user-security-panel">
        <header className="user-security-head">
          <div>
            <span className="section-kicker">账号安全</span>
            <h3>密码与登录设备管理</h3>
            <p>你可以修改密码，并管理当前账号在不同设备上的登录状态。</p>
          </div>
          <button type="button" className="secondary-action" onClick={() => void loadSessions()} disabled={sessionLoading}>
            {sessionLoading ? '刷新中...' : '刷新设备列表'}
          </button>
        </header>

        <div className="user-security-grid">
          <article className="user-security-card">
            <h4>修改登录密码</h4>
            <p>修改后会自动退出其他设备，仅保留当前会话。</p>
            <div className="user-password-form">
              <label>
                旧密码
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入当前密码"
                />
              </label>
              <label>
                新密码
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 6 位"
                />
              </label>
              <label>
                确认新密码
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="请再次输入新密码"
                />
              </label>
            </div>
            <div className="user-security-actions">
              <button type="button" className="primary-action" onClick={handleChangePassword} disabled={changingPassword}>
                {changingPassword ? '更新中...' : '更新密码'}
              </button>
            </div>
          </article>

          <article className="user-security-card">
            <h4>登录设备记录</h4>
            <p>当前账号共 {sessions.length} 个会话，当前设备 {currentSessionCount} 个。</p>
            {sessions.length ? (
              <ul className="user-session-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <div>
                      <strong>{session.device || '未知设备'}</strong>
                      {session.is_current ? <span>当前设备</span> : null}
                    </div>
                    <small>登录时间：{formatTime(session.created_at)}</small>
                    <small>最近活跃：{formatTime(session.last_active_at)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="user-session-empty">暂无登录设备记录</div>
            )}
            <div className="user-security-actions">
              <button type="button" className="danger-action" onClick={handleLogoutAll} disabled={logoutAllLoading}>
                {logoutAllLoading ? '处理中...' : '退出全部设备'}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

export default UserCenterPage;
