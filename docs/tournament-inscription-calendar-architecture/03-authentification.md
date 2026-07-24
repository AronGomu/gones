# Authentification

> Document 03

Version : V1

---

# Méthodes de connexion

Supportées

- ✅ Compte local
- ✅ Google OAuth
- ✅ Facebook OAuth

Non supportées

- ❌ Discord
- ❌ GitHub
- ❌ Microsoft

---

# Compte local

Informations

- Email
- Mot de passe

---

# OAuth

Workflow

```text
OAuth

↓

Compte MTG Winds

↓

Compléter le profil

↓

Application
```

---

# Profil obligatoire après OAuth

À renseigner

- Email
- Pseudo
- Prénom
- Nom

---

# ExternalIdentity

Association

```text
User

1

↓

N

ExternalIdentity
```

---

Providers

- Local
- Google
- Facebook

---

# UserId

Le UserId

- immuable

Ne change jamais.

---

# Email

Obligatoire

Unique

Modifiable

Validation obligatoire avant la première inscription à un tournoi.

---

# Validation Email

Obligatoire

↓

Première inscription

---

Création du compte

↓

Email envoyé

↓

Validation

↓

Autorisation d'inscription

---

Pas de date limite.

---

# Premier email

Toujours

Validation du compte.

---

# Bandeau utilisateur

Si EmailVerified == false

Afficher

```text
Votre adresse email n'est pas validée.

Valider maintenant

Renvoyer l'email
```

---

# Renvoi

Possible

À tout moment.

---

# Modification Email

Autorisée.

Workflow

```text
Modification

↓

EmailVerified = false

↓

Nouvel email

↓

Validation

↓

EmailVerified = true
```

---

Historique

UserEmailHistory

---

# Pseudo

Obligatoire

Unique

Public

Toujours affiché.

---

# Nom

Obligatoire

---

# Prénom

Obligatoire

---

# Localisation

Optionnelle

---

# Âge

Optionnel

---

# Préférences publiques

Email

Oui / Non

Nom

Oui / Non

Prénom

Oui / Non

Localisation

Oui / Non

Âge

Oui / Non

---

# Organisateur

Voit toujours

- Nom
- Prénom
- Email

Même si masqués publiquement.

---

# Visiteur

Voit uniquement

- Pseudo

*

Informations explicitement publiques.

---

# Mot de passe

Compte local uniquement.

Stockage

- Hash

Jamais

- mot de passe en clair

---

# JWT

Authentification

JWT

---

Refresh Token

Prévu

V1

---

# Déconnexion

Locale

↓

Suppression du JWT.

---

OAuth

↓

Déconnexion MTG Winds uniquement.

---

# Rôles

Visitor

↓

User

↓

Organizer

↓

Admin

---

# Attribution

Organizer

↓

Admin uniquement.

---

Admin

↓

Base de données

ou

Endpoint Admin.

---

# Permissions

Visitor

- lecture publique

---

User

- profil
- inscription tournoi
- désinscription

---

Organizer

-

* création tournoi
* modification tournoi
* gestion participants
* export CSV

---

Admin

-

* gestion utilisateurs
* gestion structures
* gestion rôles
* audit

---

# Refus d'accès

Email non validé

↓

Inscription tournoi refusée.

---

Utilisateur bloqué

↓

Inscription refusée.

---

JWT invalide

↓

401

---

Permissions insuffisantes

↓

403

---

# Audit

Journaliser

- Connexion
- Déconnexion
- Création compte
- Validation email
- Modification email
- Modification profil
- Attribution rôle

---

# Futures évolutions

- Double authentification
- OAuth Discord
- OAuth GitHub
- Sessions multiples
- Gestion appareils connectés
- Suppression automatique comptes inactifs
- Recovery Codes
- Passkeys
