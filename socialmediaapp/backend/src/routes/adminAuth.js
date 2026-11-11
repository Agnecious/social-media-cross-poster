import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();

/**
 * POST /api/auth/admin/login
 * Body: { username, password }
 *
 * Verifies the credentials against ADMIN_USERNAME / ADMIN_PASSWORD_HASH (a
 * bcrypt hash) and, on success, returns a short-lived signed JWT. The token is
 * held in the browser's memory only — nothing is persisted server-side.
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.ADMIN_JWT_SECRET;
  const ttl = process.env.ADMIN_TOKEN_TTL || '8h';

  if (!expectedUser || !passwordHash || !secret) {
    return res.status(500).json({
      error:
        'Admin login is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET.',
    });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Compare username and password. bcrypt.compare is constant-time on the hash.
  const userOk = username === expectedUser;
  const passOk = await bcrypt.compare(password, passwordHash).catch(() => false);

  // Same generic message either way, so we don't reveal which part was wrong.
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign({ sub: username, role: 'admin' }, secret, { expiresIn: ttl });
  res.json({ token, username, expiresIn: ttl });
});

export default router;
