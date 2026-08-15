import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  host: { '[attr.lang]': 'i18n.language()', class: 'about-route' },
  template: `
    <gones-back-button data-cy="about-back-top" [link]="['/']" [label]="i18n.t('about.back')" position="top" />
    <div class="about-page" data-cy="about-page">
      <section class="about-hero" data-cy="about-hero" aria-labelledby="about-title">
        <div class="about-hero__copy" data-cy="about-hero-copy">
          <p class="kicker" data-cy="about-hero-kicker" data-reveal>{{ i18n.t('about.hero.kicker') }}</p>
          <h1 id="about-title" data-cy="about-hero-title" data-reveal style="--reveal-delay: 70ms">{{ i18n.t('about.hero.title') }}</h1>
          <p class="about-hero__lede" data-cy="about-hero-lede" data-reveal style="--reveal-delay: 140ms">{{ i18n.t('about.hero.lede') }}</p>
          <div class="info-actions" data-cy="about-hero-actions" data-reveal style="--reveal-delay: 210ms">
            <a mat-flat-button class="home-primary-action" routerLink="/events" data-cy="about-hero-calendar-link">{{ i18n.t('about.hero.calendar') }}</a>
            <a mat-stroked-button class="secondary-action" routerLink="/about" fragment="equipe" data-cy="about-hero-team-link">{{ i18n.t('about.hero.team') }}</a>
          </div>
        </div>
        <a class="about-hero__mark" routerLink="/" [attr.aria-label]="i18n.t('about.hero.logoAria')" data-cy="about-logo-link" data-reveal="scale" style="--reveal-delay: 210ms">
          <img src="assets/gones_logo.png" alt="" data-cy="about-logo-image" aria-hidden="true">
          <span data-cy="about-logo-caption">{{ i18n.t('about.hero.logoCaption') }}</span>
        </a>
      </section>

      <section class="about-intro" data-cy="about-intro" aria-labelledby="association-title">
        <div data-cy="about-intro-heading" data-reveal="left">
          <p class="kicker" data-cy="about-intro-kicker">{{ i18n.t('about.intro.kicker') }}</p>
          <h2 id="association-title" data-cy="about-intro-title">{{ i18n.t('about.intro.title') }}</h2>
        </div>
        <div class="about-intro__copy" data-cy="about-intro-copy" data-reveal="right" style="--reveal-delay: 70ms">
          <p data-cy="about-intro-paragraph-1">{{ i18n.t('about.intro.paragraph1') }}</p>
          <p data-cy="about-intro-paragraph-2">{{ i18n.t('about.intro.paragraph2') }}</p>
          <p data-cy="about-intro-paragraph-3">{{ i18n.t('about.intro.paragraph3') }}</p>
        </div>
      </section>

      <dl class="about-numbers" data-cy="about-numbers" [attr.aria-label]="i18n.t('about.numbers.aria')">
        <div data-cy="about-number-1" data-reveal><dt data-cy="about-number-1-term">{{ i18n.t('about.numbers.weeklyTerm') }}</dt><dd data-cy="about-number-1-value">{{ i18n.t('about.numbers.weeklyValue') }}</dd></div>
        <div data-cy="about-number-2" data-reveal style="--reveal-delay: 70ms"><dt data-cy="about-number-2-term">{{ i18n.t('about.numbers.playersTerm') }}</dt><dd data-cy="about-number-2-value">{{ i18n.t('about.numbers.playersValue') }}</dd></div>
        <div data-cy="about-number-3" data-reveal style="--reveal-delay: 140ms"><dt data-cy="about-number-3-term">{{ i18n.t('about.numbers.formatTerm') }}</dt><dd data-cy="about-number-3-value">{{ i18n.t('about.numbers.formatValue') }}</dd></div>
      </dl>

      <section class="about-weekly" data-cy="about-weekly" aria-labelledby="weekly-title">
        <div class="about-weekly__date" data-cy="about-weekly-date" aria-hidden="true" data-reveal="scale"><span data-cy="about-weekly-date-prefix">{{ i18n.t('about.weekly.datePrefix') }}</span><strong data-cy="about-weekly-date-day">{{ i18n.t('about.weekly.dateDay') }}</strong></div>
        <div data-cy="about-weekly-copy" data-reveal style="--reveal-delay: 70ms">
          <p class="kicker" data-cy="about-weekly-kicker">{{ i18n.t('about.weekly.kicker') }}</p>
          <h2 id="weekly-title" data-cy="about-weekly-title">{{ i18n.t('about.weekly.title') }}</h2>
          <p data-cy="about-weekly-body">{{ i18n.t('about.weekly.body') }}</p>
        </div>
        <a mat-stroked-button class="secondary-action" routerLink="/events" data-cy="about-weekly-calendar-link" data-reveal style="--reveal-delay: 140ms">{{ i18n.t('about.weekly.calendar') }}</a>
      </section>

      <section class="about-events" data-cy="about-events" aria-labelledby="events-title">
        <header class="about-section-heading" data-cy="about-events-heading" data-reveal>
          <p class="kicker" data-cy="about-events-kicker">{{ i18n.t('about.events.kicker') }}</p>
          <h2 id="events-title" data-cy="about-events-title"><span class="about-events__fire" data-cy="about-events-title-fire">Fire</span> &amp; <span class="about-events__ice" data-cy="about-events-title-ice">Ice</span></h2>
          <p data-cy="about-events-body">{{ i18n.t('about.events.body') }}</p>
        </header>
        <div class="about-event-grid" data-cy="about-event-grid">
          @for (event of featuredEvents(); track event.name) {
            <article [class]="'about-event about-event--' + event.theme" [attr.data-cy]="'about-event-' + event.theme" data-reveal="scale" [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-event__copy" [attr.data-cy]="'about-event-copy-' + event.theme">
                <p class="kicker" [attr.data-cy]="'about-event-season-' + event.theme">{{ event.season }}</p>
                <h3 [attr.data-cy]="'about-event-name-' + event.theme">{{ event.name }}</h3>
              </div>
              <img [src]="event.image" alt="" loading="lazy" [attr.data-cy]="'about-event-image-' + event.theme" [attr.width]="event.width" [attr.height]="event.height">
            </article>
          }
        </div>
        <h3 class="about-formats-title" data-cy="about-formats-title" data-reveal>{{ i18n.t('about.events.formatsTitle') }}</h3>
        <ul class="about-formats" data-cy="about-formats" [attr.aria-label]="i18n.t('about.events.formatsAria')">
          @for (format of formats; track format.name) {
            <li [attr.data-cy]="'about-format-' + format.theme" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <a [class]="'about-format-link about-format-link--' + format.theme" [attr.data-cy]="'about-format-link-' + format.theme" [href]="format.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('about.events.formatRulesAria', { name: format.name })">
                <strong [attr.data-cy]="'about-format-name-' + format.theme">{{ format.name }}</strong>
              </a>
            </li>
          }
        </ul>
      </section>

      <section id="equipe" class="about-team" data-cy="about-team" aria-labelledby="team-title" tabindex="-1">
        <header class="about-section-heading" data-cy="about-team-heading" data-reveal>
          <p class="kicker" data-cy="about-team-kicker">{{ i18n.t('about.team.kicker') }}</p>
          <h2 id="team-title" data-cy="about-team-title">{{ i18n.t('about.team.title') }}</h2>
          <p data-cy="about-team-body">{{ i18n.t('about.team.body') }}</p>
        </header>
        <div class="about-team-grid" data-cy="about-team-grid">
          @for (group of memberGroups(); track group.id) {
            <section class="about-team-group" [attr.data-cy]="'about-team-group-' + group.id" [attr.aria-labelledby]="group.id">
              <h3 [id]="group.id" [attr.data-cy]="'about-team-group-title-' + group.id" data-reveal>{{ group.title }}</h3>
              @for (member of group.members; track member.name) {
                <article class="about-person" [attr.data-cy]="'about-person-' + group.id + '-' + $index" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
                  <div class="about-person__portrait" [attr.data-cy]="'about-person-portrait-' + group.id + '-' + $index" aria-hidden="true">
                    <span [attr.data-cy]="'about-person-initials-' + group.id + '-' + $index">{{ member.initials }}</span>
                    <small [attr.data-cy]="'about-person-photo-pending-' + group.id + '-' + $index">{{ i18n.t('about.team.photoPending') }}</small>
                  </div>
                  <div class="about-person__copy" [attr.data-cy]="'about-person-copy-' + group.id + '-' + $index">
                    <p class="about-person__role" [attr.data-cy]="'about-person-role-' + group.id + '-' + $index">{{ member.role }}</p>
                    <h4 [attr.data-cy]="'about-person-name-' + group.id + '-' + $index">{{ member.name }}</h4>
                    @if (member.detail) { <p class="about-person__detail" [attr.data-cy]="'about-person-detail-' + group.id + '-' + $index">{{ member.detail }}</p> }
                    <p class="about-person__bio" [attr.data-cy]="'about-person-bio-' + group.id + '-' + $index">{{ i18n.t('about.team.bioPending') }}</p>
                  </div>
                </article>
              }
            </section>
          }
        </div>
      </section>

      <section class="about-contributors" data-cy="about-contributors" aria-labelledby="contributors-title">
        <header class="about-section-heading" data-cy="about-contributors-heading" data-reveal>
          <p class="kicker" data-cy="about-contributors-kicker">{{ i18n.t('about.contributors.kicker') }}</p>
          <h2 id="contributors-title" data-cy="about-contributors-title">{{ i18n.t('about.contributors.title') }}</h2>
          <p data-cy="about-contributors-body">{{ i18n.t('about.contributors.body') }}</p>
        </header>
        <div class="about-contributor-grid" data-cy="about-contributor-grid">
          @for (contributor of contributors(); track contributor.name) {
            <article class="about-contributor" [attr.data-cy]="'about-contributor-' + $index" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-contributor__portrait" [attr.data-cy]="'about-contributor-portrait-' + $index" aria-hidden="true">?</div>
              <div [attr.data-cy]="'about-contributor-copy-' + $index"><h3 [attr.data-cy]="'about-contributor-name-' + $index">{{ contributor.name }}</h3><p [attr.data-cy]="'about-contributor-description-' + $index">{{ contributor.description }}</p></div>
            </article>
          }
        </div>
      </section>

      <section class="about-contact" data-cy="about-contact" aria-labelledby="contact-title">
        <div data-cy="about-contact-copy" data-reveal="left">
          <p class="kicker" data-cy="about-contact-kicker">{{ i18n.t('about.contact.kicker') }}</p>
          <h2 id="contact-title" data-cy="about-contact-title">{{ i18n.t('about.contact.title') }}</h2>
          <p data-cy="about-contact-body">{{ i18n.t('about.contact.body') }}</p>
          <div class="info-actions" data-cy="about-contact-actions">
            <a mat-flat-button class="home-primary-action" routerLink="/events" data-cy="about-contact-calendar-link">{{ i18n.t('about.contact.calendar') }}</a>
          </div>
        </div>
        <address class="about-contact__details" data-cy="about-contact-details">
          <p data-cy="about-contact-location" data-reveal="right"><span data-cy="about-contact-location-label">{{ i18n.t('about.contact.locationLabel') }}</span><strong data-cy="about-contact-location-value">{{ i18n.t('about.contact.locationValue') }}</strong></p>
          <p data-cy="about-contact-email" data-reveal="right" style="--reveal-delay: 70ms"><span data-cy="about-contact-email-label">{{ i18n.t('about.contact.emailLabel') }}</span><strong data-cy="about-contact-email-value">{{ i18n.t('about.contact.emailPending') }}</strong></p>
          <div class="about-contact__socials" data-cy="about-contact-socials" data-reveal="right" style="--reveal-delay: 140ms">
            <span data-cy="about-contact-socials-label">{{ i18n.t('about.contact.socialsLabel') }}</span>
            <div class="about-social-links" data-cy="about-social-links">
              <a class="about-social-link" href="https://discord.gg/znGRG36Kz" target="_blank" rel="noopener noreferrer" data-cy="about-social-discord" [attr.aria-label]="i18n.t('about.contact.discordAria')">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.1 7.2a14 14 0 0 1 7.8 0l.8 1.1a8.4 8.4 0 0 1 2.1 6.1 10.6 10.6 0 0 1-3.3 1.7l-.8-1.1a5.7 5.7 0 0 0 1.2-.6 6.8 6.8 0 0 1-7.8 0c.4.3.8.5 1.2.6l-.8 1.1a10.6 10.6 0 0 1-3.3-1.7 8.4 8.4 0 0 1 2.1-6.1l.8-1.1Zm1.5 4.7c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4Zm3.6 0c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4Z"/></svg>
                <b data-cy="about-social-discord-label">Discord</b>
              </a>
              <a class="about-social-link" href="https://www.facebook.com/mtgones/" target="_blank" rel="noopener noreferrer" data-cy="about-social-facebook" [attr.aria-label]="i18n.t('about.contact.facebookAria')">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.7 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V4a22 22 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.2V10H8v3h2.6v8h3.1Z"/></svg>
                <b data-cy="about-social-facebook-label">Facebook</b>
              </a>
              <a class="about-social-link" href="https://x.com/MtgOnes" target="_blank" rel="noopener noreferrer" data-cy="about-social-x" [attr.aria-label]="i18n.t('about.contact.xAria')">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.3 3h3.4l-7.4 8.5L23 21h-6.8l-5.3-6.9L4.8 21H1.4l7.9-9.1L1 3h7l4.8 6.3L18.3 3Zm-1.2 16.3H19L6.9 4.6h-2l12.2 14.7Z"/></svg>
                <b data-cy="about-social-x-label">X</b>
              </a>
            </div>
          </div>
        </address>
      </section>
    </div>
    <gones-back-button data-cy="about-back-bottom" [link]="['/']" [label]="i18n.t('about.back')" position="bottom" />
  `
})
export class AboutComponent implements AfterViewInit, OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private revealObserver?: IntersectionObserver;

  readonly featuredEvents = computed(() => [
    { name: 'Fire', theme: 'fire', season: this.i18n.t('about.events.fireSeason'), image: 'assets/fire-about.webp', width: 1000, height: 1324 },
    { name: 'Ice', theme: 'ice', season: this.i18n.t('about.events.iceSeason'), image: 'assets/ice-about.webp', width: 1000, height: 1168 }
  ] as const);

  readonly formats = [
    { name: 'Legacy', theme: 'legacy', url: 'https://magic.wizards.com/en/formats/legacy' },
    { name: 'Pauper', theme: 'pauper', url: 'https://magic.wizards.com/en/formats/pauper' },
    { name: 'Premodern', theme: 'premodern', url: 'https://premodernmagic.com/' },
    { name: 'Vintage', theme: 'vintage', url: 'https://magic.wizards.com/en/formats/vintage' },
    { name: 'Duel Commander', theme: 'duel-commander', url: 'https://www.mtgdc.info/' }
  ] as const;

  readonly memberGroups = computed(() => [
    {
      id: 'founders-title',
      title: this.i18n.t('about.team.founders'),
      members: [
        { name: 'Gregory Millon', initials: 'GM', role: this.i18n.t('about.team.roleFounder'), detail: '' },
        { name: 'Ganesh', initials: 'GA', role: this.i18n.t('about.team.roleFounder'), detail: `Antoine — ${this.i18n.t('about.team.namePending')}` },
        { name: 'Edouart', initials: 'ED', role: this.i18n.t('about.team.roleFounder'), detail: this.i18n.t('about.team.namePending') }
      ]
    },
    {
      id: 'members-title',
      title: this.i18n.t('about.team.members'),
      members: [
        { name: 'Alexandre Noir', initials: 'AN', role: this.i18n.t('about.team.roleOrganizer'), detail: '' },
        { name: 'Chowchow', initials: 'CH', role: this.i18n.t('about.team.roleCook'), detail: '' },
        { name: 'Lukas', initials: 'LU', role: this.i18n.t('about.team.roleCommunityManager'), detail: this.i18n.t('about.team.namePending') },
        { name: 'Nathan Flachaire', initials: 'NF', role: this.i18n.t('about.team.roleMediaCreator'), detail: '' },
        { name: 'Yoan', initials: 'YO', role: this.i18n.t('about.team.roleOrganizer'), detail: this.i18n.t('about.team.namePending') },
        { name: 'Simon', initials: 'SI', role: this.i18n.t('about.team.roleOrganizer'), detail: this.i18n.t('about.team.namePending') }
      ]
    }
  ]);

  readonly contributors = computed(() => [1, 2, 3].map(number => ({
    name: this.i18n.t('about.contributors.pendingName', { number: String(number).padStart(2, '0') }),
    description: this.i18n.t('about.contributors.pendingDescription')
  })));

  ngAfterViewInit(): void {
    if (!('IntersectionObserver' in window)) return;

    const revealElements = this.hostElement.nativeElement.querySelectorAll<HTMLElement>('[data-reveal]');
    this.hostElement.nativeElement.classList.add('about-motion-ready');
    this.revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        this.revealObserver?.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    revealElements.forEach(element => this.revealObserver?.observe(element));
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
  }
}
