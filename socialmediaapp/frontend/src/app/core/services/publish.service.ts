import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ComposedPost, PublishResult } from '../models/platform.model';

/** One publish destination: a specific connected account + its options. */
export interface PublishTarget {
  platform: string;
  accountId: string;
  /** Shown back in results so the user knows which account it was. */
  label: string;
  options?: Record<string, unknown>;
}

/**
 * PublishService — the single entry point the UI uses to publish (Facade).
 * It builds the multipart request and delegates the fan-out to the backend.
 *
 * With multi-account support, the caller passes explicit targets — each is a
 * specific connected account (by accountId). The backend resolves that
 * account's OAuth token server-side (scoped to the customer); the token is
 * never sent from the browser.
 */
@Injectable({ providedIn: 'root' })
export class PublishService {
  constructor(private readonly http: HttpClient) {}

  async publish(post: ComposedPost, targets: PublishTarget[]): Promise<PublishResult[]> {
    const form = new FormData();
    form.append('text', post.text ?? '');
    form.append('mediaType', post.mediaType);
    if (post.mediaUrl) form.append('mediaUrl', post.mediaUrl);
    if (post.file) form.append('file', post.file, post.file.name);
    if (post.scheduledAt) form.append('scheduledAt', post.scheduledAt);
    // The backend fans out over these targets, resolving each account's token
    // server-side by accountId (scoped to the customer).
    form.append(
      'targets',
      JSON.stringify(
        targets.map((t) => ({
          platform: t.platform,
          accountId: t.accountId,
          label: t.label,
          options: t.options ?? {},
        }))
      )
    );

    try {
      const res = await firstValueFrom(
        this.http.post<{ results: PublishResult[] }>(`${environment.apiBaseUrl}/publish`, form)
      );
      return res.results;
    } catch (e) {
      // Surface the backend's message (e.g. the 402 trial-expired text) and
      // tag gating errors so the UI can nudge the user to /billing.
      const any = e as { status?: number; error?: { error?: string; reason?: string } };
      const serverMsg = any?.error?.error;
      const reason = any?.error?.reason;
      const err = new Error(serverMsg || 'Could not publish. Please try again.') as Error & {
        reason?: string;
        status?: number;
      };
      err.reason = reason;
      err.status = any?.status;
      throw err;
    }
  }
}
