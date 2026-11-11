import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AnalyticsResult } from '../models/analytics.model';

/**
 * AnalyticsService — fetches per-account insights from the backend, which
 * resolves the account's token server-side and calls the platform's API.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /**
   * @param platform  e.g. 'facebook'
   * @param accountId  a connected account's id
   * @param days       7–90
   * @param targetId   optional Page / IG account id (for platforms needing one)
   */
  async fetch(
    platform: string,
    accountId: string,
    days: number,
    targetId?: string
  ): Promise<AnalyticsResult> {
    let params = new HttpParams().set('days', String(days));
    if (targetId) params = params.set('targetId', targetId);

    return firstValueFrom(
      this.http.get<AnalyticsResult>(
        `${environment.apiBaseUrl}/analytics/${platform}/${encodeURIComponent(accountId)}`,
        { params }
      )
    );
  }
}
