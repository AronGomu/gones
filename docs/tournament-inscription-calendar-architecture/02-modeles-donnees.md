# Modèle de données

> Document 02

Version : V1

---

# Principes

- PostgreSQL
- Entity Framework Core
- UUID pour toutes les clés primaires
- Soft Delete
- Audit
- UTC en base

---

# Entités

- User
- ExternalIdentity
- Organization
- OrganizationMember
- Tournament
- TournamentFormat
- Format
- TournamentRegistration
- NotificationHistory
- AuditLog
- UserEmailHistory
- OrganizationBlockedUser

---

# User

## Champs

- Id
- Email
- Username
- FirstName
- LastName
- Age (optionnel)
- Location (optionnel)

- EmailVerified

- CreatedAt
- UpdatedAt

---

## Contraintes

Email

- obligatoire
- unique
- modifiable

Username

- obligatoire
- unique
- public

Nom

- obligatoire

Prénom

- obligatoire

---

## Préférences

- ShowEmailPublicly
- ShowFirstNamePublicly
- ShowLastNamePublicly
- ShowLocationPublicly
- ShowAgePublicly

---

# ExternalIdentity

OAuth.

## Champs

- Id
- UserId
- Provider
- ProviderUserId
- ProviderEmail

---

Providers

- Local
- Google
- Facebook

---

# Organization

## Champs

- Id
- Name
- Description
- Website
- Email
- CreatedAt

---

Contraintes

Name

- obligatoire
- unique

---

# OrganizationMember

Association User ↔ Organization.

## Champs

- OrganizationId
- UserId
- Role

---

Roles

- Organizer
- Owner

---

# Tournament

## Champs

- Id

- OrganizationId

- Title

- Description

- AddressLine1
- AddressLine2
- PostalCode
- City
- Country

- StartsAtUtc
- EndsAtUtc

- TimeZoneId

- RegistrationLimit

- RegistrationUrl

- Status

- DeletedAt

- CreatedByUserId

- CreatedAt

- UpdatedAt

---

# Contraintes

Title

- obligatoire
- min 10 caractères

Description

- optionnelle
- max 50 caractères

StartsAt

- obligatoire

EndsAt

- optionnelle

---

# Status

- Published
- InProgress
- Completed
- Cancelled

---

Suppression

Soft Delete uniquement.

---

# TournamentFormat

Relation N ↔ N.

## Champs

- TournamentId
- FormatId

---

# Format

## Champs

- Id
- Name
- Slug

---

V1

Legacy uniquement.

Architecture compatible :

- Vintage
- Pauper
- Modern
- Premodern

---

# TournamentRegistration

## Champs

- Id

- TournamentId

- UserId

- Status

- RegisteredAt

- RegisteredByUserId

- UnregisteredAt

- UnregisteredByUserId

---

Status

- Registered
- CancelledByUser
- RemovedByOrganizer

---

Contraintes

Un utilisateur

↓

Un tournoi

↓

Une inscription active maximum.

---

# NotificationHistory

## Champs

- Id
- TournamentId
- UserId
- NotificationType
- SentAt

---

Objectifs

- historique
- anti doublon

---

# UserEmailHistory

## Champs

- Id
- UserId
- PreviousEmail
- NewEmail
- ChangedAt

---

# OrganizationBlockedUser

## Champs

- OrganizationId
- UserId
- Reason
- BlockedAt
- BlockedByUserId
- ExpiresAt

---

# AuditLog

## Champs

- Id

- ActorUserId

- Entity

- EntityId

- Action

- PreviousValue

- NewValue

- CreatedAt

---

# Relations

```text
User

│

├──── ExternalIdentity

│

├──── OrganizationMember

│

└──── TournamentRegistration



Organization

│

├──── OrganizationMember

│

└──── Tournament



Tournament

│

├──── TournamentRegistration

│

├──── TournamentFormat

│

└──── NotificationHistory



Format

│

└──── TournamentFormat
```

---

# Index

User

- Email
- Username

Organization

- Name

Tournament

- StartsAt
- Status
- City
- OrganizationId

Registration

- TournamentId
- UserId

---

# Soft Delete

Entités concernées

- Tournament

Future

- Organization
- User

---

# Audit

Audit obligatoire

- Tournament
- Organization
- User
- Registration

---

# Cascade Delete

Jamais.

Toujours

- Soft Delete
- ou suppression contrôlée.

---

# Champs UTC

Toujours

- CreatedAt
- UpdatedAt
- DeletedAt
- RegisteredAt
- StartsAtUtc
- EndsAtUtc

---

# Contraintes métier

Email

✓ unique

Username

✓ unique

Organization

✓ nom unique

Tournament

✓ un créateur

✓ une organisation

Registration

✓ un utilisateur

✓ un tournoi

✓ une inscription active maximum

---

# Évolutions futures

Ajouter

- League
- Round
- Match
- Standing
- Decklist
- PlayerStatistics
- Season
- Elo
- TournamentResult
- SocialPost
- NewsletterCampaign

Sans modification des tables existantes.
