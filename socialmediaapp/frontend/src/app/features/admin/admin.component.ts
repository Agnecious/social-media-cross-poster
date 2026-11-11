import { Component, OnInit, inject, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';
import { PlatformService } from '../../core/services/platform.service';
import { AdminPlatformConfig, AdminPlatformUpdate } from '../../core/models/admin.model';

/**
 * Administrator — edit the per-platform configuration stored in `.env`
 * (enable/disable, credentials, redirect URI, scopes, API version).
 *
 * Secrets are shown masked; leaving the secret field blank keeps the existing
 * value. Saving writes `.env` on the backend and takes effect immediately.
 *
 * NOTE: this screen is unauthenticated for now. A login guard should protect
 * it before any non-local deployment.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, TitleCasePipe],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit {
  readonly adminSvc = inject(AdminService);
  private readonly platformSvc = inject(PlatformService);

  /** Working copy of each platform's editable fields, keyed by platform. */
  readonly form = signal<Record<string, EditableForm>>({});
  /** Which platform is currently shown in the editor. */
  readonly selectedKey = signal<string>('');
  readonly savingKey = signal<string | null>(null);
  readonly savedKey = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.adminSvc.load();
    this.resetForms();
    // Default to the first platform so the editor isn't empty.
    const first = this.adminSvc.platforms()[0];
    if (first) this.selectedKey.set(first.key);
  }

  /** The config object for the currently selected platform. */
  selectedConfig(): AdminPlatformConfig | undefined {
    return this.adminSvc.platforms().find((p) => p.key === this.selectedKey());
  }

  onSelectPlatform(key: string): void {
    this.selectedKey.set(key);
    this.savedKey.set(null);
    this.error.set(null);
  }

  /** Seed the working copies from the loaded config. */
  private resetForms(): void {
    const next: Record<string, EditableForm> = {};
    for (const p of this.adminSvc.platforms()) {
      next[p.key] = {
        enabled: p.enabled,
        clientId: p.clientId,
        clientSecret: '', // blank = keep existing
        redirectUri: p.redirectUri,
        scopes: p.scopes.join(', '),
        apiVersion: p.apiVersion,
      };
    }
    this.form.set(next);
  }

  formFor(key: string): EditableForm {
    return this.form()[key];
  }

  update(key: string, field: keyof EditableForm, value: string | boolean): void {
    const current = this.form();
    this.form.set({ ...current, [key]: { ...current[key], [field]: value } });
  }

  secretPlaceholder(p: AdminPlatformConfig): string {
    return p.hasClientSecret ? `${p.clientSecretMasked} (unchanged)` : 'not set';
  }

  async save(key: string): Promise<void> {
    this.error.set(null);
    this.savedKey.set(null);
    this.savingKey.set(key);
    try {
      const f = this.formFor(key);
      const update: AdminPlatformUpdate = {
        enabled: f.enabled,
        clientId: f.clientId,
        redirectUri: f.redirectUri,
        scopes: f.scopes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        apiVersion: f.apiVersion,
      };
      // Only send the secret if the user actually typed one.
      if (f.clientSecret.trim()) {
        update.clientSecret = f.clientSecret.trim();
      }

      await this.adminSvc.save(key, update);

      // Clear the typed secret and refresh the public platform list so the
      // Compose/Connections screens reflect enable/disable changes.
      this.update(key, 'clientSecret', '');
      await this.platformSvc.load();

      this.savedKey.set(key);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.savingKey.set(null);
    }
  }
}

/** The editable working copy for one platform. */
interface EditableForm {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  apiVersion: string;
}
