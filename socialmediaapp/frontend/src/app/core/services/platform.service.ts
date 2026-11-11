import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PlatformInfo } from '../models/platform.model';

/**
 * PlatformService — loads the list of enabled platforms from the backend.
 * The backend decides what is enabled (from env), so the UI is fully
 * config-driven: enable a platform in .env and it appears here automatically.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  readonly platforms = signal<PlatformInfo[]>([]);
  readonly loading = signal<boolean>(false);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ platforms: PlatformInfo[] }>(`${environment.apiBaseUrl}/platforms`)
      );
      this.platforms.set(res.platforms ?? []);
    } finally {
      this.loading.set(false);
    }
  }
}
