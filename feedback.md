# Feedback

## General

For all those, update AGENTS file to write as general rule

### Synchronized Data

Information on the website update rarely : (once a day on average)

For all features with data from database : Calendar, Registrations, Global Rankigns, Leagues Archive, Live Tournament, Settings, all admin page.

If latest fetch request is over 24h, redo fetch and cache to localstorage.
They have synchronize button with latest data label and handle the data exactly like Calendar Page : 2. All Data is loaded once on page load. 3. It is cached in localStorage exactly like Events on calendar page. 4. Add a synchronize button like for calendar page at the top right. 5. If latest call is over 24 hours, automatically call server to fetch new information.

This avoid useless refetch for quick navigation between tabs.

Note : Same for all individual player stat page.

### Back button

Top and Bottom back button MUST be on every page on the application.

### Logging Out

Should return to sign in Page. If signing in that page, return to previous page where user clicked on logout.

## Test Data

1. Context : I need way more generated data to stress tests website design.
   Proposition : Multiply all current numbers of items every by 100. 100x Leagues, players, matchs played, etc...

## Home page

1. Rename "Leagues (Archive)" => "Leagues Archive"

## About page

1. On first connexion on website, redirect to about page instead of home page on "/" path only. Redirect and cache it only the first time the user try to access the menu.

## Global Rankings Page

1. Rename french translation "Classement Mondial" => "Classement Global".

2. Add margin between "Global Rankings" and Filter Input

3. 1. Filter Input apply search onChange.

4. Add back button to page

## Player Stats Page

1. Context : I dont know what is the best way to load the player data. Tournaments will be rarely added making (a few per week) and all the data should be inserted at once. So its largely possible to calculate once the stats of a player and store it in a table. That could help the global rankings page, basically it should match minus the match history.
   Question : Assuming hundreds of user : What is the more cost efficient way to store and load the data ?
   1. Calculation on the fly, storing in localStorage only the match history
   2. Store the data in a table

2. Add the archetype played and against in the card of match.
   It should be insert after the score.
   Cyan color is player. Red is opponent.
   Formatting : {Player archetype} vs {Opponent Archetype}
   Unknow = Archetype manquant

3. New layout for "player-stat-cell" :
   [Match played] [Match Winrate] [Match Win] [Match Draws]
   [Game played] [Game Winrate] [Game Win] [Match Draw Percentage (new cell)]
   [Most played archetype] [Nemesis] [Rival]

## Calendar Page

1. Rename Calendar Page to Event Page. This is DOMAIN CHANGE. URl and all data names must be updated to "Event".
   Event Page still contain Calendar view and list view. Those are unchanged.
   New url : /events/
   Already existing is unchanging : /events/{id}

### Calendar View

1. Sunday must be 7th column and Monday 1st

### Event View

1. After the title of the event, add max number of player and reformat liek this :
   {title of the event} ({number of player} players) Starting Hour : {starting hour local hour}

2. Add link to google maps for address in event cards

3. On cards, move register button at the left of "Add to Calendar" button. Make it visible to all user. Invited user also see it but instead of registering, it opens sign in page and if signed in or created account, redirect to event page to confirm register.

4. Clicking on "Add to Calendar" should prompt user to find application with which to open ICS files if possible.

## Events/{id} page

1. Remove "event-detail-actions" and transform "event-detail-kicker" to become a link that redirect to Organization Website (if existing) in organization settings.

2. Add a line with all organizer of organization as new row at the bottom of the hero. Font small, italic.

## Sign in Page

1. Remove the "sign in" button in the header just for this page (and create new account page).

## Admin Page

1. Fix breadcrumb to show only "admin" (remove menu). Admin is start new tree. All related pages add to breadcrumb.

2. User cards like in the homepage for each item in the admin menu

3. Remove second Organizations Button and /organizations page.

### Users Page

1. If last admin account : Admin cannot revoke its own account.

2. If last admin account : Admin cannot disable its own account.

3. Cannot grant role user already have.

### Organizations

1. Instead of "Owner User ID" text input. Replace with a filter select of all the users that validate the conditions to become an organizer.

2. Add User feedback on validators of inputs to create an organization. Only name is mandatory. Other are optional and can be empty.

3. Add a button to cancel the creation of a new organization (same as clicking again on new organization but in form section).

4. Remove "Owner User ID" field from form and domain data. No one own an Organization. Organization can have many organizer. Oganizer can have many Organization.

5. Remove "Apply" button and make onInput filter.

6. Move "New Organization" button at the bottom of search section and update it to warning colors.
