const SETTINGS_KEY = "gones.settings";
const SETTINGS_LANGUAGE_KEY = "gones.settings.language";
const DECK_ARCHETYPES_KEY = "gones.settings.deckArchetypes";
// Baseline Legacy preset pack is always merged back into local settings by the app.
const PRESET_COUNT = 49;

function seedSettings(win, settings) {
  win.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  win.localStorage.setItem(SETTINGS_LANGUAGE_KEY, settings.language);
  win.localStorage.setItem(DECK_ARCHETYPES_KEY, JSON.stringify(settings.deckArchetypes));
}

function visitSettings(settings = { language: "en", deckArchetypes: [] }) {
  cy.visit("/settings", {
    onBeforeLoad(win) {
      win.localStorage.clear();
      seedSettings(win, settings);
    }
  });
  // Test-isolation cleanup can race the previous page's settings self-heal (French default);
  // re-seed after boot and reload so every test deterministically starts from the fixture.
  cy.window().then((win) => seedSettings(win, settings));
  cy.reload();
}

function selectMatOption(selectSelector, optionText) {
  cy.get(selectSelector).should("be.visible").click({ force: true });
  cy.contains("mat-option", optionText).click({ force: true });
  cy.get(selectSelector).should("contain", optionText);
}

function readStoredSettings(win) {
  return JSON.parse(win.localStorage.getItem(SETTINGS_KEY));
}

