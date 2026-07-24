# MTG Winds

> Document 00 — Vision du projet

Version : V1  
Statut : En cours

---

# Objectif

Créer une plateforme web open source centralisant les tournois Legacy.

Objectifs :

- calendrier public
- gestion des tournois
- gestion des organisateurs
- gestion des inscriptions
- API publique
- base du futur backend MTG Winds

---

# Philosophie

- Open Source
- API First
- Backend indépendant du frontend
- REST uniquement
- Monolithe modulaire
- Évolutif
- Documentation complète
- Développement incrémental

---

# Objectifs V1

## Comptes

- ✅ Compte local
- ✅ OAuth Google
- ✅ OAuth Facebook
- ❌ OAuth Discord
- ❌ OAuth GitHub

---

## Utilisateurs

Rôles :

- Visiteur
- Utilisateur
- Organisateur
- Administrateur

---

## Calendrier

- ✅ Vue calendrier
- ✅ Vue liste
- ✅ Vue calendrier par défaut
- ✅ Préférence mémorisée
- ✅ Consultation publique
- ✅ Tournois passés visibles
- ✅ Tournois annulés visibles

---

## Tournois

- ✅ Création
- ✅ Modification
- ✅ Annulation
- ✅ Suppression logique
- ✅ Restauration
- ✅ Prévisualisation
- ✅ Plusieurs formats
- ✅ Plusieurs jours

---

## Structures

Une structure représente :

- association
- boutique
- club
- organisation

Une structure possède :

- plusieurs organisateurs
- plusieurs tournois

---

## Inscriptions

- ✅ Gérées par MTG Winds
- ✅ Plus de lien externe

Fonctionnalités :

- inscription
- désinscription
- inscription manuelle
- export CSV
- blocage utilisateur
- limite de places

---

## Notifications

Emails transactionnels :

- validation email
- confirmation inscription
- annulation
- modification importante

Rappels :

- mensuel (> 1 mois)
- hebdomadaire (dernier mois)
- J-2
- J-1

---

# Hors périmètre V1

- carte interactive
- SignalR
- rondes suisses
- ligues
- classement
- ELO
- application mobile
- réseaux sociaux automatiques
- liste d'attente
- Discord Bot

---

# Choix techniques

Frontend

- Angular

Backend

- ASP.NET Core (.NET 10 LTS)

Base

- PostgreSQL

ORM

- Entity Framework Core

Architecture

- Vertical Slice

API

- REST

Documentation

- OpenAPI / Swagger

Licence

- MIT

---

# Principes

Toujours :

- API avant Front
- validation Backend
- audit
- suppression logique
- documentation

Jamais :

- logique métier dans Angular
- suppression physique immédiate
- confiance dans les validations frontend

---

# Workflow général

```text
Utilisateur
    ↓
Compte
    ↓
Validation email
    ↓
Inscription tournoi
    ↓
Emails automatiques
    ↓
Participation
```

---

# Workflow organisateur

```text
Création
    ↓
Formulaire
    ↓
Prévisualisation
    ↓
Publication
    ↓
Gestion participants
    ↓
Tournoi
```

---

# Roadmap

## V1

- comptes
- calendrier
- tournois
- structures
- inscriptions
- emails
- administration

## V2

- Leaflet/OpenStreetMap
- liste d'attente
- newsletters avancées
- statistiques

## V3

- gestion complète des tournois
- rondes suisses
- ligues
- classement
- SignalR
- application mobile
- API publique complète

---

# Contraintes

- Open Source
- API réutilisable
- Frontend indépendant
- Backend indépendant
- Déploiement Docker
- Documentation complète

---

# Définition du succès

La V1 est terminée lorsque :

- un organisateur peut créer un tournoi
- un utilisateur peut créer un compte
- un utilisateur valide son email
- un utilisateur s'inscrit
- les rappels fonctionnent
- le calendrier est public
- l'API est documentée
- le backend est indépendant du frontend

---

# Documents suivants

01-architecture.md

02-data-model.md

03-authentication.md

04-users.md

05-organizations.md

06-tournaments.md

07-registrations.md

08-notifications.md

09-api.md

10-frontend.md

11-admin.md

12-roadmap.md
