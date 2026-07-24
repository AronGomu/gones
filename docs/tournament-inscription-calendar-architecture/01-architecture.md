# Architecture

> Document 01

Version : V1

---

# Stack

## Frontend

- Angular
- SPA
- TypeScript

---

## Backend

- ASP.NET Core
- .NET 10 LTS
- REST API

---

## Base de données

- PostgreSQL

ORM

- Entity Framework Core

---

## Documentation

- OpenAPI
- Swagger

---

## Déploiement

- Docker
- Docker Compose

---

# Architecture

## Style

- Monolithe
- Modulaire
- Vertical Slice Architecture

---

## Découpage

```text
Frontend Angular
        │
        ▼
REST API
        │
        ▼
Application
        │
        ▼
Domain
        │
        ▼
Infrastructure
        │
        ▼
PostgreSQL
```

---

# Structure

```text
src/

Api

Application

Domain

Infrastructure

SharedKernel

tests/

UnitTests

IntegrationTests
```

---

# Vertical Slice

Organisation par fonctionnalité.

Exemple

```text
Features/

Authentication/

Users/

Organizations/

Tournaments/

Registrations/

Notifications/

Administration/
```

Chaque Feature contient :

- Endpoint
- Command
- Query
- Validator
- Handler
- DTO

---

# Dépendances

```text
Api
↓

Application
↓

Domain

Application
↓

Infrastructure

Infrastructure
↓

PostgreSQL
```

Domain

- aucune dépendance

---

# API

Architecture

```text
Angular

↓

REST

↓

ASP.NET Core

↓

PostgreSQL
```

---

# REST

Format

- JSON

Authentification

- JWT

Documentation

- Swagger

---

# Version

V1

- aucune version

Future

```text
/api/v1

/api/v2
```

---

# Authentification

Support

- Local
- Google OAuth
- Facebook OAuth

---

# Autorisation

Rôles

- Visitor
- User
- Organizer
- Admin

---

# Base de données

Une seule base.

Une seule instance PostgreSQL.

---

# Persistance

ORM

- Entity Framework Core

Migrations

- EF Core Migration

---

# Validation

Frontend

- UX uniquement

Backend

- obligatoire

Aucune donnée du Frontend n'est considérée comme valide.

---

# Logs

À conserver

- erreurs
- connexions
- créations
- modifications
- suppressions
- annulations
- exports
- authentifications

---

# Audit

Toutes les actions critiques.

Jamais supprimé.

---

# Suppression

Toujours logique.

Jamais physique immédiatement.

---

# Emails

Backend uniquement.

Jamais envoyés par Angular.

---

# Scheduler

Unique.

Une tâche planifiée.

Recherche les emails à envoyer.

Envoie.

Historise.

---

# Configuration

Environnements

- Development

- Staging

- Production

---

# Secrets

Jamais dans Git.

Variables d'environnement uniquement.

---

# Docker

V1

- API
- PostgreSQL

Docker Compose.

---

# Sécurité

Validation Backend

JWT

Rate Limiting

HTTPS

CORS

Swagger protégé en Production

---

# API publique

Lecture

- publique

Écriture

- authentifiée

Administration

- Admin uniquement

---

# Principes

Toujours

- DTO
- Validation
- Audit
- Transactions
- Pagination

Jamais

- logique métier dans Controller
- accès direct Angular → Base
- SQL brut dans les Features

---

# Tests

Prévoir

- Unit Tests
- Integration Tests

---

# Monitoring

Prévoir

- Health Checks

Future

- métriques
- monitoring
- alertes

---

# Choix validés

✅ ASP.NET Core

✅ .NET 10 LTS

✅ PostgreSQL

✅ Entity Framework Core

✅ REST

✅ OpenAPI

✅ Swagger

✅ Docker

✅ Vertical Slice

✅ Monolithe

✅ API indépendante

---

# Choix non retenus

❌ GraphQL

❌ Microservices

❌ SignalR (V1)

❌ Kubernetes

❌ MongoDB

❌ SQL Server

❌ gRPC

---

# Évolutions futures

SignalR

Redis

Cache

CDN

Application mobile

API publique versionnée

Réseaux sociaux

OpenStreetMap
