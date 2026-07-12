import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
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
          <h1 #aboutTitle id="about-title" tabindex="-1" data-reveal style="--reveal-delay: 70ms">Le Legacy se joue à Lyon.</h1>
          <p class="about-hero__lede" data-reveal style="--reveal-delay: 140ms">Gones réunit les passionnés de Magic autour de tournois exigeants, accueillants et mémorables — du rendez-vous du jeudi aux grands week-ends Fire & Ice.</p>
          <div class="info-actions" data-reveal style="--reveal-delay: 210ms">
            <a mat-flat-button class="home-primary-action" routerLink="/calendar">Voir les prochains tournois</a>
            <a mat-stroked-button class="secondary-action" href="#equipe">Rencontrer l’équipe</a>
          </div>
        </div>
        <div class="about-hero__mark" aria-hidden="true" data-reveal="scale" style="--reveal-delay: 210ms">
          <img src="assets/gones_logo.png" alt="">
          <span>Depuis Lyon</span>
        </div>
      </section>

      <section class="about-intro" aria-labelledby="association-title">
        <div data-reveal="left">
          <p class="kicker">Notre association</p>
          <h2 id="association-title">Faire vivre une communauté de joueurs, toute l’année.</h2>
        </div>
        <div class="about-intro__copy" data-reveal="right" style="--reveal-delay: 70ms">
          <p>Gones est une association française basée à Lyon. Elle organise des tournois de Magic: The Gathering avec une spécialité : le Legacy, un format historique où la maîtrise, la préparation et les choix de deck comptent à chaque ronde.</p>
          <p>Notre ambition est simple : proposer des événements bien organisés, préserver une scène locale active et créer des rendez-vous où compétiteurs, habitués et nouveaux venus ont plaisir à se retrouver.</p>
        </div>
      </section>

      <dl class="about-numbers" aria-label="Gones en quelques chiffres">
        <div data-reveal><dt>Chaque jeudi</dt><dd>Un tournoi Legacy à Lyon</dd></div>
        <div data-reveal style="--reveal-delay: 70ms"><dt>≈ 200</dt><dd>Joueurs sur un week-end Fire & Ice</dd></div>
        <div data-reveal style="--reveal-delay: 140ms"><dt>5 formats</dt><dd>Legacy, Pauper, Premodern, Vintage et Duel Commander</dd></div>
      </dl>

      <section class="about-weekly" aria-labelledby="weekly-title">
        <div class="about-weekly__date" aria-hidden="true" data-reveal="scale"><span>Chaque</span><strong>Jeudi</strong></div>
        <div data-reveal style="--reveal-delay: 70ms">
          <p class="kicker">Le rendez-vous hebdomadaire</p>
          <h2 id="weekly-title">Legacy tous les jeudis soir.</h2>
          <p>Chaque semaine, la communauté lyonnaise se retrouve pour jouer, tester et progresser dans une ambiance conviviale. Consultez le calendrier pour connaître la date, l’horaire et le lieu du prochain tournoi.</p>
        </div>
        <a mat-stroked-button class="secondary-action" routerLink="/calendar" data-reveal style="--reveal-delay: 140ms">Ouvrir le calendrier</a>
      </section>

      <section class="about-events" aria-labelledby="events-title">
        <header class="about-section-heading" data-reveal>
          <p class="kicker">Deux saisons, un grand rendez-vous</p>
          <h2 id="events-title">Fire & Ice</h2>
          <p>Deux tournois multi-jours de taille intermédiaire rassemblent environ 200 joueurs le temps d’un week-end, en été comme en hiver.</p>
        </header>
        <div class="about-event-grid">
          @for (event of featuredEvents; track event.name) {
            <article [class]="'about-event about-event--' + event.theme" data-reveal="scale" [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-event__copy">
                <p class="kicker">{{ event.season }}</p>
                <h3>{{ event.name }}</h3>
                <p>{{ event.description }}</p>
              </div>
              <img [src]="event.image" alt="" loading="lazy" [attr.width]="event.width" [attr.height]="event.height">
            </article>
          }
        </div>
        <ul class="about-formats" aria-label="Formats joués pendant Fire and Ice">
          <li data-reveal><strong>Legacy</strong><span>Format principal</span></li>
          <li data-reveal style="--reveal-delay: 70ms"><strong>Pauper</strong><span>Cartes communes</span></li>
          <li data-reveal style="--reveal-delay: 140ms"><strong>Premodern</strong><span>Magic d’une autre époque</span></li>
          <li data-reveal style="--reveal-delay: 210ms"><strong>Vintage</strong><span>La puissance sans compromis</span></li>
          <li data-reveal style="--reveal-delay: 280ms"><strong>Duel Commander</strong><span>Commander en face-à-face</span></li>
        </ul>
      </section>

      <section id="equipe" class="about-team" aria-labelledby="team-title" tabindex="-1">
        <header class="about-section-heading" data-reveal>
          <p class="kicker">Les visages derrière Gones</p>
          <h2 id="team-title">L’équipe de l’association</h2>
          <p>Organiser un tournoi, c’est accueillir, arbitrer le temps, nourrir, raconter et faire vivre la communauté. Voici celles et ceux qui rendent ces rendez-vous possibles.</p>
        </header>
        <div class="about-team-grid">
          @for (member of members; track member.name) {
            <article class="about-person" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-person__portrait" aria-hidden="true">
                <span>{{ member.initials }}</span>
                <small>Photo à venir</small>
              </div>
              <div class="about-person__copy">
                <p class="about-person__role">{{ member.role }}</p>
                <h3>{{ member.name }}</h3>
                @if (member.detail) { <p class="about-person__detail">{{ member.detail }}</p> }
                <p class="about-person__bio">Biographie à venir. Cet espace présentera son parcours, son rôle dans l’association et ce qui l’anime dans la communauté Magic.</p>
              </div>
            </article>
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
            <a mat-stroked-button class="secondary-action" routerLink="/">Retour au menu</a>
          </div>
        </div>
        <address class="about-contact__details">
          <p data-reveal="right"><span>Localisation</span><strong>Lyon, France</strong></p>
          <p data-reveal="right" style="--reveal-delay: 70ms"><span>Contact</span><strong>Adresse e-mail à compléter</strong></p>
          <p data-reveal="right" style="--reveal-delay: 140ms"><span>Réseaux sociaux</span><strong>Liens à compléter</strong></p>
        </address>
      </section>
    </div>
    <gones-back-button [link]="['/']" label="Retour au menu" position="bottom" />
  `
})
export class AboutComponent implements AfterViewInit, OnDestroy {
  @ViewChild('aboutTitle') private aboutTitle?: ElementRef<HTMLHeadingElement>;

  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private revealObserver?: IntersectionObserver;

  readonly featuredEvents = [
    {
      name: 'Fire',
      theme: 'fire',
      season: 'Édition d’été',
      description: 'Un week-end de compétition au cœur de l’été, construit autour du Legacy et complété par plusieurs formats emblématiques.',
      image: 'assets/fire-about.webp',
      width: 1000,
      height: 1324
    },
    {
      name: 'Ice',
      theme: 'ice',
      season: 'Édition d’hiver',
      description: 'Le pendant hivernal de Fire : plusieurs jours de Magic, des joueurs venus se mesurer et une programmation multi-format.',
      image: 'assets/ice-about.webp',
      width: 1000,
      height: 1168
    }
  ] as const;

  readonly members = [
    { name: 'Gregory Millon', initials: 'GM', role: 'Fondateur', detail: '' },
    { name: 'Ganesh', initials: 'GA', role: 'Fondateur', detail: 'Antoine — nom à compléter' },
    { name: 'Alexandre Noir', initials: 'AN', role: 'Organisateur de tournois', detail: '' },
    { name: 'Lucas', initials: 'LU', role: 'Community Manager', detail: 'Nom à compléter' },
    { name: 'Chowchow', initials: 'CH', role: 'Cuisinier', detail: '' },
    { name: 'Nathan Flachaire', initials: 'NF', role: 'Créateur de contenu média', detail: '' },
    { name: 'Yoan', initials: 'YO', role: 'Organisateur de tournois', detail: 'Nom à compléter' },
    { name: 'Simon', initials: 'SI', role: 'Organisateur de tournois', detail: 'Nom à compléter' }
  ] as const;

  readonly contributors = [
    { name: 'Contributeur·rice à venir 01', description: 'Nom, portrait et contribution à compléter.' },
    { name: 'Contributeur·rice à venir 02', description: 'Nom, portrait et contribution à compléter.' },
    { name: 'Contributeur·rice à venir 03', description: 'Nom, portrait et contribution à compléter.' }
  ] as const;

  ngAfterViewInit(): void {
    this.aboutTitle?.nativeElement.focus();

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
