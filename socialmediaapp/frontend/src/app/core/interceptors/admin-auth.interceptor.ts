import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AdminAuthService } from '../services/admin-auth.service';

/**
 * Attaches the admin JWT as a Bearer token on requests to the protected
 * `/admin` endpoints. Other requests (OAuth, publish, public platform list)
 * are left untouched. The login request itself is not modified.
 *
 * If a protected admin call comes back 401 (e.g. the token expired), the
 * session is cleared so the UI falls back to the login screen.
 */
export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AdminAuthService);
  const token = auth.getToken();

  const isAdminApi = req.url.includes('/admin/') && !req.url.includes('/auth/admin/login');
  if (token && isAdminApi) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(req).pipe(
    catchError((err) => {
      if (isAdminApi && err?.status === 401) {
        auth.logout();
      }
      return throwError(() => err);
    })
  );
};
