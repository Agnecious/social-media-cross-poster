import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

type Theme = 'light' | 'dark';

/**
 * ThemeService — applies the single, app-wide UI theme the backend ships with.
 *
 * The theme is configured in the backend's .env (APP_THEME=light|dark) and
 * exposed via GET /api/app-config. There is no per-user toggle: the whole app
 * (including the landing page) renders in the configured theme. We set
 * `data-theme` on <html>, which the CSS variables in styles.css key off.
 *
 * Light is the default and is already applied by CSS, so if the config call
 * fails we simply stay light — nothing breaks.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly http = inject(HttpClient);

  /** Fetch the configured theme and apply it to the document root. */
  async init(): Promise<void> {
    try {
      const cfg = await firstValueFrom(
        this.http
          .get<{ theme: Theme }>(`${environment.apiBaseUrl}/app-config`)
          .pipe(timeout(4000))
      );
      this.apply(cfg?.theme === 'dark' ? 'dark' : 'light');
    } catch {
      // Backend unreachable — keep the default (light) theme.
      this.apply('light');
    }
  }

  private apply(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
