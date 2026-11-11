/**
 * AppComponent — the application shell: top nav, page outlet, footer, and the
 * floating help assistant. On startup it loads the enabled platforms and
 * restores any persisted account connections (Option 1). Also owns the admin
 * logout action. See ARCHITECTURE.md §1 & §7.
 */
import { Component, HostListener, OnInit, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { PlatformService } from './core/services/platform.service';
import { AdminAuthService } from './core/services/admin-auth.service';
import { AuthService } from './core/services/auth.service';
import { CustomerAuthService } from './core/services/customer-auth.service';
import { UsageService } from './core/services/usage.service';
import { AppConfigService } from './core/services/app-config.service';
import { HelpBotComponent } from './features/help/help-bot.component';
import { ToastContainerComponent } from './core/components/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, HelpBotComponent, ToastContainerComponent],
  template: `
    <app-toast-container />

    @if (!isChromeless()) {
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">◆</span>
          <span>Social Cross-Poster</span>
        </div>
        <button
          class="nav-toggle"
          type="button"
          [class.open]="navOpen()"
          (click)="toggleNav($event)"
          aria-label="Toggle menu"
          [attr.aria-expanded]="navOpen()"
        >
          <span></span><span></span><span></span>
        </button>
        <nav class="app-nav" [class.open]="navOpen()">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" (click)="closeNav()">Home</a>
          <a routerLink="/compose" routerLinkActive="active" (click)="closeNav()">Compose</a>
          <a routerLink="/connections" routerLinkActive="active" (click)="closeNav()">Connections</a>
          <a routerLink="/ai" routerLinkActive="active" (click)="closeNav()">AI Assistant</a>
          <a routerLink="/analytics" routerLinkActive="active" (click)="closeNav()">Analytics</a>
          @if (customerAuth.isAuthenticated()) {
            <a routerLink="/billing" routerLinkActive="active" (click)="closeNav()">Plan</a>
          }
          <a routerLink="/admin" routerLinkActive="active" (click)="closeNav()">Administrator</a>
          @if (adminAuth.isAuthenticated()) {
            <a routerLink="/admin-dashboard" routerLinkActive="active" (click)="closeNav()">Dashboard</a>
          }
          @if (customerAuth.isAuthenticated()) {
            <div class="user-menu" [class.open]="userMenuOpen()">
              <button class="user-trigger" (click)="toggleUserMenu($event)" type="button">
                <span class="user-avatar">{{ customerAuth.displayName().charAt(0) }}</span>
                <span class="user-name">{{ customerAuth.displayName() }}</span>
                <span class="user-caret">▾</span>
              </button>
              @if (userMenuOpen()) {
                <div class="user-dropdown">
                  <div class="user-dropdown-head">
                    <span class="dd-name">{{ customerAuth.displayName() }}</span>
                    <span class="dd-email">{{ customerAuth.email() }}</span>
                  </div>
                  <a class="user-dropdown-item" routerLink="/profile" (click)="closeUserMenu()">
                    <span class="dd-icon">👤</span> Profile
                  </a>
                  <a class="user-dropdown-item" routerLink="/billing" (click)="closeUserMenu()">
                    <span class="dd-icon">💳</span> Plan &amp; billing
                  </a>
                  <a class="user-dropdown-item" routerLink="/support" (click)="closeUserMenu()">
                    <span class="dd-icon">✉</span> Contact support
                  </a>
                  <button class="user-dropdown-item danger" (click)="customerLogout()" type="button">
                    <span class="dd-icon">↪</span> Sign out
                  </button>
                </div>
              }
            </div>
          } @else {
            <a routerLink="/login" routerLinkActive="active">Sign in</a>
          }
          @if (adminAuth.isAuthenticated()) {
            <div class="user-menu admin" [class.open]="adminMenuOpen()">
              <button class="user-trigger" (click)="toggleAdminMenu($event)" type="button">
                <span class="user-avatar admin">{{ (adminAuth.username() || 'A').charAt(0) }}</span>
                <span class="user-name">{{ adminAuth.username() }}</span>
                <span class="user-caret">▾</span>
              </button>
              @if (adminMenuOpen()) {
                <div class="user-dropdown">
                  <div class="user-dropdown-head">
                    <span class="dd-name">{{ adminAuth.username() }}</span>
                    <span class="dd-email">Administrator</span>
                  </div>
                  <a class="user-dropdown-item" routerLink="/admin-dashboard" (click)="closeAdminMenu()">
                    <span class="dd-icon">📊</span> Dashboard
                  </a>
                  <a class="user-dropdown-item" routerLink="/admin" (click)="closeAdminMenu()">
                    <span class="dd-icon">⚙</span> Platform config
                  </a>
                  <button class="user-dropdown-item danger" (click)="logout()" type="button">
                    <span class="dd-icon">↪</span> Admin logout
                  </button>
                </div>
              }
            </div>
          }
        </nav>
      </header>
    }

    <main class="app-main" [class.full-bleed]="isChromeless()" [class.wide]="isWide()">
      <router-outlet />
    </main>

    @if (!isChromeless()) {
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <div class="brand">
            <span class="brand-mark">◆</span>
            <span>Social Media Cross Poster</span>
          </div>
          <p class="footer-tagline">
            No more jumping between apps. Post, schedule, and automate across all
            your channels without the headache. Keep it simple, keep it efficient.
          </p>
          <div class="footer-social">
            <a href="https://facebook.com/" target="_blank" rel="noopener" aria-label="Facebook" title="Facebook">f</a>
            <a href="https://instagram.com/" target="_blank" rel="noopener" aria-label="Instagram" title="Instagram">◎</a>
            <a href="https://youtube.com/" target="_blank" rel="noopener" aria-label="YouTube" title="YouTube">▶</a>
            <a href="https://tiktok.com/" target="_blank" rel="noopener" aria-label="TikTok" title="TikTok">♪</a>
          </div>
        </div>

        <div class="footer-cols">
          <div class="footer-col">
            <h4>Product</h4>
            <a routerLink="/compose">Compose</a>
            <a routerLink="/connections">Connections</a>
            <a routerLink="/admin">Administrator</a>
          </div>
          <div class="footer-col">
            <h4>Resources</h4>
            <a href="#">Documentation</a>
            <a href="#">Getting started</a>
            <a href="#">API reference</a>
          </div>
          <div class="footer-col">
            <h4>Nkwana PTY</h4>
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">Contact</a>
          </div>
        </div>
      </div>

      <div class="footer-bottom">
        <span>© Mathema Nkwana @{{ year }}. All Rights Reserved.</span>
        <span class="footer-note">Nothing is saved — tokens live only in this browser session.</span>
      </div>
    </footer>
    }

    @if (!isChromeless()) {
      <app-help-bot />
    }
  `,
})
export class AppComponent implements OnInit {
  private readonly platforms = inject(PlatformService);
  readonly adminAuth = inject(AdminAuthService);
  readonly customerAuth = inject(CustomerAuthService);
  private readonly auth = inject(AuthService);
  private readonly usage = inject(UsageService);
  private readonly router = inject(Router);
  private readonly appConfig = inject(AppConfigService);

