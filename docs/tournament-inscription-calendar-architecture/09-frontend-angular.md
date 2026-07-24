# Frontend Angular

> Document 09

Version : V1

---

# Technologie

- Angular
- TypeScript
- Angular Router
- Angular HttpClient

---

# Communication

Backend uniquement.

Jamais

```text
Angular

↓

PostgreSQL
```

Toujours

```text
Angular

↓

REST API

↓

ASP.NET Core
```

---

# Pages

## Publiques

- Accueil
- Calendrier
- Liste des tournois
- Détail tournoi
- Structures
- Connexion
- Inscription

---

## Utilisateur

- Mon profil
- Mes inscriptions

---

## Organizer

- Mes structures
- Mes tournois
- Nouveau tournoi
- Modifier tournoi
- Participants

---

## Admin

- Dashboard
- Utilisateurs
- Structures
- Audit

---

# Navigation

```text
Accueil

├── Calendrier

├── Tournois

├── Structures

├── Connexion

└── Profil
```

---

# Vue calendrier

Par défaut.

Navigation

- mois précédent
- mois suivant

---

Affichage

- Published
- Cancelled
- Completed

---

# Vue liste

Tri

- chronologique

Pagination

- backend

---

# Recherche

Recherche texte

Filtres

- Date
- Ville
- Pays
- Organisation
- Format
- Statut

---

# Détail tournoi

Afficher

- Titre
- Statut
- Organisation
- Date
- Horaires
- Adresse
- Formats
- Description
- Participants
- Lien d'inscription

V2

- Carte

---

# Participants

Toujours

- Username

+

Informations publiques.

---

# Profil

Modifier

- Email
- Username
- Nom
- Prénom
- Préférences

---

# Email non validé

Afficher

Bandeau permanent

↓

Valider maintenant

↓

Renvoyer email

---

# Connexion

Support

- Local
- Google
- Facebook

---

# OAuth

Premier login

↓

Compléter profil

↓

Application

---

# Création tournoi

Workflow

```text
Formulaire

↓

Validation

↓

Prévisualisation

↓

Publication
```

---

# Formulaire tournoi

Obligatoire

- titre
- adresse
- date
- organisation
- format

---

Optionnel

- description
- date fin
- capacité

---

# Prévisualisation

Même rendu

↓

Page tournoi.

---

# Mes tournois

Actions

- Modifier
- Annuler
- Supprimer
- Voir participants
- Export CSV

---

# Participants Organizer

Afficher

- Username
- Nom
- Prénom
- Email
- Date inscription

---

Actions

- Inscrire
- Retirer
- Bloquer

---

# Dashboard Admin

Pages

- Utilisateurs
- Structures
- Audit

---

# Guards

Visitor

↓

Public

---

User

↓

Profil

---

Organizer

↓

Gestion tournoi

---

Admin

↓

Administration

---

# Services Angular

Prévoir

- AuthService
- UserService
- TournamentService
- RegistrationService
- OrganizationService
- AdminService

---

# Interceptor

JWT

↓

Authorization Header

---

# Gestion erreurs

Afficher

- 400
- 401
- 403
- 404
- 500

---

# États UI

Chargement

Erreur

Vide

Succès

---

# Confirmation

Toujours

- suppression
- annulation
- changement date
- changement adresse

---

# Responsive

Support

- Desktop
- Mobile

---

# Persistance locale

Conserver

- vue calendrier/liste
- filtres
- thème (future)

---

# Permissions UI

| Fonction | Visitor | User | Organizer | Admin |
|----------|:------:|:----:|:---------:|:-----:|
| Voir calendrier | ✅ | ✅ | ✅ | ✅ |
| Voir tournoi | ✅ | ✅ | ✅ | ✅ |
| Modifier profil | ❌ | ✅ | ✅ | ✅ |
| S'inscrire | ❌ | ✅ | ✅ | ✅ |
| Créer tournoi | ❌ | ❌ | ✅ | ✅ |
| Dashboard Admin | ❌ | ❌ | ❌ | ✅ |

---

# Règles

- Toute validation est refaite par le backend.
- Aucun état métier n'est calculé uniquement côté Angular.
- Tous les appels passent par des services.
- Aucun accès direct à PostgreSQL.
- Une page = une responsabilité.

---

# Évolutions futures

- SignalR
- Carte Leaflet
- Mode sombre
- PWA
- Application mobile
- Drag & Drop calendrier
- Internationalisation
- Tableau de bord statistiques
- Upload d'images
- Offline mode
```
