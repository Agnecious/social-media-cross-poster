import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PlatformService } from '../../core/services/platform.service';
import { AuthService } from '../../core/services/auth.service';
import { TargetService } from '../../core/services/target.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { PlansService } from '../../core/services/plans.service';
import { ToastService } from '../../core/services/toast.service';
import { AnalyticsResult, AnalyticsMetric, MetricCategory } from '../../core/models/analytics.model';
import { PlatformNamePipe } from '../../core/pipes/platform-name.pipe';

/** A category section of metrics, ready to render. */
interface MetricGroup {
  category: MetricCategory;
  title: string;
  icon: string;
  metrics: AnalyticsMetric[];
}

/** Display order + labels + icons for the metric categories. */
const CATEGORY_META: { key: MetricCategory; title: string; icon: string }[] = [
  { key: 'audience', title: 'Audience & followers', icon: '👥' },
  { key: 'reach', title: 'Reach & views', icon: '📈' },
  { key: 'engagement', title: 'Engagement', icon: '💬' },
  { key: 'monetization', title: 'Monetisation', icon: '💰' },
];

interface AnalyticsRow {
  platform: string;
  accountId: string;
  label: string;
  requiresTarget: boolean;
}

/**
 * Analytics — per-connected-account insights over a selectable window (7–90
 * days). Only platforms whose API supports analytics are shown. For platforms
 * that need a destination (Facebook/Instagram), a target is chosen first.
 */
@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [DecimalPipe, UpperCasePipe, FormsModule, RouterLink, PlatformNamePipe],
  templateUrl: './analytics.component.html',
})
export class AnalyticsComponent implements OnInit {
  readonly platformSvc = inject(PlatformService);
  readonly auth = inject(AuthService);
  readonly targets = inject(TargetService);
  private readonly analytics = inject(AnalyticsService);
  private readonly plansSvc = inject(PlansService);
  private readonly toast = inject(ToastService);

  readonly days = signal(7);
  readonly periods = [7, 14, 30, 90];

  /** The customer's plan — CSV export is an Agency-tier perk. */
  readonly plan = signal<string>('');
  readonly canExport = computed(() => this.plan().toLowerCase() === 'agency');

  /** Per-account result + loading/error state, keyed by 'platform::accountId'. */
  private readonly state = signal<Record<string, { loading: boolean; result?: AnalyticsResult; error?: string }>>({});

  async ngOnInit(): Promise<void> {
    try {
      this.plan.set((await this.plansSvc.subscription()).plan);
    } catch {
      // Non-critical — export just stays gated if we can't read the plan.
    }
  }

  /** True once at least one account has loaded metrics (something to export). */
  readonly hasAnyResults = computed(() => {
    const s = this.state();
    return Object.values(s).some((v) => v.result && (v.result.metrics?.length || v.result.monetization?.supported));
  });

  /**
   * Export all currently-loaded metrics to a CSV file (Agency only). Flattens
   * every loaded account's metrics — including monetisation — into rows of
   * account, platform, category, metric, value, period.
   */
  exportCsv(): void {
    if (!this.canExport()) {
      this.toast.info('Agency feature', 'Analytics export is available on the Agency plan.');
      return;
    }
    const rows: string[][] = [['Platform', 'Account', 'Category', 'Metric', 'Value', 'Period (days)']];
    const period = String(this.days());
    const state = this.state();

    for (const r of this.rows()) {
      const st = state[this.keyOf(r)];
      const res = st?.result;
      if (!res) continue;
      const all: AnalyticsMetric[] = [
        ...(res.metrics || []),
        ...(res.monetization?.supported ? res.monetization.metrics || [] : []),
      ];
      for (const m of all) {
        rows.push([
          r.platform,
          r.label,
          m.category || 'engagement',
          m.label,
          String(m.value),
          period,
        ]);
      }
    }

    if (rows.length === 1) {
      this.toast.info('Nothing to export', 'Load insights for at least one account first.');
      return;
    }

    const csv = rows.map((cols) => cols.map(csvCell).join(',')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`analytics-${stamp}.csv`, csv, 'text/csv;charset=utf-8;');
    this.toast.success('Export ready', `Downloaded ${rows.length - 1} metric row(s).`);
  }

