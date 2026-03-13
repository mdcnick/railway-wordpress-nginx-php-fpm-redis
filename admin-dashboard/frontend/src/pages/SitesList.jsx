import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { api, setGetToken } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'provisioning', label: 'Provisioning' },
  { key: 'error', label: 'Error' },
];

function statusDot(status) {
  const colors = { active: '#22c55e', provisioning: '#eab308', error: '#ef4444' };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: colors[status] || '#94a3b8',
        marginRight: 6,
      }}
    />
  );
}

export default function SitesList() {
  const { getToken, isLoaded } = useAuth();
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [purging, setPurging] = useState(false);
  const [filter, setFilter] = useState('all');
  const pollRef = useRef(null);

  useEffect(() => {
    setGetToken(getToken);
    if (isLoaded) {
      loadSites();
    }
    return () => clearInterval(pollRef.current);
  }, [getToken, isLoaded]);

  async function loadSites() {
    try {
      const data = await api.listSites();
      setSites(data);
      // Auto-poll if any site is still provisioning
      const hasProvisioning = data.some(s => s.status === 'provisioning');
      if (hasProvisioning && !pollRef.current) {
        pollRef.current = setInterval(async () => {
          try {
            const fresh = await api.listSites();
            setSites(fresh);
            if (!fresh.some(s => s.status === 'provisioning')) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch {}
        }, 5000);
      } else if (!hasProvisioning && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(site) {
    if (!confirm(`Delete "${site.name}"? This will remove the Railway service and mark the site as deleted.`)) return;
    setDeleting(site.id);
    setError('');
    setSuccess('');
    try {
      await api.deleteSite(site.id);
      setSuccess(`"${site.name}" has been deleted.`);
      await loadSites();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handlePurge() {
    if (!confirm('Purge all deleted sites from the database? This frees up their slugs for reuse.')) return;
    setPurging(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.purgeSites();
      setSuccess(`Purged ${result.purged} deleted site(s).`);
      await loadSites();
    } catch (err) {
      setError(err.message);
    } finally {
      setPurging(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.createSite(newName.trim());
      setSuccess(`"${result.name}" is being provisioned at ${result.domain}`);
      setNewName('');
      await loadSites();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const counts = {};
  for (const opt of FILTER_OPTIONS) {
    counts[opt.key] = opt.key === 'all' ? sites.length : sites.filter(s => s.status === opt.key).length;
  }

  const filteredSites = filter === 'all' ? sites : sites.filter(s => s.status === filter);

  return (
    <div>
      <div className="page-header">
        <h1>WordPress Sites</h1>
        <span className="badge badge-info">{sites.length} sites</span>
        <button className="btn btn-outline btn-sm" onClick={handlePurge} disabled={purging}>
          {purging ? 'Purging...' : 'Purge Deleted'}
        </button>
      </div>

      <div className="filter-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            className={`btn btn-sm ${filter === opt.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label} <span className="badge badge-info" style={{ marginLeft: 4 }}>{counts[opt.key]}</span>
          </button>
        ))}
      </div>

      <form className="create-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New site name (e.g. Acme Corp)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={creating}
          className="input"
        />
        <button type="submit" disabled={creating || !newName.trim()} className="btn btn-primary">
          {creating ? 'Creating...' : 'Create Site'}
        </button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <div className="loading">Loading sites...</div>
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <p>No WordPress sites yet.</p>
          <p className="muted">Create your first site above to get started.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Service ID</th>
                <th>Domain</th>
                <th>Custom Domain</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.map((site) => (
                <tr key={site.id}>
                  <td>
                    {statusDot(site.status)}
                    <Link to={`/sites/${site.id}`}>{site.name}</Link>
                  </td>
                  <td><code>{site.slug}</code></td>
                  <td><StatusBadge status={site.status} /></td>
                  <td><code>{site.railway_service_id ? site.railway_service_id.substring(0, 8) : '—'}</code></td>
                  <td>
                    {site.railway_domain ? (
                      <a href={`https://${site.railway_domain}`} target="_blank" rel="noopener">
                        {site.railway_domain}
                      </a>
                    ) : '—'}
                  </td>
                  <td>{site.custom_domain || '—'}</td>
                  <td>{new Date(site.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(site)}
                      disabled={deleting === site.id}
                    >
                      {deleting === site.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