function expectStoredLanguage(language) {
  cy.window().then((win) => {
    expect(readStoredSettings(win).language).to.equal(language);
    expect(win.localStorage.getItem(SETTINGS_LANGUAGE_KEY)).to.equal(language);
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

function expandArchetypePanel() {
  cy.get('[data-cy="settings-archetype-panel"] mat-expansion-panel-header').click();
  cy.get('[data-cy="settings-archetype-panel"]').should("have.class", "mat-expanded");
  cy.get('[data-cy="settings-new-archetype-input"]').should("be.visible");
}

describe("Settings page", () => {
  it("loads the Settings page with the baseline archetype pack", () => {
    visitSettings();

    cy.get('[data-cy="breadcrumb-current"]').should("contain", "Settings");
    cy.contains("h2", "Language").should("be.visible");
    cy.get('[data-cy="settings-archetype-panel"]').should("be.visible").and("not.have.class", "mat-expanded");
    cy.contains("mat-panel-title", "Deck archetypes").should("be.visible");
    cy.window().then((win) => {
      expect(readStoredSettings(win).deckArchetypes).to.have.length(PRESET_COUNT);
    });
  });

  it("changes the language setting and persists it across reloads", () => {
    visitSettings({ language: "en", deckArchetypes: [] });

    cy.get('[data-cy="settings-language-select"]').should("contain", "English");
    cy.get('[data-cy="settings-language-status"]').should("contain", "Current language: English");

    selectMatOption('[data-cy="settings-language-select"]', "Français");

    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
    expectStoredLanguage("fr");

    cy.reload();
    cy.get('[data-cy="settings-language-select"]').should("contain", "Français");
    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
  });

  it("adds, blocks duplicates, edits, removes, and persists deck archetypes", () => {
    visitSettings({ language: "en", deckArchetypes: ["Control"] });
    expandArchetypePanel();

    archetypeRow("Control").scrollIntoView().should("be.visible");
    archetypeRow("Control").within(() => {
      cy.get('[data-cy="settings-archetype-name"]').should("contain", "Control");
      cy.get('[data-cy="settings-update-archetype-button"]').should("exist");
      cy.get('[data-cy="settings-archetype-input"]').should("not.exist");
    });

    cy.get('[data-cy="settings-new-archetype-input"]').type("Mono Green");
    cy.get('[data-cy="settings-add-archetype-button"]').should("not.be.disabled").click();
    archetypeRow("Mono Green").should("exist");

    cy.get('[data-cy="settings-new-archetype-input"]').type("control");
    cy.get('[data-cy="settings-add-archetype-button"]').should("be.disabled");
    cy.get('[data-cy="settings-new-archetype-input"]').clear().type("Mono Red");
    cy.get('[data-cy="settings-add-archetype-button"]').should("not.be.disabled").click();
    archetypeRow("Mono Red").should("exist");

    cy.get('[data-cy="settings-archetype-filter"]').type("mono");
    archetypeRow("Mono Green").should("be.visible");
    archetypeRow("Mono Red").should("be.visible");
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Control"]').should("not.exist");
    cy.get('[data-cy="settings-archetype-filter"]').clear();

    archetypeRow("Control").scrollIntoView().within(() => {
      cy.get('[data-cy="settings-update-archetype-button"]').click();
      cy.get('[data-cy="settings-archetype-input"]').clear().type("Azorius Control");
      cy.get('[data-cy="settings-save-archetype-button"]').click();
    });
    archetypeRow("Azorius Control").should("exist");
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Control"]').should("not.exist");

    archetypeRow("Mono Green").scrollIntoView().within(() => {
      cy.get('[data-cy="settings-remove-archetype-button"]').click();
    });
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Mono Green"]').should("not.exist");

    cy.window().then((win) => {
      const stored = readStoredSettings(win);
      expect(stored.language).to.equal("en");
      expect(stored.deckArchetypes).to.include.members(["Azorius Control", "Mono Red"]);
      expect(stored.deckArchetypes).to.not.include("Mono Green");
      expect(stored.deckArchetypes).to.not.include("Control");
      const sorted = [...stored.deckArchetypes].sort((a, b) => a.localeCompare(b));
      expect(stored.deckArchetypes).to.deep.equal(sorted);
    });

    cy.reload();
    expandArchetypePanel();
    archetypeRow("Azorius Control").should("exist");
    archetypeRow("Mono Red").should("exist");
  });

  it("exports settings and confirms before imported settings replace the current language and deck archetypes", () => {
    visitSettings({ language: "en", deckArchetypes: ["Old Control"] });
    expandArchetypePanel();

    const exportPath = settingsExportPath();
    cy.exec(`node -e "require('fs').rmSync('${exportPath}', { force: true })"`);
    cy.get('[data-cy="settings-export-button"]').click();
    cy.readFile(exportPath).then((exported) => {
      expect(exported.language).to.equal("en");
      expect(exported.deckArchetypes).to.include("Old Control");
      expect(exported.deckArchetypes).to.have.length(PRESET_COUNT + 1);
    });
    cy.contains('[role="status"]', "Settings exported.").should("be.visible");

    importSettingsFile({ language: "fr", deckArchetypes: ["Canceled Aggro"] }, "canceled-settings.json");
    cy.contains("mat-dialog-container", "Replace your current settings").should("be.visible");
    cy.contains("mat-dialog-container button", "Cancel Esc").click();
    cy.get("mat-dialog-container").should("not.exist");
    cy.get('[data-cy="settings-language-status"]').should("contain", "Current language: English");
    archetypeRow("Old Control").should("exist");
    expectStoredLanguage("en");

    importSettingsFile({ language: "fr", deckArchetypes: ["Imported Control", "Imported Aggro"] }, "imported-settings.json");
    cy.contains("mat-dialog-container", "Replace your current settings").should("be.visible");
    cy.contains("mat-dialog-container button", "Replace settings").click();

    cy.get('[data-cy="settings-language-status"]').should("contain", "Langue actuelle : Français");
    archetypeRow("Imported Aggro").should("exist");
    archetypeRow("Imported Control").should("exist");
    cy.get('[data-cy="settings-archetype-row"][data-archetype="Old Control"]').should("not.exist");
    cy.contains('[role="status"]', "2 archétypes et la langue Français importés.").should("be.visible");
    expectStoredLanguage("fr");
    cy.window().then((win) => {
      const stored = readStoredSettings(win);
      expect(stored.deckArchetypes).to.include.members(["Imported Aggro", "Imported Control"]);
      expect(stored.deckArchetypes).to.not.include("Old Control");
    });
  });
});
