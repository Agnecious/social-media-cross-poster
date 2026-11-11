/**
 * Public app-config route. Exposes UI-level settings the frontend needs at
 * startup that come from backend env (so a static build stays configurable).
 * Currently just the app-wide theme (light/dark) from APP_THEME. No auth.
 */
import { Router } from 'express';
import { appTheme, supportEmail, mailConfig } from '../config/index.js';

const router = Router();

/** GET /api/app-config — public UI config (theme, etc.). */
router.get('/', (_req, res) => {
  res.json({
    theme: appTheme(),
    supportEmail: supportEmail(),
    // Whether the backend can send support emails itself (SMTP configured). The
    // frontend shows an in-app form when true, else falls back to mailto.
    mailEnabled: mailConfig().enabled,
  });
});

export default router;