  readonly year = new Date().getFullYear();

  /** True on the landing page ('/'), where the app's own chrome is hidden. */
  readonly isLanding = signal(this.router.url === '/' || this.router.url === '');

  /** Chromeless, full-bleed routes: landing + the auth screens. */
  readonly isChromeless = signal(this.isChromelessUrl(this.router.url));

  /** True on wide screens (admin dashboard, billing) that break the 720px cap. */
  readonly isWide = signal(this.isWideUrl(this.router.url));

  /** Nav user-menu dropdowns (customer + admin). */
  readonly userMenuOpen = signal(false);
  readonly adminMenuOpen = signal(false);

  /** Mobile hamburger nav state. */
  readonly navOpen = signal(false);

  constructor() {
    // Connected accounts are per-customer. Only act once Supabase has finished
    // restoring the session (avoids a refresh race where we'd fire /api/tokens
    // before the auth token is available and get an empty/401 result).
    effect(() => {
      if (!this.customerAuth.authReady()) return;
      if (this.customerAuth.isAuthenticated()) {
        void this.auth.loadPersisted();
      } else {
        this.auth.clearAll();
      }
    });
  }

  ngOnInit(): void {
    // Load the enabled platforms + public app config once at startup.
    void this.platforms.load();
    void this.appConfig.load();

    // Track route changes: toggle landing chrome + record a pageview (built-in
    // traffic counter).
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.isLanding.set(e.urlAfterRedirects === '/');
        this.isChromeless.set(this.isChromelessUrl(e.urlAfterRedirects));
        this.isWide.set(this.isWideUrl(e.urlAfterRedirects));
        this.navOpen.set(false); // collapse the mobile menu on navigation
        this.usage.record('pageview', e.urlAfterRedirects);
      });
  }

  /** Routes rendered full-bleed without the app header/footer (landing + auth). */
  private isChromelessUrl(url: string): boolean {
    return (
      url === '/' ||
      url === '' ||
      url.startsWith('/login') ||
      url.startsWith('/admin-login') ||
      url.startsWith('/mock-checkout')
    );
  }

  /** Routes that use the wide (full-screen) layout instead of the 720px column. */
  private isWideUrl(url: string): boolean {
    return (
      url.startsWith('/admin-dashboard') ||
      url.startsWith('/billing') ||
      url.startsWith('/analytics') ||
      url.startsWith('/connections') ||
      url.startsWith('/compose') ||
      url.startsWith('/ai')
    );
  }

  // --- Nav user-menu dropdowns ---
  toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.adminMenuOpen.set(false);
    this.userMenuOpen.update((v) => !v);
  }
  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }
  toggleAdminMenu(event: Event): void {
    event.stopPropagation();
    this.userMenuOpen.set(false);
    this.adminMenuOpen.update((v) => !v);
  }
  closeAdminMenu(): void {
    this.adminMenuOpen.set(false);
  }

  // --- Mobile hamburger nav ---
  toggleNav(event: Event): void {
    event.stopPropagation();
    this.navOpen.update((v) => !v);
  }
  closeNav(): void {
    this.navOpen.set(false);
  }



  /** Close any open dropdown when clicking anywhere else, or pressing Escape. */
  @HostListener('document:click')
  onDocumentClick(): void {
    this.userMenuOpen.set(false);
    this.adminMenuOpen.set(false);
    this.navOpen.set(false);
  }
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
    this.adminMenuOpen.set(false);
    this.navOpen.set(false);
  }

  logout(): void {
    this.closeAdminMenu();
    this.adminAuth.logout();
    void this.router.navigate(['/compose']);
  }

  async customerLogout(): Promise<void> {
    this.closeUserMenu();
    await this.customerAuth.signOut();
    void this.router.navigate(['/']);
  }
}
