import jwt from 'jsonwebtoken';

/**
 * requireAdmin — Express middleware that protects admin routes.
 *
 * Expects an `Authorization: Bearer <token>` header carrying a JWT signed with
 * ADMIN_JWT_SECRET. Rejects with 401 if the token is missing, malformed, or
 * invalid/expired.
 */
export function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Admin auth is not configured (missing ADMIN_JWT_SECRET).' });
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.admin = { username: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}
