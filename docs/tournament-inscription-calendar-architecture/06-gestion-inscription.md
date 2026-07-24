# Gestion des inscriptions

> Document 06

Version : V1

---

# Principe

Les inscriptions sont gérées par MTG Winds.

Aucun lien externe.

---

# Conditions

Autorisé

- ✅ User
- ✅ Organizer
- ✅ Admin

Interdit

- ❌ Visitor

---

# Conditions obligatoires

- compte créé
- email validé
- tournoi Published
- tournoi non complet
- utilisateur non bloqué

---

# Workflow

```text
Connexion

↓

Validation email

↓

Inscription

↓

Confirmation

↓

Rappels automatiques
```

---

# Création

Créer

TournamentRegistration

Status

```text
Registered
```

---

# Vérifications

- email validé
- tournoi existant
- tournoi Published
- tournoi non supprimé
- tournoi non commencé
- places disponibles
- utilisateur non inscrit
- utilisateur non bloqué

---

# Refus

HTTP 400

- tournoi complet
- déjà inscrit
- email non validé

HTTP 403

- utilisateur bloqué

HTTP 404

- tournoi inexistant

---

# Désinscription

Autorisée

↓

Avant StartsAt

---

Après StartsAt

↓

❌ Interdite

---

# Effets

- place libérée
- rappels arrêtés
- historique conservé

---

# Confirmation

Email

↓

Confirmation de désinscription

---

# Inscription Organizer

Autorisée.

Conditions

- tournoi appartenant à sa structure

---

# Retrait Organizer

Autorisé

↓

Avant StartsAt

---

Après StartsAt

↓

❌

---

# Blocage

Portée

↓

Structure

---

Empêche

- inscription

N'empêche pas

- consultation

---

# Capacité

Valeur

```text
RegistrationLimit
```

Null

↓

Illimitée

---

# Tournoi complet

Nouvelle inscription

↓

Refusée

---

# Liste d'attente

V1

❌

---

Future

✅

---

# Participants

Visibles publiquement

- Username

*

Informations publiques choisies.

---

# Organizer

Voit

- Username
- Nom
- Prénom
- Email

---

# Export

Format

CSV

---

Contenu

- Username
- Nom
- Prénom
- Email
- Date inscription

---

Autorisé

- Organizer
- Admin

---

# Email public

Aucun impact sur l'export.

Organizer voit toujours l'email.

---

# Notifications Organizer

Options

- NotifyOnRegistration
- NotifyOnUnregistration

---

# Confirmation inscription

Toujours envoyée.

---

# Historique

Conserver

- inscription
- désinscription
- retrait
- inscription organizer

---

# Status Registration

- Registered
- CancelledByUser
- RemovedByOrganizer

---

# Contrainte

Un utilisateur

↓

Un tournoi

↓

Une inscription active maximum

---

# Audit

Journaliser

- inscription
- désinscription
- retrait
- export CSV
- blocage
- déblocage

---

# Suppression tournoi

Effets

- clôture inscriptions
- arrêt rappels
- email annulation
- historique conservé

---

# Annulation tournoi

Effets

- inscriptions conservées
- email envoyé
- rappels arrêtés

---

# Permissions

| Action              | User | Organizer | Admin |
| ------------------- | :--: | :-------: | :---: |
| S'inscrire          |  ✅  |    ✅     |  ✅   |
| Désinscription      |  ✅  |    ✅     |  ✅   |
| Voir participants   |  ✅  |    ✅     |  ✅   |
| Inscrire quelqu'un  |  ❌  |    ✅     |  ✅   |
| Retirer quelqu'un   |  ❌  |    ✅     |  ✅   |
| Export CSV          |  ❌  |    ✅     |  ✅   |
| Bloquer utilisateur |  ❌  |    ✅     |  ✅   |

---

# Règles métier

- Une inscription nécessite un email validé.
- Une inscription crée automatiquement les rappels.
- Les rappels passés ne sont jamais renvoyés.
- Une désinscription arrête tous les rappels futurs.
- Après le début du tournoi, les inscriptions sont figées.
- L'organisateur ne peut gérer que les inscriptions de ses structures.
- Un utilisateur bloqué ne peut pas s'inscrire mais peut consulter le tournoi.
- L'email est toujours visible par les organisateurs, indépendamment des préférences publiques.

---

# Évolutions futures

- Liste d'attente
- Paiement en ligne
- QR Code d'enregistrement
- Check-in
- Validation de présence
- Import massif
- Export XLSX
- Statistiques de participation
- Historique des participations
- Badges de participation
- Confirmation automatique de présence
- API publique d'inscription
