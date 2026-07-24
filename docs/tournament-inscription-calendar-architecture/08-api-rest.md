# API REST

> Document 08

Version : V1

---

# Principes

- REST
- JSON
- JWT
- OpenAPI
- Swagger

---

# Base URL

```text
/api
```

---

# Authentification

Lecture

- publique

Écriture

- JWT

Administration

- JWT + Admin

---

# Format

Request

```json
{}
```

Response

```json
{}
```

---

# Codes HTTP

200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

500 Internal Server Error

---

# Auth

## POST

```text
/auth/register
```

Créer un compte.

---

## POST

```text
/auth/login
```

Connexion.

---

## POST

```text
/auth/logout
```

Déconnexion.

---

## POST

```text
/auth/verify-email
```

Validation email.

---

## POST

```text
/auth/resend-email
```

Renvoi email validation.

---

## GET

```text
/users/me
```

Profil.

---

## PATCH

```text
/users/me
```

Modifier profil.

---

# Organizations

## GET

```text
/organizations
```

Liste.

---

## GET

```text
/organizations/{id}
```

Détail.

---

## POST

```text
/admin/organizations
```

Créer.

---

## PUT

```text
/admin/organizations/{id}
```

Modifier.

---

## DELETE

```text
/admin/organizations/{id}
```

Supprimer.

---

# Users

## GET

```text
/admin/users
```

Liste.

---

## PATCH

```text
/admin/users/{id}/role
```

Changer rôle.

---

## POST

```text
/admin/users/{id}/organizer
```

Ajouter Organizer.

---

## DELETE

```text
/admin/users/{id}/organizer
```

Retirer Organizer.

---

# Tournaments

## GET

```text
/tournaments
```

Liste.

---

Filtres

- from
- to
- city
- country
- organization
- format
- status
- search

---

## GET

```text
/tournaments/{id}
```

Détail.

---

## POST

```text
/tournaments
```

Créer.

---

## PUT

```text
/tournaments/{id}
```

Modifier.

---

## PATCH

```text
/tournaments/{id}/cancel
```

Annuler.

---

## DELETE

```text
/tournaments/{id}
```

Supprimer.

---

## PATCH

```text
/admin/tournaments/{id}/restore
```

Restaurer.

---

# Registrations

## POST

```text
/tournaments/{id}/registrations
```

Inscription.

---

## DELETE

```text
/tournaments/{id}/registrations/me
```

Désinscription.

---

## GET

```text
/tournaments/{id}/participants
```

Participants.

---

## POST

```text
/tournaments/{id}/registrations/by-organizer
```

Inscription Organizer.

---

## DELETE

```text
/tournaments/{id}/registrations/{registrationId}
```

Retrait Organizer.

---

## GET

```text
/tournaments/{id}/registrations/export
```

Export CSV.

---

# Blocked Users

## GET

```text
/organizations/{id}/blocked-users
```

Liste.

---

## POST

```text
/organizations/{id}/blocked-users
```

Bloquer.

---

## DELETE

```text
/organizations/{id}/blocked-users/{userId}
```

Débloquer.

---

# Pagination

Paramètres

```text
?page=1

&pageSize=20
```

---

Réponse

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "totalItems": 0,
  "totalPages": 0
}
```

---

# Recherche

```text
search=
```

Recherche

- titre
- ville
- organisation

---

# Validation

Backend uniquement.

---

# DTO

Toujours

- Request DTO
- Response DTO

Jamais

Entités EF directement.

---

# Erreurs

Format

```json
{
  "code": "",
  "message": ""
}
```

---

# Audit

Journaliser

- POST
- PUT
- PATCH
- DELETE

---

# Swagger

Development

- activé

Production

- protégé

---

# Permissions

| Endpoint | Public | User | Organizer | Admin |
|----------|:------:|:----:|:---------:|:-----:|
| GET Tournois | ✅ | ✅ | ✅ | ✅ |
| GET Participants | ✅ | ✅ | ✅ | ✅ |
| POST Inscription | ❌ | ✅ | ✅ | ✅ |
| POST Tournoi | ❌ | ❌ | ✅ | ✅ |
| PUT Tournoi | ❌ | ❌ | ✅ | ✅ |
| DELETE Tournoi | ❌ | ❌ | ✅ | ✅ |
| Export CSV | ❌ | ❌ | ✅ | ✅ |
| Gestion rôles | ❌ | ❌ | ❌ | ✅ |

---

# Règles

- Une route = une responsabilité.
- Toujours retourner des DTO.
- Toujours valider les entrées.
- Jamais d'accès direct aux entités EF.
- Toujours utiliser les permissions backend.
- Pagination obligatoire pour les listes.
- Filtres combinables.
- API documentée via Swagger.

---

# Évolutions futures

- API v1/v2
- Refresh Token
- Rate Limiting
- ETags
- Compression
- Cache HTTP
- Webhooks
- API publique tierce
- GraphQL (non prévu actuellement)
- SignalR
