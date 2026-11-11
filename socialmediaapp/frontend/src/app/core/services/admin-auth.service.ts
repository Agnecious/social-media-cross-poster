import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * AdminAuthService — handles logging into the Administrator area.
 *
 * The JWT is held in memory only (a signal). It is never written to
 * localStorage/sessionStorage/cookies, so it disappears when the tab closes —
 * consistent with the app's stateless, store-nothing design.
 */
@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly http = inject(HttpClient);

  private readonly token = signal<string | null>(null);
  private readonly _username = signal<string | null>(null);

  readonly isAuthenticated = computed(() => this.token() !== null);
  readonly username = computed(() => this._username());

  getToken(): string | null {
    return this.token();
  }

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ token: string; username: string }>(
        `${environment.apiBaseUrl}/auth/admin/login`,
        { username, password }
      )
    );
    this.token.set(res.token);
    this._username.set(res.username);
  }

  logout(): void {
    this.token.set(null);
    this._username.set(null);
  }
}
