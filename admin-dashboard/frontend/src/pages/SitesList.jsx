import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { api, setGetToken } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function SitesList() {
  const { getToken, isLoaded } = useAuth();
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setGetToken(getToken);
    if (isLoaded) {
      loadSites();
    }
  }, [getToken, isLoaded]);

  async function loadSites() {
    try {
      const data = await api.listSites();
      setSites(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  return (
    <div>
      <div className="page-header">
        <h1>WordPress Sites</h1>
        <span className="badge badge-info">{sites.length} sites</span>
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
                <th>Domain</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td><Link to={`/sites/${site.id}`}>{site.name}</Link></td>
                  <td><code>{site.slug}</code></td>
                  <td><StatusBadge status={site.status} /></td>
                  <td>
                    {site.railway_domain ? (
                      <a href={`https://${site.railway_domain}`} target="_blank" rel="noopener">
                        {site.railway_domain}
                      </a>
                    ) : '—'}
                  </td>
                  <td>{new Date(site.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
