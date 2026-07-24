# Gestion des tournois

> Document 05

Version : V1

---

# Création

Autorisé

- ✅ Organizer
- ✅ Admin

Interdit

- ❌ Visitor
- ❌ User

---

# Workflow

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

# Prévisualisation

Obligatoire.

Le tournoi n'est créé qu'après confirmation.

Actions

- Retour
- Publier

---

# Champs obligatoires

- Titre
- Organisation
- Date début
- Adresse
- Ville
- Pays
- Lien d'inscription
- Format

---

# Champs optionnels

- Description
- Date fin
- Limite de places

---

# Contraintes

Titre

- minimum 10 caractères

Description

- maximum 50 caractères

Date début

- obligatoire

Date fin

- optionnelle
- ≥ Date début

---

# Formats

Architecture

- plusieurs formats

V1

- Legacy uniquement

---

# États

- Published
- InProgress
- Completed
- Cancelled
- Deleted (Soft Delete)

---

# Cycle de vie

```text
Published

↓

InProgress

↓

Completed
```

ou

```text
Published

↓

Cancelled
```

---

# Modification

Avant StartsAt

- ✅ Autorisée

Après StartsAt

- ❌ Interdite

Exception

- ✅ Annulation

---

# Modification importante

Déclenche

- confirmation
- notification email

Concernée

- Date
- Adresse

---

# Modification mineure

Ne déclenche pas d'email

- Titre
- Description

---

# Suppression

Avant StartsAt

- ✅ Oui

Après StartsAt

- ❌ Non

Type

- Soft Delete

---

# Restauration

Possible

↓

Jusqu'à StartsAt initial.

---

# Annulation

Possible

- avant le début
- après le début

Effets

- statut Cancelled
- notification participants
- arrêt des rappels

---

# Début automatique

Condition

```text
Maintenant >= StartsAt
```

↓

Status

```text
InProgress
```

---

# Fin automatique

Condition

```text
Maintenant >= EndsAt
```

↓

Status

```text
Completed
```

Si EndsAt absent

↓

Fin de journée.

---

# Suppression logique

Champs

- DeletedAt
- DeletedByUserId

Le tournoi

- disparaît des vues publiques
- reste en base

---

# Visibilité

Published

- visible

Cancelled

- visible

Completed

- visible

Deleted

- invisible

---

# Consultation

Publique

- calendrier
- liste
- page détail

---

# Calendrier

Vue par défaut

- calendrier

Navigation

- passé
- futur

---

# Vue liste

Tri

- chronologique

Pagination

- obligatoire

---

# Filtres

- Date
- Ville
- Pays
- Organisation
- Format
- Statut
- Recherche texte

---

# Page tournoi

Affiche

- titre
- statut
- organisation
- formats
- adresse
- horaires
- description
- lien inscription
- participants

V2

- carte

---

# Adresse

Toujours publique.

---

# Carte

V1

- ❌

V2

- Leaflet
- OpenStreetMap

---

# Participants

Toujours visibles.

Affichage

- Username

*

Informations publiques choisies.

---

# Organisateur

Voit

- Email
- Nom
- Prénom
- Username

---

# Capacité

Optionnelle.

Null

↓

Illimitée.

---

# Tournoi complet

Inscription refusée.

Liste d'attente

- ❌ V1

---

# Export

Organizer

↓

CSV

---

# Audit

Journaliser

- création
- modification
- annulation
- suppression
- restauration

---

# Permissions

| Action    | User | Organizer | Admin |
| --------- | :--: | :-------: | :---: |
| Consulter |  ✅  |    ✅     |  ✅   |
| Créer     |  ❌  |    ✅     |  ✅   |
| Modifier  |  ❌  |    ✅     |  ✅   |
| Annuler   |  ❌  |    ✅     |  ✅   |
| Supprimer |  ❌  |    ✅     |  ✅   |
| Restaurer |  ❌  |    ❌     |  ✅   |

---

# Règles métier

- Un tournoi appartient à une seule organisation.
- Une organisation possède plusieurs tournois.
- Un tournoi possède plusieurs participants.
- Un tournoi possède plusieurs formats.
- Une suppression est toujours logique.
- Un tournoi supprimé est restaurable jusqu'à sa date initiale.
- Après le début, seule l'annulation est autorisée.

---

# Évolutions futures

- Brouillons
- Duplication de tournoi
- Tournois récurrents
- Images / affiches
- Carte interactive
- Import MTG Melee
- Import Topdeck
- Archivage automatique
- Historique des versions
- Gestion des rondes
- Résultats
- Classements
- Ligues

```

```
