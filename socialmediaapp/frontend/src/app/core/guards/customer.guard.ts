import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CustomerAuthService } from '../services/customer-auth.service';

/**
 * customerGuard — protects app routes that require a signed-in customer.
 * Redirects to the login screen when not authenticated.
 */
export const customerGuard: CanActivateFn = () => {
  const auth = inject(CustomerAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};
