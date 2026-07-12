import { AfterViewInit, Component, ElementRef, OnDestroy, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  host: { lang: 'fr', class: 'about-route' },
  template: `
    <gones-back-button [link]="['/']" label="Retour au menu" position="top" />
    <div class="about-page">
      <section class="about-hero" aria-labelledby="about-title">
        <div class="about-hero__copy">
          <p class="kicker" data-reveal>Association lyonnaise · Magic: The Gathering</p>
          <h1 id="about-title" data-reveal style="--reveal-delay: 70ms">Le Legacy se joue à Lyon.</h1>
          <p class="about-hero__lede" data-reveal style="--reveal-delay: 140ms">Gones réunit les passionnés de Magic autour de tournois exigeants, accueillants et mémorables — du rendez-vous du jeudi aux grands week-ends Fire & Ice.</p>
          <div class="info-actions" data-reveal style="--reveal-delay: 210ms">
            <a mat-flat-button class="home-primary-action" routerLink="/calendar">Voir les prochains tournois</a>
            <a mat-stroked-button class="secondary-action" routerLink="/about" fragment="equipe">Rencontrer l’équipe</a>
          </div>
        </div>
        <a class="about-hero__mark" routerLink="/" aria-label="Retour au menu" data-cy="about-logo-link" data-reveal="scale" style="--reveal-delay: 210ms">
          <img src="assets/gones_logo.png" alt="" aria-hidden="true">
          <span>Depuis Lyon</span>
        </a>
      </section>

      <section class="about-intro" aria-labelledby="association-title">
        <div data-reveal="left">
          <p class="kicker">Notre association</p>
          <h2 id="association-title">Faire vivre une communauté autour du Legacy.</h2>
        </div>
        <div class="about-intro__copy" data-reveal="right" style="--reveal-delay: 70ms">
          <p>Gones est une association française basée à Lyon. Elle organise des tournois de Magic: The Gathering au format Legacy. Un format historique où se côtoient les cartes et les combos les plus puissants du Magic old school et moderne. Un format impitoyable où la moindre erreur peut coûter une partie.</p>
          <p>Notre ambition est simple : proposer des événements bien organisés, préserver une scène locale active et créer des rendez-vous réguliers où compétiteurs, habitués et nouveaux venus ont plaisir à se retrouver.</p>
          <p>Avoir une bonne ambiance est primordial. Chez MTGones, vous allez profiter du vrai « Beer &amp; Magic » !</p>
        </div>
      </section>

      <dl class="about-numbers" aria-label="Gones en quelques chiffres">
        <div data-reveal><dt>Chaque jeudi</dt><dd>Un tournoi Legacy à Lyon</dd></div>
        <div data-reveal style="--reveal-delay: 70ms"><dt>≈ 20 à 30</dt><dd>Joueurs par tournoi</dd></div>
        <div data-reveal style="--reveal-delay: 140ms"><dt>1 format</dt><dd>Le Legacy</dd></div>
      </dl>

      <section class="about-weekly" aria-labelledby="weekly-title">
        <div class="about-weekly__date" aria-hidden="true" data-reveal="scale"><span>Chaque</span><strong>Jeudi</strong></div>
        <div data-reveal style="--reveal-delay: 70ms">
          <p class="kicker">Le Legacy du Jeudi Soir</p>
          <h2 id="weekly-title">Le Rendez-vous qui ne se rate pas !</h2>
          <p>Chaque semaine, la communauté lyonnaise se retrouve pour jouer, tester et progresser dans une ambiance conviviale. Consultez le calendrier pour connaître la date, l’horaire et le lieu du prochain tournoi.</p>
        </div>
        <a mat-stroked-button class="secondary-action" routerLink="/calendar" data-reveal style="--reveal-delay: 140ms">Ouvrir le calendrier</a>
      </section>

      <section class="about-events" aria-labelledby="events-title">
        <header class="about-section-heading" data-reveal>
          <p class="kicker">Deux saisons, un grand rendez-vous</p>
          <h2 id="events-title"><span class="about-events__fire">Fire</span> &amp; <span class="about-events__ice">Ice</span></h2>
          <p>Deux tournois multi-jours rassemblent la communauté le temps d’un week-end, en été comme en hiver.</p>
        </header>
        <div class="about-event-grid">
          @for (event of featuredEvents; track event.name) {
            <article [class]="'about-event about-event--' + event.theme" data-reveal="scale" [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-event__copy">
                <p class="kicker">{{ event.season }}</p>
                <h3>{{ event.name }}</h3>
              </div>
              <img [src]="event.image" alt="" loading="lazy" [attr.width]="event.width" [attr.height]="event.height">
            </article>
          }
        </div>
        <h3 class="about-formats-title" data-reveal>Les formats jouables aux Fire &amp; Ice</h3>
        <ul class="about-formats" aria-label="Formats jouables aux Fire and Ice">
          @for (format of formats; track format.name) {
            <li data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <a [class]="'about-format-link about-format-link--' + format.theme" [href]="format.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="'Règles du format ' + format.name + ' (nouvel onglet)'">
                <strong>{{ format.name }}</strong>
              </a>
            </li>
          }
        </ul>
      </section>

      <section id="equipe" class="about-team" aria-labelledby="team-title" tabindex="-1">
        <header class="about-section-heading" data-reveal>
          <p class="kicker">Les visages derrière Gones</p>
          <h2 id="team-title">L’équipe de l’association</h2>
          <p>Organiser un tournoi, c’est accueillir, arbitrer le temps, nourrir, raconter et faire vivre la communauté. Voici celles et ceux qui rendent ces rendez-vous possibles.</p>
        </header>
        <div class="about-team-grid">
          @for (group of memberGroups; track group.id) {
            <section class="about-team-group" [attr.aria-labelledby]="group.id">
              <h3 [id]="group.id" data-reveal>{{ group.title }}</h3>
              @for (member of group.members; track member.name) {
                <article class="about-person" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
                  <div class="about-person__portrait" aria-hidden="true">
                    <span>{{ member.initials }}</span>
                    <small>Photo à venir</small>
                  </div>
                  <div class="about-person__copy">
                    <p class="about-person__role">{{ member.role }}</p>
                    <h4>{{ member.name }}</h4>
                    @if (member.detail) { <p class="about-person__detail">{{ member.detail }}</p> }
                    <p class="about-person__bio">Biographie à venir. Cet espace présentera son parcours, son rôle dans l’association et ce qui l’anime dans la communauté Magic.</p>
                  </div>
                </article>
              }
            </section>
          }
        </div>
      </section>

      <section class="about-contributors" aria-labelledby="contributors-title">
        <header class="about-section-heading" data-reveal>
          <p class="kicker">Ils contribuent aussi à l’aventure</p>
          <h2 id="contributors-title">Contributeurs</h2>
          <p>Partenaires, bénévoles et coups de main ponctuels participent eux aussi à la réussite des événements. Les portraits et noms seront ajoutés prochainement.</p>
        </header>
        <div class="about-contributor-grid">
          @for (contributor of contributors; track contributor.name) {
            <article class="about-contributor" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-contributor__portrait" aria-hidden="true">?</div>
              <div><h3>{{ contributor.name }}</h3><p>{{ contributor.description }}</p></div>
            </article>
          }
        </div>
      </section>

      <section class="about-contact" aria-labelledby="contact-title">
        <div data-reveal="left">
          <p class="kicker">La prochaine ronde commence bientôt</p>
          <h2 id="contact-title">Retrouvez-nous à Lyon.</h2>
          <p>Consultez les prochains rendez-vous, venez jouer un jeudi soir ou préparez votre week-end Fire & Ice.</p>
          <div class="info-actions">
            <a mat-flat-button class="home-primary-action" routerLink="/calendar">Trouver le prochain tournoi</a>
          </div>
        </div>
        <address class="about-contact__details">
          <p data-reveal="right"><span>Localisation</span><strong>Lyon, France</strong></p>
          <p data-reveal="right" style="--reveal-delay: 70ms"><span>Contact</span><strong>Adresse e-mail à compléter</strong></p>
          <div class="about-contact__socials" data-reveal="right" style="--reveal-delay: 140ms">
            <span>Réseaux sociaux</span>
            <div class="about-social-links">
              <a class="about-social-link" href="https://discord.gg/znGRG36Kz" target="_blank" rel="noopener noreferrer" aria-label="Serveur Discord MTGones (nouvel onglet)">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.1 7.2a14 14 0 0 1 7.8 0l.8 1.1a8.4 8.4 0 0 1 2.1 6.1 10.6 10.6 0 0 1-3.3 1.7l-.8-1.1a5.7 5.7 0 0 0 1.2-.6 6.8 6.8 0 0 1-7.8 0c.4.3.8.5 1.2.6l-.8 1.1a10.6 10.6 0 0 1-3.3-1.7 8.4 8.4 0 0 1 2.1-6.1l.8-1.1Zm1.5 4.7c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4Zm3.6 0c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4Z"/></svg>
                <b>Discord</b>
              </a>
              <a class="about-social-link" href="https://www.facebook.com/mtgones/" target="_blank" rel="noopener noreferrer" aria-label="MTGones sur Facebook (nouvel onglet)">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.7 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V4a22 22 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.2V10H8v3h2.6v8h3.1Z"/></svg>
                <b>Facebook</b>
              </a>
              <a class="about-social-link" href="https://x.com/MtgOnes" target="_blank" rel="noopener noreferrer" aria-label="MTGones sur X (nouvel onglet)">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.3 3h3.4l-7.4 8.5L23 21h-6.8l-5.3-6.9L4.8 21H1.4l7.9-9.1L1 3h7l4.8 6.3L18.3 3Zm-1.2 16.3H19L6.9 4.6h-2l12.2 14.7Z"/></svg>
                <b>X</b>
              </a>
            </div>
          </div>
        </address>
      </section>
    </div>
    <gones-back-button [link]="['/']" label="Retour au menu" position="bottom" />
  `
})
export class AboutComponent implements AfterViewInit, OnDestroy {
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private revealObserver?: IntersectionObserver;

