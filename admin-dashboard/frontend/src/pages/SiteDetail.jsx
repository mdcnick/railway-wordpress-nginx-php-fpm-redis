import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { api, setGetToken } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function SiteDetail() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const [site, setSite] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password form
  const [method, setMethod] = useState('direct');
  const [selectedUser, setSelectedUser] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const pollRef = useRef(null);

  useEffect(() => {
    setGetToken(() => getToken);
    loadSite();
    return () => clearInterval(pollRef.current);
  }, [id, getToken]);

  async function loadSite() {
    try {
      const data = await api.getSite(id);
      setSite(data);
      if (data.status === 'active') {
        try {
          const u = await api.getSiteUsers(id);
          setUsers(u);
          if (u.length > 0 && !selectedUser) setSelectedUser(u[0].user_login);
        } catch {}
      }
      if (data.status === 'provisioning') startPolling();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startPolling() {
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getSiteStatus(id);
        if (status.status !== 'provisioning') {
          clearInterval(pollRef.current);
          loadSite();
        }
      } catch {}
    }, 5000);
  }

  async function handlePasswordReset(e) {
    e.preventDefault();
    setResetting(true);
    setError('');
    setSuccess('');
    try {
      const data = { method, userLogin: selectedUser };
      if (method === 'direct') data.newPassword = newPassword;
      const result = await api.resetPassword(id, data);
      setSuccess(result.message);
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!site) return <div className="alert alert-error">Site not found</div>;

  return (
    <div>
      <Link to="/sites" className="back-link">Back to sites</Link>

      <div className="page-header">
        <h1>{site.name}</h1>
        <StatusBadge status={site.status} />
      </div>

      <div className="card-grid">
        <div className="card">
          <h3>Details</h3>
          <dl className="detail-list">
            <dt>Slug</dt><dd><code>{site.slug}</code></dd>
            <dt>Database</dt><dd><code>{site.db_name}</code></dd>
            <dt>Redis Prefix</dt><dd><code>{site.redis_prefix}</code></dd>
            <dt>Domain</dt>
            <dd>
              {site.railway_domain ? (
                <a href={`https://${site.railway_domain}`} target="_blank" rel="noopener">{site.railway_domain}</a>
              ) : 'Pending...'}
            </dd>
            <dt>Created</dt><dd>{new Date(site.created_at).toLocaleString()}</dd>
          </dl>
          {site.error_message && (
            <div className="alert alert-error">{site.error_message}</div>
          )}
        </div>

        {site.status === 'active' && (
          <div className="card">
            <h3>Password Reset</h3>
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            <form onSubmit={handlePasswordReset}>
              <div className="form-group">
                <label>WordPress User</label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="input"
                >
                  {users.length > 0 ? (
                    users.map((u) => (
                      <option key={u.ID} value={u.user_login}>
                        {u.user_login} ({u.user_email})
                      </option>
                    ))
                  ) : (
                    <option value="admin">admin</option>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label>Reset Method</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input type="radio" value="direct" checked={method === 'direct'} onChange={() => setMethod('direct')} />
                    Set new password directly
                  </label>
                  <label className="radio-label">
                    <input type="radio" value="email" checked={method === 'email'} onChange={() => setMethod('email')} />
                    Send reset email
                  </label>
                </div>
              </div>

              {method === 'direct' && (
                <div className="form-group">
                  <label>New Password</label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="input"
                  />
                </div>
              )}

              <button type="submit" disabled={resetting || (method === 'direct' && newPassword.length < 8)} className="btn btn-danger">
                {resetting ? 'Resetting...' : method === 'direct' ? 'Update Password' : 'Send Reset Email'}
              </button>
            </form>
          </div>
        )}

        {site.status === 'provisioning' && (
          <div className="card">
            <h3>Provisioning</h3>
            <p className="muted">Your site is being deployed. This usually takes 2-3 minutes.</p>
            <div className="spinner" />
          </div>
        )}

        {site.railway_domain && (
          <div className="card">
            <h3>Quick Links</h3>
            <div className="link-list">
              <a href={`https://${site.railway_domain}`} target="_blank" rel="noopener" className="btn btn-outline">
                View Site
              </a>
              <a href={`https://${site.railway_domain}/wp-admin`} target="_blank" rel="noopener" className="btn btn-outline">
                WP Admin
              </a>
              <a href={`https://${site.railway_domain}/wp-login.php`} target="_blank" rel="noopener" className="btn btn-outline">
                WP Login
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
