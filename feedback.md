# Feedback Calendar V1 Implementation

1. on calendar page, calendar view : show on the calendar all the dates that are passed (starting form yetersday) as different as ye to come days. Choose design.

2. on calendar page, list view : remove button view page and replace it b making the entire card clickable. Make sure to keep add to calendar button interactable and working.

3. on calendar page, list view: Give only the hour in the timezone do nto precise the GTM. Information is already present with localisation.

4. on calendar page, list view & calendar view : When searching, highlight matching text in search like for stat player

5. When on tournaments/new page, breadcrumb show : "Not Found". Fix to "Create Tournament"

6. When on tournaments/new page, rename

7. Create admin page with organization section to allow admin only to create organization and those organization can be assign to user and transform them into organizer of their organization. An organisation can have several organizer. An organizer can be in different organization (many to many). All must be done from a single screen. Tell me best way to design that UI/UX.
   Admin can assign itself organizations too as normal user

8. Admin always has access to all organization for creating a new tournament event

9. rename /tournaments/new to /events/new. Glboally rename all of that. Those all are event of 1 or more tournaments, use "Event" for back and front

10. on calendar page calendar view, when clicking on previous and next buttons, the calendar disapearing does change scrollbar position. Make sure to stay exactly on same position because its a hassle to always rescroll back down for each time we click next month and try to see the tournaments of that month

11. on calendar page list view : add cool hover effect for cards of list like other cards in application

12. on http://localhost:4200/calendar/tournaments/{id} page, make location a clickable link that open maps in another tab with the adress. Add little google maps icon.

13. on http://localhost:4200/calendar/tournaments/{id} page : move tournament format and capacity on title row like that : [{format}] {title} ({capacity})
14. on http://localhost:4200/calendar/tournaments/{id} page : move date and time and location on same row : {date + time} - {location with link to maps}
15. on http://localhost:4200/calendar/tournaments/{id} page : move button "Organization Website" to be bottom right of section
16. on http://localhost:4200/calendar/tournaments/{id} page : move add to calendar to be on same line as register button, make register button green. remove My registrations buttons. instead make dialog that confirm the registrations and show a button to go look at "my registrations"
17. on http://localhost:4200/calendar/tournaments/{id} page : remove the organization id block. there should be no block left

18. http://localhost:4200/registrations page : the page is accessible to non logged user. thats bug. fix it. Only logged user can access it.

19. generate markdown files that contains all demo admin/organizer/user logins and what they should have at project root.
