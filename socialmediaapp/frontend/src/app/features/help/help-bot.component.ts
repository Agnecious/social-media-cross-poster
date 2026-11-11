import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HelpBotService, Suggestion } from '../../core/services/help-bot.service';

interface ChatMessage {
  from: 'bot' | 'user';
  text: string;
}

/**
 * HelpBotComponent — a floating help assistant.
 *
 * Rule-based and fully client-side: it answers questions about using the app
 * (connecting accounts, composing, cross-posting, scheduling). It does not
 * cover administration; those questions are politely deflected by the service.
 */
@Component({
  selector: 'app-help-bot',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- Toggle bubble -->
    <button
      class="help-fab"
      [class.open]="open()"
      (click)="toggle()"
      [attr.aria-label]="open() ? 'Close help' : 'Open help'"
      title="Help"
    >
      {{ open() ? '✕' : '?' }}
    </button>

    @if (open()) {
      <div class="help-panel" role="dialog" aria-label="Help assistant">
        <div class="help-header">
          <span class="help-title">Help Assistant</span>
          <span class="help-sub">Ask about using the app</span>
        </div>

        <div class="help-messages">
          @for (m of messages(); track $index) {
            <div class="help-msg" [class.bot]="m.from === 'bot'" [class.user]="m.from === 'user'">
              {{ m.text }}
            </div>
          }
        </div>

        @if (messages().length <= 1) {
          <div class="help-suggestions">
            @for (s of bot.suggestions; track s.query) {
              <button class="help-chip" (click)="ask(s.query)">{{ s.label }}</button>
            }
          </div>
        }

        <form class="help-input" (ngSubmit)="send()">
          <input
            type="text"
            placeholder="Type your question…"
            [ngModel]="draft()"
            (ngModelChange)="draft.set($event)"
            name="draft"
            autocomplete="off"
          />
          <button type="submit" class="btn primary small" [disabled]="!draft().trim()">Send</button>
        </form>
      </div>
    }
  `,
})
export class HelpBotComponent {
  readonly bot = inject(HelpBotService);

  readonly open = signal(false);
  readonly draft = signal('');
  readonly messages = signal<ChatMessage[]>([
    {
      from: 'bot',
      text:
        "Hi! I can help you use the app — connecting accounts, composing, cross-posting, and scheduling. " +
        'What would you like to do?',
    },
  ]);

  toggle(): void {
    this.open.update((v) => !v);
  }

  ask(query: string): void {
    this.push('user', query);
    this.push('bot', this.bot.answer(query));
  }

  send(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    this.ask(text);
  }

  private push(from: 'bot' | 'user', text: string): void {
    this.messages.update((list) => [...list, { from, text }]);
  }
}
