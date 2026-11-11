/**
 * Root application providers: router, and the HttpClient with the admin-auth
 * interceptor that attaches the admin JWT to protected /admin requests.
 */
import { ApplicationConfig, provideZoneChangeDetection, provideAppInitializer, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { adminAuthInterceptor } from './core/interceptors/admin-auth.interceptor';
import { customerAuthInterceptor } from './core/interceptors/customer-auth.interceptor';
import { ThemeService } from './core/services/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([adminAuthInterceptor, customerAuthInterceptor])),
    // Apply the backend-configured theme (APP_THEME). Fire-and-forget: we do
    // NOT return the promise, so the app renders immediately and the theme is
    // applied when /app-config responds. Blocking first paint on a network call
    // risks a blank screen if the backend is slow or unreachable.
    provideAppInitializer(() => {
      void inject(ThemeService).init();
    }),
  ],
};
