import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * UsageService — the built-in website traffic counter. Sends lightweight,
 * fire-and-forget events to the backend (which stores them in usage_events).
 * Failures never affect the UI.
 */
@Injectable({ providedIn: 'root' })
export class UsageService {
  private readonly http = inject(HttpClient);

  /** Record an event. `type` = pageview | login | signup | publish | schedule. */
  record(type: string, path?: string): void {
    this.http
      .post(`${environment.apiBaseUrl}/usage`, { type, path })
      .subscribe({ error: () => {} });
  }
}
