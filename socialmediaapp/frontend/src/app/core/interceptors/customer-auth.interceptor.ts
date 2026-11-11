import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CustomerAuthService } from '../services/customer-auth.service';

/**
 * Attaches the customer's Supabase access token to customer-scoped API calls:
 * /api/customer/*, /api/tokens*, /api/publish, and /api/platforms/:p/targets.
 * The admin interceptor handles /admin/* separately.
 */
export const customerAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CustomerAuthService);
  const token = auth.getAccessToken();

  // Customer-scoped endpoints that now require the Supabase token.
  const u = req.url;
  const isCustomerApi =
    u.includes('/api/customer/') ||
    u.includes('/api/tokens') ||
    u.includes('/api/publish') ||
    u.includes('/api/analytics/') ||
    u.includes('/api/ai/') ||
    /\/api\/platforms\/[^/]+\/targets/.test(u);

  if (token && isCustomerApi) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
