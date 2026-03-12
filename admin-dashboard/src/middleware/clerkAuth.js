import { verifyToken } from '@clerk/backend';
import config from '../config.js';

export async function clerkAuth(c, next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: config.CLERK_SECRET_KEY,
    });
    c.set('auth', payload);
    await next();
  } catch (err) {
    console.error('Token verification failed:', err.message || err);
    return c.json({ error: 'Invalid session' }, 401);
  }
}
