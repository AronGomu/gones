# Notifications

> Document 07

Version : V1

---

# Types

- Validation Email
- Confirmation inscription
- Désinscription
- Annulation tournoi
- Modification tournoi
- Rappels tournoi

Future

- Newsletter
- Réseaux sociaux
- Push Notification

---

# Validation Email

Déclenchement

- Création du compte
- Modification de l'email

Destinataire

- User

Obligatoire

- Oui

---

# Confirmation d'inscription

Déclenchement

- Nouvelle inscription

Destinataire

- Participant

---

# Désinscription

Déclenchement

- Désinscription User
- Retrait Organizer

Destinataire

- Participant

---

# Annulation tournoi

Déclenchement

- Status = Cancelled
- Suppression logique

Destinataires

- Tous les participants

Obligatoire

- Oui

---

# Modification importante

Déclenchement

- Date
- Adresse

Destinataires

- Tous les participants

Confirmation Organizer

- Obligatoire

---

# Modification mineure

Ne déclenche pas d'email

- Titre
- Description

---

# Rappels

Planification

## Plus de 1 mois

- 1 rappel / mois

---

## Dernier mois

- Tous les samedis

---

## Derniers jours

- J-2
- J-1

---

Jour J

- ❌ V1

---

# Nouvel inscrit

Reçoit

- Confirmation

Puis

- Tous les rappels futurs

Ne reçoit jamais

- Les rappels déjà passés

---

# Organisateur

Options

- NotifyOnRegistration
- NotifyOnUnregistration

---

# Préférences utilisateur

V1

Toutes les notifications transactionnelles

↓

Obligatoires

---

Future

Préférences

- Désactiver les rappels
- Conserver uniquement les notifications critiques
- Newsletter indépendante

---

# Scheduler

Unique

Fonctionnement

```text
Tous les jours

↓

Recherche des emails

↓

Envoi

↓

Historisation
```

---

# NotificationHistory

Historiser

- UserId
- TournamentId
- NotificationType
- SentAt

---

# Anti doublon

Une notification

↓

Un envoi maximum

---

# En cas d'échec

Prévoir

- Retry

Future

---

# Ordre d'envoi

Validation compte

↓

Confirmation inscription

↓

Rappels

↓

Modification

↓

Annulation

---

# Modèle d'email

Contient

- Sujet
- Corps HTML
- Corps texte

---

# Templates

Prévoir

- Validation compte
- Confirmation inscription
- Désinscription
- Modification
- Annulation
- Rappel

---

# Expéditeur

Unique

Configuration

↓

Variables d'environnement

---

# Liens

Toujours

- HTTPS

---

# Journalisation

Conserver

- Date
- Destinataire
- Type
- Succès
- Échec

---

# Permissions

| Action                     | User | Organizer | Admin |
| -------------------------- | :--: | :-------: | :---: |
| Recevoir emails            |  ✅  |    ✅     |  ✅   |
| Modifier options Organizer |  ❌  |    ✅     |  ✅   |
| Consulter historique       |  ❌  |    ❌     |  ✅   |

---

# Règles métier

- Toutes les notifications sont envoyées par le backend.
- Angular n'envoie jamais d'email.
- Les rappels sont calculés automatiquement.
- Les rappels cessent après désinscription.
- Les rappels cessent après annulation.
- Les rappels cessent après suppression.
- Une modification de date recalcule les rappels futurs.
- Les rappels déjà passés ne sont jamais renvoyés.
- Une annulation envoie immédiatement un email à tous les participants.

---

# Évolutions futures

- Newsletter
- Campagnes email
- Brevo / Resend
- Notifications Push
- SMS
- Discord
- Webhooks
- Réseaux sociaux automatiques
- Digest hebdomadaire
- Préférences fines utilisateur
