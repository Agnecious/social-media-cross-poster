import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminDashboardService } from '../../core/services/admin-dashboard.service';
import { PlansService } from '../../core/services/plans.service';
import { ToastService } from '../../core/services/toast.service';
import { AdminCustomer, AuditEntry, DashboardStats, SystemHealth } from '../../core/models/admin-dashboard.model';

/**
 * AdminDashboard — owner-only business view: customer metrics, website traffic
 * (built-in counter), and per-customer plan management. Admin-JWT protected.
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TitleCasePipe, FormsModule, RouterLink],
  templateUrl: './admin-dashboard.component.html',
})
export class AdminDashboardComponent implements OnInit {
  private readonly svc = inject(AdminDashboardService);
  private readonly plansSvc = inject(PlansService);
  private readonly toast = inject(ToastService);

  /**
   * The current, valid subscription tiers (from the backend catalogue). No Free
   * tier. Drives the plan-breakdown tiles and the per-customer plan selector.
   */
  readonly plans = signal<string[]>([]);

  readonly stats = signal<DashboardStats | null>(null);
  readonly customers = signal<AdminCustomer[]>([]);
  readonly audit = signal<AuditEntry[]>([]);
  readonly health = signal<SystemHealth | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly savingId = signal<string | null>(null);

  // --- Add-user form ---
  readonly showAddUser = signal(false);
  readonly addingUser = signal(false);
  readonly newUser = signal<{ email: string; password: string; firstName: string; lastName: string; phone: string; plan: string }>({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    plan: '',
  });

  /** Patch a single field of the add-user form. */
  setNewUser(key: 'email' | 'password' | 'firstName' | 'lastName' | 'phone' | 'plan', value: string): void {
    this.newUser.set({ ...this.newUser(), [key]: value });
  }

  toggleAddUser(): void {
    this.showAddUser.update((v) => !v);
  }

  // --- Audit log paging ---
  /** Selectable page sizes. 'all' shows everything loaded. */
  readonly auditPageSizes = [5, 10, 20, 30, 50] as const;
  /** Current page size (default 5). */
  readonly auditPageSize = signal<number>(5);
  /** Current page, 1-based. */
  readonly auditPage = signal<number>(1);

  /** Total pages for the current page size (min 1). */
  readonly auditTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.audit().length / this.auditPageSize()))
  );

  /** The slice of audit entries for the current page. */
  readonly auditPageRows = computed(() => {
    const size = this.auditPageSize();
    const start = (this.auditPage() - 1) * size;
    return this.audit().slice(start, start + size);
  });

  /** 1-based index of the first row shown on this page (0 when empty). */
  readonly auditRangeStart = computed(() =>
    this.audit().length === 0 ? 0 : (this.auditPage() - 1) * this.auditPageSize() + 1
  );

  /** 1-based index of the last row shown on this page. */
  readonly auditRangeEnd = computed(() =>
    Math.min(this.auditPage() * this.auditPageSize(), this.audit().length)
  );

  /** Change page size and reset to the first page. */
  setAuditPageSize(size: number): void {
    this.auditPageSize.set(size);
    this.auditPage.set(1);
  }

  /** Clamp-and-move to a given page. */
  goToAuditPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.auditTotalPages());
    this.auditPage.set(clamped);
  }

  // --- Customer table paging ---
  /** Selectable page sizes. */
  readonly customerPageSizes = [5, 10, 20, 30, 50] as const;
  /** Current page size (default 5). */
  readonly customerPageSize = signal<number>(5);
  /** Current page, 1-based. */
  readonly customerPage = signal<number>(1);

  /** Total pages for the current page size (min 1). */
  readonly customerTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.customers().length / this.customerPageSize()))
  );

  /** The slice of customers for the current page. */
  readonly customerPageRows = computed(() => {
    const size = this.customerPageSize();
    const start = (this.customerPage() - 1) * size;
    return this.customers().slice(start, start + size);
  });

  /** 1-based index of the first row shown (0 when empty). */
  readonly customerRangeStart = computed(() =>
    this.customers().length === 0 ? 0 : (this.customerPage() - 1) * this.customerPageSize() + 1
  );

  /** 1-based index of the last row shown. */
  readonly customerRangeEnd = computed(() =>
    Math.min(this.customerPage() * this.customerPageSize(), this.customers().length)
  );

  /** Change page size and reset to the first page. */
  setCustomerPageSize(size: number): void {
    this.customerPageSize.set(size);
    this.customerPage.set(1);
  }

  /** Clamp-and-move to a given page. */
  goToCustomerPage(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.customerTotalPages());
    this.customerPage.set(clamped);
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [stats, customers, catalogue, audit, health] = await Promise.all([
        this.svc.stats(),
        this.svc.customers(),
        this.plansSvc.catalogue(),
        this.svc.audit(100).catch(() => []), // audit is non-critical — don't fail the page
        this.svc.health().catch(() => null), // health is non-critical — don't fail the page
      ]);
      this.stats.set(stats);
      this.customers.set(customers);
      this.plans.set(catalogue.plans.map((p) => p.id));
      this.audit.set(audit);
      this.health.set(health);
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't load the dashboard", msg);
    } finally {
      this.loading.set(false);
    }
  }

  /** Format a ZAR amount as "R1,399" (no decimals, en-ZA grouping). */
  formatZar(amount: number): string {
    return 'R' + Math.round(amount || 0).toLocaleString('en-ZA');
  }

  /** Format an uptime in seconds as a compact "2d 3h 4m" string. */
  uptimePretty(s: number): string {
    if (!Number.isFinite(s) || s < 0) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }

  /** A short, human-readable summary of an audit entry's detail. */
  auditDetail(e: AuditEntry): string {
    const m = e.metadata;
    if (!m) return '';
    const parts: string[] = [];
    if (typeof m['from'] !== 'undefined' || typeof m['to'] !== 'undefined') {
      parts.push(`${m['from'] ?? '—'} → ${m['to'] ?? '—'}`);
    }
    if (Array.isArray(m['fields'])) parts.push((m['fields'] as unknown[]).join(', '));
    return parts.join(' · ');
  }

  /**
   * The target of the action, preferring the readable label over the raw id.
   * When the target is the same principal as the actor (e.g. a customer
   * changing their own plan), it's redundant — show "self" instead of
   * repeating the email.
   */
  auditTarget(e: AuditEntry): string {
    const target = e.targetLabel || e.targetId || '';
    if (target && (target === e.actorLabel || target === e.actorId)) return 'self';
    return target || e.targetType || '—';
  }

  /** The acting principal, shown with its human-readable label (email/username). */
  auditActor(e: AuditEntry): string {
    const label = e.actorLabel || e.actorId || '—';
    return `${e.actorType}: ${label}`;
  }

  planEntries(): { plan: string; count: number }[] {
    const b = this.stats()?.customers.planBreakdown ?? {};
    return this.plans().map((plan) => ({ plan, count: b[plan] ?? 0 }));
  }

  /**
   * Plan options for a customer's selector. The current, valid tiers (no Free),
   * plus the customer's own plan if it's a legacy value (e.g. an old "free"
   * row) so the dropdown still shows their real plan instead of blank.
   */
  planOptionsFor(c: AdminCustomer): string[] {
    const valid = this.plans();
    return valid.includes(c.plan) ? valid : [c.plan, ...valid];
  }

  async changePlan(c: AdminCustomer, plan: string): Promise<void> {
    if (plan === c.plan) return;
    this.savingId.set(c.id);
    this.error.set(null);
    try {
      await this.svc.setPlan(c.id, plan);
      this.customers.set(
        this.customers().map((x) => (x.id === c.id ? { ...x, plan } : x))
      );
      this.toast.success('Plan updated', `${c.email || c.id} → ${plan}`);
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't update plan", msg);
    } finally {
      this.savingId.set(null);
    }
  }

  /** Whether the add-user form is complete enough to submit. */
  canAddUser(): boolean {
    const u = this.newUser();
    return /.+@.+\..+/.test(u.email.trim()) && u.password.length >= 6;
  }

  /** Create a new customer (login + record) and prepend it to the table. */
  async addUser(): Promise<void> {
    if (!this.canAddUser() || this.addingUser()) return;
    this.addingUser.set(true);
    this.error.set(null);
    const u = this.newUser();
    try {
      const created = await this.svc.addCustomer({
        email: u.email.trim().toLowerCase(),
        password: u.password,
        firstName: u.firstName.trim() || undefined,
        lastName: u.lastName.trim() || undefined,
        phone: u.phone.trim() || undefined,
        plan: u.plan || undefined,
      });
      this.customers.set([created, ...this.customers()]);
      this.newUser.set({ email: '', password: '', firstName: '', lastName: '', phone: '', plan: '' });
      this.showAddUser.set(false);
      this.toast.success('Customer created', `${created.email} can now sign in.`);
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't create customer", msg);
    } finally {
      this.addingUser.set(false);
    }
  }

  /** Delete a customer (login + record) after confirmation. */
  async deleteUser(c: AdminCustomer): Promise<void> {
    if (this.savingId()) return;
    if (!confirm(`Delete ${c.email}? This removes their login, connected accounts, and history. This cannot be undone.`)) {
      return;
    }
    this.savingId.set(c.id);
    this.error.set(null);
    try {
      const res = await this.svc.deleteCustomer(c.id);
      this.customers.set(this.customers().filter((x) => x.id !== c.id));
      if (res.authDeleted) {
        this.toast.success('Customer deleted', `${c.email} removed.`);
      } else {
        this.toast.info('Customer removed locally', 'Their login could not be deleted (Supabase unreachable) — clean it up later.');
      }
    } catch (e) {
      const msg = extractError(e);
      this.error.set(msg);
      this.toast.error("Couldn't delete customer", msg);
    } finally {
      this.savingId.set(null);
    }
  }
}

function extractError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const any = e as { error?: { error?: string } | string; message?: string };
    if (any.error && typeof any.error === 'object' && typeof any.error.error === 'string') {
      return any.error.error;
    }
    if (typeof any.message === 'string') return any.message;
  }
  return 'Could not load the dashboard.';
}
