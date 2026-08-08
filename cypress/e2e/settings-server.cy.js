const profile = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "settings@example.test", emailVerified: true, globalRole: "User",
  username: "settings-user", firstName: "Settings", lastName: "User", preferredLanguage: "en", isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};

function mockSession(globalRole) {
  if (!globalRole) {
    cy.intercept("POST", "**/api/auth/refresh", { statusCode: 401, body: { code: "unauthorized", message: "No session." } }).as("refresh");
    return;
  }
  cy.intercept("POST", "**/api/auth/refresh", { accessToken: "memory-token", expiresAt: "2030-01-01T01:00:00Z", tokenType: "Bearer" }).as("refresh");
  cy.intercept("GET", "**/api/users/me", { ...profile, globalRole }).as("profile");
}

function mockOrganizations(organizations) {
  cy.intercept("GET", "**/api/users/me/organizations", organizations).as("myOrgs");
}

function mockArchetypeCatalog() {
  let next = 1;
  const archetypes = [
    { id: "a-burn", name: "Burn (Red)", deletedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "a-elves", name: "Elves (Green)", deletedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }
  ];
  cy.intercept("GET", "**/api/admin/deck-archetypes", req => req.reply(archetypes)).as("adminArchetypes");
  cy.intercept("POST", "**/api/admin/deck-archetypes", req => {
    const archetype = { id: `a-${next++}`, name: req.body.name, deletedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    archetypes.push(archetype);
    req.reply({ statusCode: 201, body: archetype });
  }).as("createArchetype");
  cy.intercept("PUT", /\/api\/admin\/deck-archetypes\/[^/]+$/, req => {
    const id = new URL(req.url).pathname.split("/").pop();
    const archetype = archetypes.find(item => item.id === id);
    archetype.name = req.body.name;
    req.reply(archetype);
  }).as("renameArchetype");
  cy.intercept("DELETE", /\/api\/admin\/deck-archetypes\/[^/]+$/, req => {
    const id = new URL(req.url).pathname.split("/").pop();
    archetypes.find(item => item.id === id).deletedAt = "2026-02-01T00:00:00Z";
    req.reply({ statusCode: 204, body: null });
  }).as("deleteArchetype");
  cy.intercept("POST", /\/api\/admin\/deck-archetypes\/[^/]+\/restore$/, req => {
    const id = new URL(req.url).pathname.split("/").at(-2);
    archetypes.find(item => item.id === id).deletedAt = null;
    req.reply({ statusCode: 204, body: null });
  }).as("restoreArchetype");
  cy.intercept("POST", "**/api/admin/deck-archetypes/import", req => {
    let added = 0;
    let skipped = 0;
    for (const name of req.body.names) {
      if (archetypes.some(item => item.name.toLowerCase() === name.toLowerCase())) { skipped += 1; continue; }
      archetypes.push({ id: `a-${next++}`, name, deletedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      added += 1;
    }
    req.reply({ added, restored: 0, skipped, total: archetypes.filter(item => !item.deletedAt).length });
  }).as("importArchetypes");
  return archetypes;
}

function mockPlayerMaintenance() {
  const state = {
    players: [
      { name: "Alice", occurrenceCount: 3, leagueCount: 2 },
      { name: "alice", occurrenceCount: 1, leagueCount: 1 },
      { name: "Bob", occurrenceCount: 2, leagueCount: 1 }
    ]
  };
  cy.intercept("GET", /\/api\/maintenance\/player-names(\?.*)?$/, req => req.reply({ items: state.players })).as("playerNames");
  cy.intercept("POST", "**/api/maintenance/player-names/rename-preview", req => {
    expect(req.body.fromName).to.equal("Alice");
    req.reply({
      fromName: req.body.fromName,
      toName: req.body.toName,
      affectedLeagueCount: 2,
      affectedOccurrenceCount: 3,
      mergesWithExistingPlayer: false,
      leagues: [
        { id: "league-a", name: "League A", occurrenceCount: 2 },
        { id: "league-b", name: "League B", occurrenceCount: 1 }
      ]
    });
  }).as("renamePreview");
  cy.intercept("POST", "**/api/maintenance/player-names/rename", req => {
    state.players = state.players.map(player => player.name === req.body.fromName ? { ...player, name: req.body.toName } : player);
    req.reply({
      fromName: req.body.fromName,
      toName: req.body.toName,
      affectedLeagueCount: 2,
      affectedOccurrenceCount: 3,
      leagues: [
        { id: "league-a", documentVersion: 2, eTag: '"AAAAAAAAAAI="' },
        { id: "league-b", documentVersion: 2, eTag: '"AAAAAAAAAAI="' }
      ]
    });
  }).as("renameCommit");
  return state;
}

function seedSettings(win, language) {
  win.localStorage.setItem("gones.settings.language", language);
  win.localStorage.setItem("gones.settings", JSON.stringify({ language, deckArchetypes: [] }));
}

function visitSettings(language = "en") {
  cy.visit("/settings", { onBeforeLoad(win) { seedSettings(win, language); } });
  // Test-isolation cleanup can race the previous page's settings self-heal (French default);
  // re-seed after boot and reload so every test deterministically starts in the fixture language.
  cy.window().then((win) => seedSettings(win, language));
  cy.reload();
}

function archetypeRow(name) {
  return cy.get(`[data-cy="settings-archetype-row"][data-archetype="${name}"]`);
}

describe("Settings sections by capability (server mode)", () => {
  beforeEach(() => cy.viewport(1280, 800));

  it("visitor only sees the browser language section and can switch en/fr locally", () => {
    mockSession(null);
    visitSettings("en");

    cy.get('[data-cy="settings-language-select"]').should("contain", "English");
    cy.get('[data-cy="settings-account-link"]').should("not.exist");
    cy.get('[data-cy="settings-account-login-link"]').should("be.visible");
    cy.get('[data-cy="settings-archetype-panel"]').should("not.exist");
    cy.get('[data-cy="settings-players-panel"]').should("not.exist");
    cy.get('[data-cy="settings-org-row"]').should("not.exist");

    cy.get('[data-cy="settings-language-select"]').click({ force: true });
    cy.contains("mat-option", "Français").click({ force: true });
    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
    cy.window().then((win) => {
      expect(win.localStorage.getItem("gones.settings.language")).to.equal("fr");
    });
    cy.reload();
    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
  });

  it("signed-in user sees profile link and owned organization notification preferences", () => {
    mockSession("User");
    mockOrganizations([
      { id: "org-1", name: "Gones Org", description: null, website: null, contactEmail: null, role: "Owner", createdAt: "2026-01-01T00:00:00Z" },
      { id: "org-2", name: "Other Org", description: null, website: null, contactEmail: null, role: "Organizer", createdAt: "2026-01-01T00:00:00Z" }
    ]);
    cy.intercept("GET", "**/api/organizations/org-1/notification-settings", {
      organizationId: "org-1", notifyOnRegistration: true, notifyOnUnregistration: false, updatedAt: "2026-01-01T00:00:00Z"
    }).as("orgSettings");
    cy.intercept("PUT", "**/api/organizations/org-1/notification-settings", req => {
      expect(req.body).to.deep.equal({ notifyOnRegistration: true, notifyOnUnregistration: true });
      req.reply({ organizationId: "org-1", ...req.body, updatedAt: "2026-01-02T00:00:00Z" });
    }).as("saveOrgSettings");

    visitSettings();
    cy.wait("@profile");
    cy.get('[data-cy="settings-account-link"]').should("be.visible").and("have.attr", "href", "/settings/account");
    cy.get('[data-cy="settings-archetype-panel"]').should("not.exist");
    cy.get('[data-cy="settings-players-panel"]').should("not.exist");

    cy.wait("@orgSettings");
    cy.get('[data-cy="settings-org-row"][data-org="Gones Org"]').should("be.visible");
    cy.get('[data-cy="settings-org-row"][data-org="Other Org"]').should("not.exist");
    cy.get('[data-cy="settings-org-notify-registration"]').should("be.checked");
    cy.get('[data-cy="settings-org-notify-unregistration"]').should("not.be.checked").check();
    cy.get('[data-cy="settings-org-save"]').click();
    cy.wait("@saveOrgSettings");
    cy.get('[data-cy="settings-org-status"]').should("contain", "Preferences saved for Gones Org.");
  });

  it("organizer previews affected counts before committing a player rename and cannot see the admin catalog", () => {
    mockSession("Organizer");
    mockOrganizations([]);
    mockPlayerMaintenance();

    visitSettings();
    cy.wait("@playerNames");
    cy.get('[data-cy="settings-archetype-panel"]').should("not.exist");
    cy.get('[data-cy="settings-players-panel"] mat-expansion-panel-header').click();

    cy.get('[data-cy="settings-player-row"][data-player="Alice"]').should("be.visible").within(() => {
      cy.get('[data-cy="settings-player-usage"]').should("contain", "3 entries");
      cy.get('[data-cy="settings-update-player-button"]').click();
      cy.get('[data-cy="settings-player-input"]').clear().type("Alicia");
      cy.get('[data-cy="settings-save-player-button"]').click();
    });
    cy.wait("@renamePreview");
    cy.contains("mat-dialog-container", "Rename Alice to Alicia? 3 result entries across 2 leagues will be updated.").should("be.visible");
    cy.contains("mat-dialog-container button", "Rename player").click();
    cy.wait("@renameCommit");
    cy.get('[data-cy="settings-player-row"][data-player="Alicia"]').should("be.visible");
    cy.get('[data-cy="settings-player-row"][data-player="alice"]').should("be.visible");
    cy.contains('[role="status"]', "Alice renamed to Alicia.").should("be.visible");
  });

  it("admin manages the global deck archetype catalog with soft delete, restore, and import", () => {
    mockSession("Admin");
    mockOrganizations([]);
    mockPlayerMaintenance();
    mockArchetypeCatalog();

    visitSettings();
    cy.wait("@adminArchetypes");
    cy.get('[data-cy="settings-players-panel"]').should("exist");
    cy.get('[data-cy="settings-archetype-panel"] mat-expansion-panel-header').click();

    // duplicate (case/space-insensitive) blocked client-side
    cy.get('[data-cy="settings-new-archetype-input"]').type("  burn   (red) ");
    cy.get('[data-cy="settings-add-archetype-button"]').should("be.disabled");
    cy.get('[data-cy="settings-new-archetype-input"]').clear().type("Mono Red");
    cy.get('[data-cy="settings-add-archetype-button"]').should("not.be.disabled").click();
    cy.wait("@createArchetype");
    archetypeRow("Mono Red").should("be.visible");

    archetypeRow("Elves (Green)").within(() => {
      cy.get('[data-cy="settings-update-archetype-button"]').click();
      cy.get('[data-cy="settings-archetype-input"]').clear().type("Elves (Gruul)");
      cy.get('[data-cy="settings-save-archetype-button"]').click();
    });
    cy.wait("@renameArchetype");
    archetypeRow("Elves (Gruul)").should("be.visible");

    archetypeRow("Mono Red").within(() => {
      cy.get('[data-cy="settings-remove-archetype-button"]').click();
    });
    cy.wait("@deleteArchetype");
    archetypeRow("Mono Red").within(() => {
      cy.get('[data-cy="settings-archetype-deleted"]').should("be.visible");
      cy.get('[data-cy="settings-restore-archetype-button"]').click();
    });
    cy.wait("@restoreArchetype");
    archetypeRow("Mono Red").within(() => {
      cy.get('[data-cy="settings-archetype-deleted"]').should("not.exist");
    });

    cy.get('[data-cy="settings-import-archetypes-input"]').selectFile({
      contents: Cypress.Buffer.from(JSON.stringify({ deckArchetypes: ["Fresh Brew", "Burn (Red)"] })),
      fileName: "archetypes.json",
      mimeType: "application/json"
    }, { force: true });
    cy.wait("@importArchetypes");
    archetypeRow("Fresh Brew").should("be.visible");
    cy.contains('[role="status"]', "Import finished: 1 added, 0 restored, 1 skipped.").should("be.visible");
  });
});
