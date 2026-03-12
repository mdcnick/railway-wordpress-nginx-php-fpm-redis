import { createClerkClient } from '@clerk/backend';
import config from '../config.js';

const clerk = createClerkClient({ secretKey: config.CLERK_SECRET_KEY });

export async function clerkAuth(c, next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await clerk.verifyToken(token);
    c.set('auth', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid session' }, 401);
  }
}
