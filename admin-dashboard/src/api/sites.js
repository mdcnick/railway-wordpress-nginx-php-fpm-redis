import { Hono } from 'hono';
import { createSite, listSites, getSite, updateSite, deleteSite, purgeDeletedSites } from '../services/siteRegistry.js';
import { createDatabase } from '../services/database.js';
import { createService, deployService, getServiceStatus, deleteService } from '../services/railway.js';
import { listWpUsers } from '../services/wordpress.js';

const app = new Hono();

let lastCreateTime = 0;

// Purge all soft-deleted sites
app.delete('/purge', async (c) => {
  const count = await purgeDeletedSites();
  return c.json({ purged: count });
});

// List all sites (auto-checks provisioning statuses)
app.get('/', async (c) => {
  const sites = await listSites();
  // Check Railway status for any provisioning sites
  for (const site of sites) {
    if (site.status === 'provisioning' && site.railway_service_id) {
      try {
        const railwayStatus = await getServiceStatus(site.railway_service_id);
        console.log(`[status-poller] site ${site.id} railway status: "${railwayStatus}"`);
        if (railwayStatus === 'SUCCESS') {
          await updateSite(site.id, { status: 'active' });
          site.status = 'active';
        } else if (railwayStatus === 'FAILED' || railwayStatus === 'CRASHED') {
          await updateSite(site.id, { status: 'error', error_message: `Deployment ${railwayStatus}` });
          site.status = 'error';
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    }
  }
  return c.json(sites);
});

// Get single site (auto-checks provisioning status)
app.get('/:id', async (c) => {
  const site = await getSite(c.req.param('id'));
  if (!site) return c.json({ error: 'Not found' }, 404);
  if (site.status === 'provisioning' && site.railway_service_id) {
    try {
      const railwayStatus = await getServiceStatus(site.railway_service_id);
      console.log(`[status-poller] site ${site.id} railway status: "${railwayStatus}"`);
      if (railwayStatus === 'SUCCESS') {
        await updateSite(site.id, { status: 'active' });
        site.status = 'active';
      } else if (railwayStatus === 'FAILED' || railwayStatus === 'CRASHED') {
        await updateSite(site.id, { status: 'error', error_message: `Deployment ${railwayStatus}` });
        site.status = 'error';
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }
  return c.json(site);
});

// Get WP users for a site
app.get('/:id/users', async (c) => {
  const site = await getSite(c.req.param('id'));
  if (!site) return c.json({ error: 'Not found' }, 404);
  try {
    const users = await listWpUsers(site.db_name);
    return c.json(users);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Check deployment status
app.get('/:id/status', async (c) => {
  const site = await getSite(c.req.param('id'));
  if (!site) return c.json({ error: 'Not found' }, 404);

  let deployStatus = site.status;
  if (site.railway_service_id && site.status === 'provisioning') {
    try {
      const railwayStatus = await getServiceStatus(site.railway_service_id);
      console.log(`[status-poller] site ${site.id} railway status: "${railwayStatus}"`);
      if (railwayStatus === 'SUCCESS') {
        await updateSite(site.id, { status: 'active' });
        deployStatus = 'active';
        console.log(`[status-poller] site ${site.id} transitioned to active (Railway: ${railwayStatus})`);
      } else if (railwayStatus === 'FAILED' || railwayStatus === 'CRASHED') {
        await updateSite(site.id, { status: 'error', error_message: `Deployment ${railwayStatus}` });
        deployStatus = 'error';
        console.log(`[status-poller] site ${site.id} error (Railway: ${railwayStatus})`);
      } else if (railwayStatus === 'no_deployments') {
        // Service exists but was never deployed — surface as an error so it's
        // not silently stuck in 'provisioning' indefinitely.
        await updateSite(site.id, { status: 'error', error_message: 'No deployments found — service may not have been triggered' });
        deployStatus = 'error';
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }

  return c.json({ id: site.id, status: deployStatus, domain: site.railway_domain });
});

// Delete site
app.delete('/:id', async (c) => {
  const site = await getSite(c.req.param('id'));
  if (!site) return c.json({ error: 'Not found' }, 404);
  if (site.status === 'deleted') return c.json({ error: 'Already deleted' }, 400);

  try {
    if (site.railway_service_id) {
      try {
        await deleteService(site.railway_service_id);
      } catch (err) {
        console.error('Railway service deletion error (continuing):', err);
      }
    }
    await deleteSite(site.id);
    return c.json({ success: true });
  } catch (err) {
    console.error('Site deletion error:', err);
    return c.json({ error: err.message || 'Failed to delete site' }, 500);
  }
});

// Create new site
app.post('/', async (c) => {
  const now = Date.now();
  if (now - lastCreateTime < 10000) {
    return c.json({ error: 'Please wait before creating another site' }, 429);
  }

  const { name } = await c.req.json();
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return c.json({ error: 'Site name is required (min 2 characters)' }, 400);
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 2 || slug.length > 32) {
    return c.json({ error: 'Name must produce a valid slug (2-32 chars)' }, 400);
  }

  const dbName = `wp_${slug.replace(/-/g, '_')}`;
  const redisPrefix = `${slug.replace(/-/g, '_')}:`;

  if (!/^[a-z0-9_]{3,64}$/.test(dbName)) {
    return c.json({ error: 'Generated database name is invalid' }, 400);
  }

  try {
    lastCreateTime = now;

    console.log(`[create-site] Creating database: ${dbName}`);
    await createDatabase(dbName);
    console.log(`[create-site] Registering site: ${slug}`);
    const siteId = await createSite({ name: name.trim(), slug, dbName, redisPrefix });
    console.log(`[create-site] Creating Railway service: wp-${slug}`);
    const service = await createService(`wp-${slug}`);
    console.log(`[create-site] Deploying service: ${service.id}`);
    const { domain } = await deployService(service.id, { dbName, redisPrefix, siteName: slug });

    await updateSite(siteId, {
      railway_service_id: service.id,
      railway_domain: domain,
    });

    return c.json({
      id: siteId,
      name: name.trim(),
      slug,
      domain,
      status: 'provisioning',
    }, 202);
  } catch (err) {
    console.error('Site creation error:', err);
    return c.json({ error: err.message || 'Failed to create site' }, 500);
  }
});

export default app;
