import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminPlatformConfig, AdminPlatformUpdate } from '../models/admin.model';

/**
 * AdminService — talks to the backend Admin API to read and update the
 * per-platform configuration stored in `.env`.
 *
 * Secrets are never received in full; the backend returns a masked value.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  readonly platforms = signal<AdminPlatformConfig[]>([]);
  readonly envFileExists = signal<boolean>(true);
  readonly loading = signal<boolean>(false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ platforms: AdminPlatformConfig[]; envFileExists: boolean }>(
          `${environment.apiBaseUrl}/admin/config`
        )
      );
      this.platforms.set(res.platforms ?? []);
      this.envFileExists.set(res.envFileExists);
    } finally {
      this.loading.set(false);
    }
  }

  /** Save one platform's changes; returns the fresh (masked) config. */
  async save(platform: string, update: AdminPlatformUpdate): Promise<AdminPlatformConfig> {
    const updated = await firstValueFrom(
      this.http.put<AdminPlatformConfig>(
        `${environment.apiBaseUrl}/admin/config/${platform}`,
        update
      )
    );
    // Replace the entry in our local state.
    this.platforms.set(
      this.platforms().map((p) => (p.key === platform ? updated : p))
    );
    return updated;
  }
}
