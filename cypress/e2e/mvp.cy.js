describe("Gones Angular MVP", () => {
  it("opens the association About page from the menu", () => {
    cy.viewport(375, 812);
    cy.visit("/");
    cy.get('[data-cy="menu-about-link"]').should("have.attr", "href", "/about").click();
    cy.location("pathname").should("eq", "/about");
    cy.contains("h1", "Le Legacy se joue à Lyon.").should("be.focused");
    cy.contains("h2", "Fire & Ice");
    cy.get(".about-person").should("have.length", 8).and("contain", "Gregory Millon").and("contain", "Simon");
    cy.get(".about-contributor").should("have.length", 3);
    cy.contains('a[href="/calendar"]', "Trouver le prochain tournoi").should("be.visible");
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollWidth, "mobile page width").to.be.at.most(doc.documentElement.clientWidth);
    });

    for (const [width, height, label] of [[768, 1024, "tablet"], [1280, 800, "desktop"], [1920, 1080, "ultrawide"]]) {
      cy.viewport(width, height);
      cy.visit("/about");
      cy.document().should((doc) => {
        expect(doc.documentElement.scrollWidth, `${label} page width`).to.be.at.most(doc.documentElement.clientWidth);
      });
    }
  });

  it("imports a League from the header", () => {
    cy.visit("/leagues");
    cy.contains("button", "Sign in locally").should("not.exist");
    cy.contains(".app-toolbar", "Import").should("exist");
    cy.get('[data-cy="header-import-input"]').selectFile({
      contents: Cypress.Buffer.from(JSON.stringify({
        kind: "league",
        gonesDataVersion: 2,
        gonesAppVersion: "test",
        exportedAt: "2026-05-29T00:00:00.000Z",
        league: { id: "source-league", name: "Imported League", status: "active", tournaments: [] }
      })),
      fileName: "imported-league.gones.json",
      mimeType: "application/json"
    }, { force: true });
    cy.location("pathname").should("match", /\/leagues\/.+/);
    cy.contains("h1", "Imported League");
  });

  it("always shows a Ranking toggle for League and Tournament standings", () => {
    const league = {
      id: "ranking-toggle-league",
      name: "Ranking Toggle League",
      status: "active",
      documentVersion: 1,
      updatedAt: "2026-06-03T00:00:00.000Z",
      tournaments: [{
        id: "ranking-toggle-tournament",
        leagueId: "ranking-toggle-league",
        name: "Ranking Toggle Tournament",
        tournamentDate: "2026-06-03",
        rounds: [{
          id: "round-1",
          entries: [{
            kind: "match",
            id: "match-1",
            table: "1",
            player1Name: "Alice",
            player2Name: "Bob",
            player1Score: 2,
            player2Score: 0,
            player1DeckArchetype: "Fire",
            player2DeckArchetype: "Ice"
          }]
        }]
      }]
    };

    cy.visit("/leagues/ranking-toggle-league", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({ version: 1, leagues: [league] }));
      }
    });
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").and("have.attr", "aria-expanded", "false");
    cy.get('[data-cy="ranking-table"]').should("not.be.visible");
    cy.get('[data-cy="ranking-table-toggle"]').click().should("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking");
    cy.get('[data-cy="ranking-table"]').should("be.visible");
    cy.contains('[data-cy="ranking-table"] tr', "Alice").should("have.attr", "role", "link").click();
    cy.location("pathname").should("eq", "/players/Alice");

    cy.visit("/leagues/ranking-toggle-league/tournaments/ranking-toggle-tournament");
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").and("have.attr", "aria-expanded", "false");
    cy.get('[data-cy="ranking-table-toggle"]').click().should("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking");
    cy.get('[data-cy="ranking-table"]').should("be.visible");
  });

  it("shows Tournaments as clickable responsive cards", () => {
    cy.visit("/leagues/table-league", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "table-league",
            name: "Table League",
            status: "active",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [
              { id: "table-tournament-1", leagueId: "table-league", name: "First Table Tournament", tournamentDate: "2026-06-01", rounds: [] },
              { id: "table-tournament-2", leagueId: "table-league", name: "Second Table Tournament", tournamentDate: "2026-06-02", rounds: [] }
            ]
          }]
        }));
      }
    });
    cy.get('[data-cy="tournament-card-grid"]').within(() => {
      cy.contains("a", "Second Table Tournament").should("contain", "2026").and("have.attr", "href", "/leagues/table-league/tournaments/table-tournament-2").click();
    });
    cy.location("pathname").should("eq", "/leagues/table-league/tournaments/table-tournament-2");
  });

  it("shows read-only League controls without login", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("not.exist");
    cy.get('[data-cy="league-name-input"]').should("not.exist");
    cy.contains("Export League").should("exist");
  });

  it.skip("opens Tournament source data as editable and imports headerless CSV rows", () => {
    cy.visit("/leagues/editable-tournament-league/tournaments/editable-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "editable-tournament-league",
            name: "Editable Tournament League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{ id: "editable-tournament", leagueId: "editable-tournament-league", name: "Editable Tournament", tournamentDate: "", rounds: [{ id: "round-1", entries: [] }] }]
          }]
        }));
      }
    });
    cy.contains("button", "Edit source data").should("not.exist");
    cy.contains("mat-expansion-panel", "Round 1").find("mat-expansion-panel-header").click();
    cy.contains("Round Import").should("exist");
    cy.get('[data-cy="round-import-input"]').should("have.attr", "placeholder", "table number, player name, result, opponent name, player deck archetype, opponent deck archetype\n7,Alice,Won 2-1,Bob,Fire,Ice\n8,Charlie,Lost 1-2,Dana,Water,Earth\n9,Eve,Draw 1-1,Frank,Air,Metal").type("7,Alice,Won 2-1,Bob,Fire,Ice", { force: true });
    cy.contains("button", "Import").click();
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').should("have.value", "Alice").clear().type("Alicia");
    cy.document().trigger("keydown", { key: "s", ctrlKey: true });
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').should("have.value", "Alicia");
  });

  it("shows editable Player Archetype inputs tied to players while Round panels stay collapsed", () => {
    cy.visit("/leagues/archetype-panel-league/tournaments/archetype-panel-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "archetype-panel-league",
            name: "Archetype Panel League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{
              id: "archetype-panel-tournament",
              leagueId: "archetype-panel-league",
              name: "Archetype Panel Tournament",
              tournamentDate: "",
              playerArchetypes: [],
              rounds: [{
                id: "round-1",
                entries: [{ kind: "match", id: "match-1", table: "7", player1Name: "Alice", player2Name: "Bob", player1Score: 2, player2Score: 1, player1DeckArchetype: "Fire", player2DeckArchetype: "Ice" }]
              }]
            }]
          }]
        }));
      }
    });

    cy.contains("mat-expansion-panel", "Round 1").should("contain", "1 entries");
    cy.get('[data-cy="player-archetype-panel"]').should("contain", "2 players").find("mat-expansion-panel-header").click();
    cy.contains('[data-cy="player-archetype-row"]', "Alice").within(() => {
      cy.get('input[aria-label="Deck archetype for Alice"]').should("be.visible").and("have.value", "Fire").clear().type("Phoenix");
    });
    cy.contains('[data-cy="player-archetype-row"]', "Bob").within(() => {
      cy.get('input[aria-label="Deck archetype for Bob"]').should("be.visible").and("have.value", "Ice");
    });
    cy.document().trigger("keydown", { key: "s", ctrlKey: true });
    cy.reload();
    cy.get('[data-cy="player-archetype-panel"]').find("mat-expansion-panel-header").click();
    cy.get('input[aria-label="Deck archetype for Alice"]').should("have.value", "Phoenix");
  });

  it("opens a Tournament Result page that fits in one full-HD viewport", () => {
    cy.viewport(1920, 1080);
    cy.visit("/leagues/result-page-league/tournaments/result-page-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "result-page-league",
            name: "Result Page League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{
              id: "result-page-tournament",
              leagueId: "result-page-league",
              name: "Result Page Tournament",
              tournamentDate: "2026-06-10",
              rounds: [{
                id: "round-1",
                entries: [
                  { kind: "match", id: "match-1", table: "1", player1Name: "Alice", player2Name: "Bob", player1Score: 2, player2Score: 0, player1DeckArchetype: "Fire", player2DeckArchetype: "Ice" },
                  { kind: "match", id: "match-2", table: "2", player1Name: "Charlie", player2Name: "Dana", player1Score: 2, player2Score: 1, player1DeckArchetype: "Fire", player2DeckArchetype: "Earth" },
                  { kind: "match", id: "match-3", table: "3", player1Name: "Eve", player2Name: "Frank", player1Score: 2, player2Score: 0, player1DeckArchetype: "Ice", player2DeckArchetype: "Water" },
                  { kind: "match", id: "match-4", table: "4", player1Name: "Grace", player2Name: "Heidi", player1Score: 1, player2Score: 2, player1DeckArchetype: "Air", player2DeckArchetype: "Fire" },
                  { kind: "match", id: "match-5", table: "5", player1Name: "Ivan", player2Name: "Judy", player1Score: 2, player2Score: 0, player1DeckArchetype: "Stone", player2DeckArchetype: "Shadow" }
                ]
              }]
            }]
          }]
        }));
      }
    });

    cy.contains("a", "View Result").should("have.attr", "href", "/leagues/result-page-league/tournaments/result-page-tournament/result").click();
    cy.location("pathname").should("eq", "/leagues/result-page-league/tournaments/result-page-tournament/result");
    cy.get('[data-cy="tournament-result-page"]').should("contain", "Result Page League").and("contain", "Result Page Tournament").and("contain", "Rounds").and("contain", "Matches").and("contain", "Alice").and("not.contain", "Final Results");
    cy.get(".result-standings th").should("not.contain", "Pts");
    cy.get(".result-standings tbody tr").should("have.length", 8).last().should("be.visible");
    cy.get(".result-standings").should("not.contain", "Judy");
    cy.contains("a", "See Archetype Share").click();
    cy.location("pathname").should("eq", "/leagues/result-page-league/tournaments/result-page-tournament/result/metagames");
    cy.get('[data-cy="tournament-result-page"]').should("contain", "Metagame").and("contain", "Fire");
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollHeight, "page height").to.be.at.most(doc.defaultView.innerHeight);
    });
  });

  it("shows Player Statistics route with history back buttons", () => {
    cy.visit("/leagues");
    cy.visit("/players/Alice");
    cy.contains("h1", "Alice");
    cy.get("button.back-button").should("have.length", 2);
    cy.contains("Played Matches");
    cy.contains("No Matches.");
    cy.get("button.back-button").first().click();
    cy.location("pathname").should("eq", "/leagues");
  });
});
