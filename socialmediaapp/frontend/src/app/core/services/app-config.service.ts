import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

interface AppConfig {
  theme?: 'light' | 'dark';
  supportEmail?: string;
  mailEnabled?: boolean;
}

/**
 * AppConfigService — fetches the public app config (GET /api/app-config) once
 * and caches it. Exposes the configurable support email used by the in-app
 * "Contact support" action. Falls back to the business Gmail if the backend
 * is unreachable so the feature never breaks.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);
  private loaded = false;

  /** The support inbox address; defaults until /app-config resolves. */
  readonly supportEmail = signal<string>('mathema.business@gmail.com');

  /** Whether the backend can send support emails itself (SMTP configured). */
  readonly mailEnabled = signal<boolean>(false);

  /** Fetch the config once (no-op on subsequent calls). */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const cfg = await firstValueFrom(
        this.http.get<AppConfig>(`${environment.apiBaseUrl}/app-config`).pipe(timeout(4000))
      );
      if (cfg?.supportEmail) this.supportEmail.set(cfg.supportEmail);
      this.mailEnabled.set(!!cfg?.mailEnabled);
    } catch {
      // Keep the default — the feature still works.
    }
  }
}