  /** Connected accounts on analytics-capable platforms. */
  readonly rows = computed<AnalyticsRow[]>(() => {
    const out: AnalyticsRow[] = [];
    for (const p of this.platformSvc.platforms()) {
      if (!p.supportsAnalytics) continue;
      for (const acct of this.auth.getAccounts(p.key)) {
        out.push({
          platform: p.key,
          accountId: acct.accountId,
          label: acct.label,
          requiresTarget: p.requiresTarget,
        });
      }
    }
    return out;
  });

  readonly hasRows = computed(() => this.rows().length > 0);

  private keyOf(r: AnalyticsRow): string {
    return `${r.platform}::${r.accountId}`;
  }

  stateFor(r: AnalyticsRow): { loading: boolean; result?: AnalyticsResult; error?: string } | undefined {
    return this.state()[this.keyOf(r)];
  }

  /**
   * Group a result's metrics into ordered category sections (audience, reach,
   * engagement, monetisation). Monetisation metrics come from the dedicated
   * `monetization.metrics` block. Empty categories are omitted.
   */
  groupsFor(res: AnalyticsResult): MetricGroup[] {
    const all: AnalyticsMetric[] = [
      ...(res.metrics || []),
      ...(res.monetization?.supported ? res.monetization.metrics || [] : []),
    ];
    const groups: MetricGroup[] = [];
    for (const meta of CATEGORY_META) {
      const metrics = all.filter((m) => (m.category || 'engagement') === meta.key);
      if (metrics.length) {
        groups.push({ category: meta.key, title: meta.title, icon: meta.icon, metrics });
      }
    }
    return groups;
  }

  /** True when the result carries no displayable metrics at all. */
  isEmpty(res: AnalyticsResult): boolean {
    return (res.metrics?.length ?? 0) === 0 && !res.monetization?.supported;
  }

  /** Headline audience number (total followers/subscribers) if present. */
  headlineFollowers(res: AnalyticsResult): AnalyticsMetric | null {
    return (
      (res.metrics || []).find((m) =>
        /followers_total|subscribers_total/.test(m.key)
      ) || null
    );
  }

  /** Monetisation values are money — the template prefixes them with $. */
  isMoney(m: AnalyticsMetric): boolean {
    return m.category === 'monetization';
  }

  /** The monetisation "not available" note for a result, if any. */
  monetizationNote(res: AnalyticsResult): string | null {
    if (res.monetization && !res.monetization.supported) {
      return res.monetization.note || 'Monetisation data is not available for this platform.';
    }
    return null;
  }

  setDays(d: number): void {
    this.days.set(d);
    // Clear cached results so the next load uses the new window.
    this.state.set({});
  }

  onTargetChange(r: AnalyticsRow, targetId: string): void {
    this.targets.select(r.platform, r.accountId, targetId);
  }

  async load(r: AnalyticsRow): Promise<void> {
    const key = this.keyOf(r);
    const targetId = r.requiresTarget ? this.targets.selectedIdFor(r.platform, r.accountId) : undefined;
    if (r.requiresTarget && !targetId) {
      this.patch(key, { loading: false, error: 'Choose a destination first.' });
      return;
    }
    this.patch(key, { loading: true, error: undefined });
    try {
      const result = await this.analytics.fetch(r.platform, r.accountId, this.days(), targetId);
      this.patch(key, { loading: false, result });
    } catch (e) {
      this.patch(key, { loading: false, error: extractError(e) });
    }
  }

  private patch(key: string, val: { loading: boolean; result?: AnalyticsResult; error?: string }): void {
    this.state.set({ ...this.state(), [key]: { ...this.state()[key], ...val } });
  }
}

/** Pull a readable message out of an HttpErrorResponse or Error. */
function extractError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const any = e as { error?: { error?: string } | string; message?: string };
    if (any.error && typeof any.error === 'object' && typeof any.error.error === 'string') {
      return any.error.error;
    }
    if (typeof any.error === 'string') return any.error;
    if (typeof any.message === 'string') return any.message;
  }
  return 'Could not load analytics.';
}

/** Escape a value for a CSV cell (quote if it contains comma, quote, or newline). */
function csvCell(value: string): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Trigger a client-side file download (no server round-trip). */
function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
