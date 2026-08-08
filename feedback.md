# Feedback Calendar V1 Implementation

## General

1. When logged-in in header menubar : update button to redirect to profile to be <a> appearance link instead.

2. When logged-in in header menubar : Apply red danger appearance to "Se deconnecter" button.

3. Update AGENT.md file for frontend to add rule : every html element must have cy-data acting as unique identifier for element component.

4. Anonymous and logged user have access to live-tournaments and ligue

5. On first visit of application : open about page first.
   Cache in browser so that next visits go to menu / home page afterward.

## (archived) Leagues feature

1. Rename the feature to store (archive) leagues and tournaments within leagues to "leagues-archive" and "tournament-archive".

## Login page

1. Remove "Compte" text (above "Se connecter"). Update design doc : "by default DO NOT add kicker to titles"

2. Add margin between "Se connecter" buttons and "Continuer avec Google" / "Continuer avec Facebook" buttons row.

3. Use Google and Facebook official logos instead of plain text.

4. Add margin between "Continuer avec Google" / "Continuer avec Facebook" buttons row and "Creer un compte" / "Mot de passe oublie" row

5. In Menubar : remove "Se connecter" button.

6. If user login to account (already existing account) : redirect to last non-login visited page (page from where user clicked "Se connecter" button) or home page as fallback.

7. Login is not saved. Update front & back to cache user connexion as cookie. On application startup, auto-connect user if cookie present.

8. Warning message when logged without account verification is not properly centered.

## register page

1. Add confirm password input

2. Fix same margin issues from login page

## Profile page

1. Update "Nom d’utilisateur" input label -> "Pseudo".

2. "Lieu" input should be split into 3 differents input :
   1. Country
   2. Region (French "Departement" size)
   3. City
      Replace text input by select for each of them.
      Use already existing public database for each.

3. "Année de naissance" input should be date input

4. "Enregister" button should be disabled if no change to user information.

5. Rename "Enregister" button to "Modifier Information du Compte"

6. "Enregister" button should use warning color (should be yellow/orange).

7. "Enregister" button should have confirmation dialog to validate update.

8. "Enregister" button action do not register in backend. Information is not saved on application reload.

9. Regroup "Paramètres e-mail" with previous section.

10. In "Comptes liés" : remove password requirement to link account. Remove input and conditions.

11. At the bottom of page : Add "Supprimer Compte" button with confirmation dialog that ask to input valid password to validate action.
    Make sure to add logic for account deletion in backend if not already existing.

12. Merge Settings page into Profile page.

13. Rename Profile page as settings page.

14. Update Settings page can only be accessible when logged in.

## Sessions page

1. Remove feature.

## Registration page

1. When logged, add card link in home / menu page to registration page.

2. Add return to menu top and bottom buttons

3. Remove "Compte" kicker

## Home / Menu page

1. Rewire Settings card redirection to go to merged profile and settings page.

## live tournaments page

1. Update backend to allow user (anonymous, user,...) to start and manage live tournaments.

## Calendar Page view=calendar

1. "calendar-filters" must be 1 row taking whole width.

2. When loading calendar page : request to server all current present to future ALL tournaments.
   Cache results with call timestamp.
   DO NOT send request if request has already been executed in last 24h.

3. remove "appliquer" button from "calendar-filters".

4. Add new button "Synchroniser".
   Located top right of page.
   Manual button to Redo the request to fetch ALL tournaments.
   Replace "appliquer" button but must be removed from form because independant action

5. remove "Tournois publics" kicker

6. "calendar-filters" form now filters on already loaded and cached tournaments result

7. Replace all inputs by 1 single input.
   Add placeholder : 'Recherchez statut, pays, region, ville, nom organiation, format, date'.
   Make it fuzzy find on ALL TOURNAMENT DATA except tournament description.
   Commas (",") are counted as word separator unless preceded with anti-slash "\,". Same for all regular separator.

8. Even if no tournament found -> show calendar (but no events on any dates).

9. For all validated account user type : add button "Creer Tournoi" next to "Synchronizer" button.
   Redirect to tournament event creation page.

## Tournament Event Creation page

1. Must be same page for all user type.

2. Only difference :
   For Admin & Organizer -> instantly create the tournament
   For other validated account user -> On click event submission :
   1. open dialog with checkbox lists of admins & organizers
   2. user check 1 or more
   3. Send mail to all selected
   4. Mail contain all event data inputed in form.
      Add redirection link to dedicated page :
      Page also has event description AND :
   - Validate button -> accept event request and add it to backend database as public event
   - Cancel -> deny request & redirect to new page with textarea to describe cancelation reasons and button "Envoyer Email Raisons Annulation".
