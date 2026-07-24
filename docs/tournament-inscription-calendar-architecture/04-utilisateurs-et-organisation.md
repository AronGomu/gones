# Utilisateurs & Organisations

> Document 04

Version : V1

---

# Rôles

- Visitor
- User
- Organizer
- Admin

---

# Hiérarchie

```text
Visitor

↓

User

↓

Organizer

↓

Admin
```

---

# Visitor

Peut

- consulter le calendrier
- consulter les tournois
- consulter les structures
- consulter les participants

Ne peut pas

- s'inscrire
- créer un tournoi

---

# User

Peut

- gérer son profil
- modifier son email
- modifier ses préférences
- s'inscrire à un tournoi
- se désinscrire
- recevoir les emails

Conditions

- email validé

---

# Organizer

Peut

- créer un tournoi
- modifier ses tournois
- supprimer ses tournois
- annuler ses tournois
- gérer les participants
- inscrire un participant
- retirer un participant
- exporter les participants
- bloquer un utilisateur

Limites

- uniquement sur ses structures

---

# Admin

Peut

- tout faire

En plus

- créer une structure
- supprimer une structure
- promouvoir Organizer
- retirer Organizer
- consulter les audits
- restaurer un tournoi

---

# User

Obligatoire

- Email
- Username
- FirstName
- LastName

Optionnel

- Age
- Location

---

# Préférences

Email public

Oui / Non

Nom public

Oui / Non

Prénom public

Oui / Non

Localisation publique

Oui / Non

Âge public

Oui / Non

---

# Email

Unique

Modifiable

Validation obligatoire avant première inscription.

---

# Username

Unique

Toujours public.

---

# Structure

Représente

- association
- boutique
- club
- organisation

---

# Structure

Possède

- plusieurs organisateurs
- plusieurs tournois

---

# OrganizationMember

Relation

```text
Organization

↓

OrganizationMember

↓

User
```

---

# Rôles internes

- Owner

- Organizer

---

# Attribution Organizer

Uniquement

Admin.

Jamais automatique.

---

# Création Structure

Uniquement

Admin.

---

# Suppression Structure

Uniquement

Admin.

Soft Delete.

---

# Blocage utilisateur

Portée

Structure.

Pas tournoi.

---

# Blocage

Empêche

- inscription

N'empêche pas

- consultation

---

# Informations publiques

Toujours

- Username

Selon préférences

- Email
- Nom
- Prénom
- Localisation
- Âge

---

# Informations visibles par Organizer

Toujours

- Username
- Email
- Nom
- Prénom

Condition

Utilisateur inscrit.

---

# Modification Profil

Autorisée

- Username
- Email
- Nom
- Prénom
- Préférences

---

# Historique

Journaliser

- changement email
- changement username
- changement rôle

---

# Suppression User

V1

Non prévue.

Future

Soft Delete.

---

# Cas interdits

Organizer

↓

Modifier une autre structure.

---

Organizer

↓

Créer une structure.

---

User

↓

Devenir Organizer.

---

Visitor

↓

Créer un tournoi.

---

# Permissions

| Action             | Visitor | User | Organizer | Admin |
| ------------------ | :-----: | :--: | :-------: | :---: |
| Consulter tournois |   ✅    |  ✅  |    ✅     |  ✅   |
| Modifier profil    |   ❌    |  ✅  |    ✅     |  ✅   |
| S'inscrire         |   ❌    |  ✅  |    ✅     |  ✅   |
| Créer tournoi      |   ❌    |  ❌  |    ✅     |  ✅   |
| Modifier tournoi   |   ❌    |  ❌  |    ✅     |  ✅   |
| Gérer participants |   ❌    |  ❌  |    ✅     |  ✅   |
| Export CSV         |   ❌    |  ❌  |    ✅     |  ✅   |
| Gérer structures   |   ❌    |  ❌  |    ❌     |  ✅   |
| Gérer rôles        |   ❌    |  ❌  |    ❌     |  ✅   |

---

# Évolutions futures

- Moderator
- Staff
- Judge
- Arbitrage
- Invitations Organizer
- Organisation multi-propriétaires
- Organisations publiques vérifiées
- Badges utilisateur
- Profils publics avancés
- Statistiques utilisateur