  readonly featuredEvents = [
    {
      name: 'Fire',
      theme: 'fire',
      season: 'Édition d’été',
      image: 'assets/fire-about.webp',
      width: 1000,
      height: 1324
    },
    {
      name: 'Ice',
      theme: 'ice',
      season: 'Édition d’hiver',
      image: 'assets/ice-about.webp',
      width: 1000,
      height: 1168
    }
  ] as const;

  readonly formats = [
    { name: 'Legacy', theme: 'legacy', url: 'https://magic.wizards.com/en/formats/legacy' },
    { name: 'Pauper', theme: 'pauper', url: 'https://magic.wizards.com/en/formats/pauper' },
    { name: 'Premodern', theme: 'premodern', url: 'https://premodernmagic.com/' },
    { name: 'Vintage', theme: 'vintage', url: 'https://magic.wizards.com/en/formats/vintage' },
    { name: 'Duel Commander', theme: 'duel-commander', url: 'https://www.mtgdc.info/' }
  ] as const;

  readonly memberGroups = [
    {
      id: 'founders-title',
      title: 'Fondateurs',
      members: [
        { name: 'Gregory Millon', initials: 'GM', role: 'Fondateur', detail: '' },
        { name: 'Ganesh', initials: 'GA', role: 'Fondateur', detail: 'Antoine — nom à compléter' },
        { name: 'Edouart', initials: 'ED', role: 'Fondateur', detail: 'Nom à compléter' }
      ]
    },
    {
      id: 'members-title',
      title: 'Membres',
      members: [
        { name: 'Alexandre Noir', initials: 'AN', role: 'Organisateur de tournois', detail: '' },
        { name: 'Chowchow', initials: 'CH', role: 'Cuisinier', detail: '' },
        { name: 'Lukas', initials: 'LU', role: 'Community Manager', detail: 'Nom à compléter' },
        { name: 'Nathan Flachaire', initials: 'NF', role: 'Créateur de contenu média', detail: '' },
        { name: 'Yoan', initials: 'YO', role: 'Organisateur de tournois', detail: 'Nom à compléter' },
        { name: 'Simon', initials: 'SI', role: 'Organisateur de tournois', detail: 'Nom à compléter' }
      ]
    }
  ] as const;

  readonly contributors = [
    { name: 'Contributeur·rice à venir 01', description: 'Nom, portrait et contribution à compléter.' },
    { name: 'Contributeur·rice à venir 02', description: 'Nom, portrait et contribution à compléter.' },
    { name: 'Contributeur·rice à venir 03', description: 'Nom, portrait et contribution à compléter.' }
  ] as const;

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
