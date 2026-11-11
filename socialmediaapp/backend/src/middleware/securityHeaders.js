/**
 * securityHeaders — a small, dependency-free set of HTTP security headers
 * (the essentials helmet would set). Applied to every response.
 *
 * This backend is a JSON API (no server-rendered HTML), so the CSP is a strict
 * default-deny with no script/style sources — appropriate for API responses.
 * The Angular app is served separately (nginx in Docker) and should set its own
 * CSP for the HTML it serves.
 *
 * HSTS is only sent when the request arrived over HTTPS (directly or via a
 * trusted proxy), so local HTTP development is unaffected.
 */
export function securityHeaders(req, res, next) {
  // Don't advertise the framework.
  res.removeHeader('X-Powered-By');

  // Block MIME-type sniffing.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Disallow framing (clickjacking protection).
  res.setHeader('X-Frame-Options', 'DENY');
  // Minimal referrer leakage.
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Lock down powerful browser features for anything served from here.
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  // Strict API CSP: deny by default, no framing.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  // HSTS only over HTTPS (honour a trusting proxy's X-Forwarded-Proto).
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
