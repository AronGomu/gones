const SETTINGS_KEY = "gones.settings";
const SETTINGS_LANGUAGE_KEY = "gones.settings.language";
const DECK_ARCHETYPES_KEY = "gones.settings.deckArchetypes";

function visitSettings(settings = { language: "en", deckArchetypes: [] }) {
  cy.visit("/settings", {
    onBeforeLoad(win) {
      win.localStorage.clear();
      win.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      win.localStorage.setItem(SETTINGS_LANGUAGE_KEY, settings.language);
      win.localStorage.setItem(DECK_ARCHETYPES_KEY, JSON.stringify(settings.deckArchetypes));
    }
  });
}

function selectMatOption(selectSelector, optionText) {
  cy.get(selectSelector).should("be.visible").click({ force: true });
  cy.contains("mat-option", optionText).click({ force: true });
  cy.get(selectSelector).should("contain", optionText);
}

function expectStoredSettings(expected) {
  cy.window().then((win) => {
    expect(JSON.parse(win.localStorage.getItem(SETTINGS_KEY))).to.deep.equal(expected);
    expect(win.localStorage.getItem(SETTINGS_LANGUAGE_KEY)).to.equal(expected.language);
    expect(JSON.parse(win.localStorage.getItem(DECK_ARCHETYPES_KEY))).to.deep.equal(expected.deckArchetypes);
  });
}

function importSettingsFile(settings, fileName = "settings.json") {
  cy.get('[data-cy="settings-import-input"]').selectFile({
    contents: Cypress.Buffer.from(JSON.stringify(settings)),
    fileName,
    mimeType: "application/json"
  }, { force: true });
}

function settingsExportPath() {
  return `cypress/downloads/gones-settings-${new Date().toISOString().slice(0, 10)}.json`;
}

function archetypeRow(name) {
  return cy.get(`[data-cy="settings-archetype-row"][data-archetype="${name}"]`);
}

describe("Settings page", () => {
  it("loads the Settings page", () => {
    visitSettings();

    cy.get('[data-cy="breadcrumb-current"]').should("contain", "Settings");
    cy.contains("h2", "Language").should("be.visible");
    cy.contains("h2", "Deck archetypes").should("be.visible");
    cy.get('[data-cy="settings-export-button"]').should("be.visible");
    cy.get('[data-cy="settings-import-button"]').should("be.visible");
  });

  it("changes the language setting and persists it across reloads", () => {
    visitSettings({ language: "en", deckArchetypes: [] });

    cy.get('[data-cy="settings-language-select"]').should("contain", "English");
    cy.get('[data-cy="settings-language-status"]').should("contain", "Current language: English");

    selectMatOption('[data-cy="settings-language-select"]', "Français");

    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
    expectStoredSettings({ language: "fr", deckArchetypes: [] });

    cy.reload();
    cy.get('[data-cy="settings-language-select"]').should("contain", "Français");
    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
  });

  it("adds, blocks duplicates, edits, removes, and persists deck archetypes", () => {
    visitSettings({ language: "en", deckArchetypes: ["Control"] });

    archetypeRow("Control").should("be.visible");

    cy.get('[data-cy="settings-new-archetype-input"]').type("Mono Green");
    cy.get('[data-cy="settings-add-archetype-button"]').should("not.be.disabled").click();
    archetypeRow("Mono Green").should("be.visible");

    cy.get('[data-cy="settings-new-archetype-input"]').type("control");
    cy.get('[data-cy="settings-add-archetype-button"]').should("be.disabled");
    cy.get('[data-cy="settings-new-archetype-input"]').clear().type("Mono Red");
    cy.get('[data-cy="settings-add-archetype-button"]').should("not.be.disabled").click();
    archetypeRow("Mono Red").should("be.visible");

    archetypeRow("Control").within(() => {
      cy.get('[data-cy="settings-archetype-input"]').clear().type("Azorius Control").blur();
    });
    archetypeRow("Azorius Control").should("be.visible");
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Control"]').should("not.exist");

    archetypeRow("Mono Green").within(() => {
      cy.get('[data-cy="settings-remove-archetype-button"]').click();
    });
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Mono Green"]').should("not.exist");

    expectStoredSettings({ language: "en", deckArchetypes: ["Azorius Control", "Mono Red"] });

    cy.reload();
    archetypeRow("Azorius Control").should("be.visible");
    archetypeRow("Mono Red").should("be.visible");
    cy.get('[data-cy="settings-archetype-row"]').should("have.length", 2);
  });

  it("exports settings and confirms before imported settings replace the current language and deck archetypes", () => {
    visitSettings({ language: "en", deckArchetypes: ["Old Control"] });

    const exportPath = settingsExportPath();
    cy.exec(`node -e "require('fs').rmSync('${exportPath}', { force: true })"`);
    cy.get('[data-cy="settings-export-button"]').click();
    cy.readFile(exportPath).should("deep.equal", { language: "en", deckArchetypes: ["Old Control"] });
    cy.contains('[role="status"]', "Settings exported.").should("be.visible");

    importSettingsFile({ language: "fr", deckArchetypes: ["Canceled Aggro"] }, "canceled-settings.json");
    cy.contains("mat-dialog-container", "Replace your current settings").should("be.visible");
    cy.contains("mat-dialog-container button", "Cancel Esc").click();
    cy.get('[data-cy="settings-language-status"]').should("contain", "Current language: English");
    archetypeRow("Old Control").should("be.visible");
    expectStoredSettings({ language: "en", deckArchetypes: ["Old Control"] });

    importSettingsFile({ language: "fr", deckArchetypes: ["Imported Control", "Imported Aggro"] }, "imported-settings.json");
    cy.contains("mat-dialog-container", "Replace your current settings").should("be.visible");
    cy.contains("mat-dialog-container button", "Replace settings").click();

    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
    archetypeRow("Imported Aggro").should("be.visible");
    archetypeRow("Imported Control").should("be.visible");
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Old Control"]').should("not.exist");
    cy.contains('[role="status"]', "2 archétypes et la langue Français importés.").should("be.visible");
    expectStoredSettings({ language: "fr", deckArchetypes: ["Imported Aggro", "Imported Control"] });
  });
});
