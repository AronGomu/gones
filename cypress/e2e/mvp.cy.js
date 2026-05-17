describe("Gones MVP", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it("opens the new Leagues page and navigates to a new League", () => {
    cy.visit("/app/pages/leagues.html");

    createLeague("Spring League");

    cy.location("pathname").should("include", "/app/pages/league.html");
    cy.get("[data-cy='league-title']").should("contain", "Spring League");
    cy.get("[data-cy='empty-ranking']").should("contain", "Empty League");
  });

  it("edits League and Tournament titles by clicking their page headers", () => {
    cy.visit("/app/pages/leagues.html");
    createLeague("Editable League");

    cy.get("[data-cy='league-title']").click().should("have.class", "hidden");
    cy.get("[data-cy='league-name']").should("be.visible").clear().type("Renamed League{enter}");
    cy.get("[data-cy='league-title']").should("be.visible").and("contain", "Renamed League");
    cy.get("[data-cy='breadcrumb-current']").should("have.text", "Renamed League");

    cy.get("[data-cy='create-tournament']").click();

    cy.get("[data-cy='tournament-name']").should("be.visible").and("have.value", "New Tournament").clear().type("Renamed Tournament{enter}");
    cy.get("[data-cy='tournament-title']").should("be.visible").and("contain", "Renamed Tournament");
    cy.get("[data-cy='breadcrumb-current']").should("have.text", "Renamed Tournament");
  });

  it("sorts tournaments by date ascending or descending", () => {
    cy.visit("/app/pages/leagues.html");
    createLeague("Sort League");

    createTournamentFromLeaguePage("Middle Event", "2026-02-15");
    cy.go("back");
    createTournamentFromLeaguePage("Early Event", "2026-01-01");
    cy.go("back");
    createTournamentFromLeaguePage("Late Event", "2026-03-20");
    cy.go("back");

    cy.get("[data-cy='tournament-list'] > [data-cy='tournament-list-item'] > div h3").then((items) => {
      expect([...items].map((item) => item.textContent)).to.deep.eq(["Late Event", "Middle Event", "Early Event"]);
    });
    cy.get("[data-cy='tournament-list'] > [data-cy='tournament-list-item']").first().should("contain", "March 20th 2026");

    cy.get("[data-cy='toggle-tournament-sort']").click();
    cy.get("[data-cy='tournament-list'] > [data-cy='tournament-list-item'] > div h3").then((items) => {
      expect([...items].map((item) => item.textContent)).to.deep.eq(["Early Event", "Middle Event", "Late Event"]);
    });
  });

  it("shows a left breadcrumb path through League and Tournament pages", () => {
    cy.visit("/app/pages/leagues.html");
    cy.get("[data-cy='breadcrumb']").shouldHaveNormalizedText("Leagues");
    cy.get("[data-cy='breadcrumb']").shouldSitNextToBrand();

    createLeague("Spring League");

    cy.get("[data-cy='breadcrumb']").shouldHaveNormalizedText("Leagues > Spring League");
    cy.get("[data-cy='breadcrumb']").shouldSitNextToBrand();
    cy.get("[data-cy='breadcrumb-current']").should("have.text", "Spring League");
    cy.get("[data-cy='breadcrumb-current']").find("a").should("not.exist");

    cy.get("[data-cy='create-tournament']").click();
    cy.get("[data-cy='tournament-name']").should("be.visible").clear().type("Week One{enter}");

    cy.get("[data-cy='breadcrumb']").shouldHaveNormalizedText("Leagues > Spring League > Week One");
    cy.get("[data-cy='breadcrumb']").shouldSitNextToBrand();
    cy.get("[data-cy='breadcrumb']").contains("a", "Leagues").should("have.attr", "href", "leagues.html");
    cy.get("[data-cy='breadcrumb']").contains("a", "Spring League").should("have.attr", "href").and("include", "league.html?leagueId=");
    cy.get("[data-cy='breadcrumb-current']").should("have.text", "Week One");
    cy.get("[data-cy='breadcrumb-current']").find("a").should("not.exist");

  });

  it("warns when an odd-player tournament round has no bye", () => {
    cy.visit("/app/pages/league.html?leagueId=league-bye");
    cy.window().then((win) => {
      win.localStorage.setItem("gones_data", JSON.stringify({
        version: 1,
        leagues: [{
          id: "league-bye",
          name: "Bye League",
          status: "active",
          startDate: "",
          endDate: "",
          tournaments: [{
            id: "t-bye",
            leagueId: "league-bye",
            name: "Odd Cup",
            tournamentDate: "2026-01-06",
            rounds: [
              { id: "round-1", entries: [{ kind: "match", id: "m1", table: "1", player: "Alice", result: "Won 2-0", opponent: "Bob", playerDecklist: "", opponentDecklist: "" }] },
              { id: "round-2", entries: [{ kind: "match", id: "m2", table: "1", player: "Alice", result: "Won 2-1", opponent: "Cara", playerDecklist: "", opponentDecklist: "" }] }
            ]
          }]
        }]
      }));
    });
    cy.reload();

    cy.get("[data-cy='tournament-list-missing-bye-warning']").should("contain", "Add Missing Byes Matches");
    cy.get("[data-cy='tournament-list-item']").click();
    cy.get("[data-cy='tournament-missing-bye-warning']").should("contain", "Add Missing Byes Matches");
    cy.get("[data-cy='add-missing-byes']").should("be.visible");
    cy.get("[data-cy='missing-bye-warning']").should("contain", "Add Missing Byes Matches");

    cy.get("[data-cy='add-missing-byes']").click();
    cy.get("[data-cy='add-missing-byes']").should("not.exist");
    cy.get("[data-cy='missing-bye-warning']").should("not.exist");
    cy.get("[data-cy='round-entry'] input[value='Bob']").should("exist");
  });

  it("shows player matches as a sortable, fuzzy-filterable table", () => {
    cy.visit("/app/pages/player.html?playerName=Alice");
    cy.window().then((win) => {
      win.localStorage.setItem("gones_data", JSON.stringify({
        version: 1,
        leagues: [{
          id: "league-1",
          name: "Stats League",
          status: "active",
          startDate: "",
          endDate: "",
          tournaments: [
            { id: "t-early", leagueId: "league-1", name: "Early Cup", tournamentDate: "2026-01-05", rounds: [{ id: "r1", entries: [{ kind: "match", id: "m1", table: "1", player: "Alice", result: "Won 2-0", opponent: "Bob", playerDecklist: "", opponentDecklist: "" }] }] },
            { id: "t-late", leagueId: "league-1", name: "Late Cup", tournamentDate: "2026-03-10", rounds: [{ id: "r2", entries: [{ kind: "match", id: "m2", table: "1", player: "Cara", result: "Won 2-1", opponent: "Alice", playerDecklist: "", opponentDecklist: "" }] }] }
          ]
        }]
      }));
    });
    cy.reload();

    cy.get("[data-cy='player-match-table']").should("exist");
    cy.get("[data-cy='player-match-table'] th").then((headers) => {
      expect([...headers].map((header) => header.textContent)).to.deep.eq(["date match", "tournament", "opponent", "result"]);
    });
    cy.get("[data-cy='player-match']").first().should("contain", "2026-03-10").and("contain", "Stats League Late Cup Round 1").and("contain", "Cara").and("contain", "Lose 1-2").and("have.class", "match-row-loss");

    cy.get("[data-cy='toggle-match-sort']").click();
    cy.get("[data-cy='player-match']").first().should("contain", "2026-01-05").and("contain", "Won 2-0").and("have.class", "match-row-win");

    cy.get("[data-cy='filter-matches']").type("late cara");
    cy.get("[data-cy='player-match']").should("have.length", 1).and("contain", "Late Cup").and("contain", "Cara");
  });

  it("creates a Tournament, imports a Round, shows results, and opens Player Statistics", () => {
    cy.visit("/app/pages/leagues.html");
    createLeague("Spring League");

    cy.get("[data-cy='league-start-date']").should("contain", "No tournaments");
    cy.get("[data-cy='league-end-date']").should("contain", "No tournaments");
    cy.get("[data-cy='create-tournament']").click();
    cy.get("[data-cy='tournament-name']").should("be.visible").clear().type("Week One{enter}");

    cy.location("pathname").should("include", "/app/pages/tournament.html");
    cy.get("[data-cy='tournament-date']").clear().type("2026-01-01");
    cy.get("[data-cy='tournament-state']").should("contain", "Incomplete");
    cy.get("[data-cy='add-round']").click();
    cy.get("[data-cy='round-import']").type("Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n1,Alice,Won 2-0,Bob,,\n2,Cara,Won 2-1,Dan,,", {
      parseSpecialCharSequences: false
    });
    cy.get("[data-cy='import-round']").click();

    cy.get("[data-cy='ranking-row']").first().should("contain", "Alice");
    cy.get("[data-cy='ranking-row']").should("contain", "Cara");
    cy.get("[data-cy='ranking-player']").contains("Alice").click();

    cy.location("pathname").should("include", "/app/pages/player.html");
    cy.location("search").should("include", "playerName=Alice");
    cy.get("[data-cy='player-title']").should("contain", "Alice");
    cy.get("[data-cy='player-match-list']").should("contain", "Bob");
  });

  it("supports manual entry editing, invalid rows, warnings, and deletion", () => {
    cy.visit("/app/pages/leagues.html");
    createLeague("Manual League");
    cy.get("[data-cy='create-tournament']").click();
    cy.get("[data-cy='tournament-name']").should("be.visible").clear().type("Manual Event{enter}");

    cy.get("[data-cy='add-round']").click();
    cy.get("[data-cy='add-match']").click();
    cy.get("[data-cy='round-entry']").within(() => {
      cy.get("[data-field='player']").type("Alice");
      cy.get("[data-field='opponent']").type("Alice");
      cy.get("[data-field='result']").clear().type("Draw 2-1");
    });
    cy.reload();
    cy.get("[data-cy='toggle-round-collapse']").click();
    cy.get("[data-cy='entry-message']").should("contain", "same player on both sides").and("contain", "Result invalid");
    cy.get("[data-cy='empty-ranking']").should("contain", "No valid");

    cy.window().then((win) => cy.stub(win, "confirm").as("confirm").returns(true));
    cy.get("[data-cy='delete-entry']").click();
    cy.get("@confirm").should("have.been.calledWith", "Delete this match?");
    cy.get("[data-cy='round-entry']").should("not.exist");

    cy.get("[data-cy='delete-round']").click();
    cy.get("@confirm").should("have.been.calledWith", "Delete this entire round?");
    cy.get("[data-cy='round']").should("not.exist");
  });

  it("asks confirmation before deleting matches and rounds", () => {
    cy.visit("/app/pages/leagues.html");
    createLeague("Confirm League");
    cy.get("[data-cy='create-tournament']").click();
    cy.get("[data-cy='tournament-name']").should("be.visible").clear().type("Confirm Event{enter}");

    cy.get("[data-cy='add-round']").click();
    cy.get("[data-cy='add-match']").click();

    cy.window().then((win) => cy.stub(win, "confirm").as("confirm").returns(false));
    cy.get("[data-cy='delete-entry']").click();
    cy.get("@confirm").should("have.been.calledWith", "Delete this match?");
    cy.get("[data-cy='round-entry']").should("exist");

    cy.get("[data-cy='delete-round']").click();
    cy.get("@confirm").should("have.been.calledWith", "Delete this entire round?");
    cy.get("[data-cy='round']").should("exist");
  });
});

Cypress.Commands.add("shouldHaveNormalizedText", { prevSubject: true }, (subject, expected) => {
  expect(subject.text().replace(/\s+/g, " ").trim()).to.eq(expected);
});

Cypress.Commands.add("shouldSitNextToBrand", { prevSubject: true }, (subject) => {
  const breadcrumb = subject[0].getBoundingClientRect();
  const brand = subject[0].closest("header").querySelector(".app-brand").getBoundingClientRect();
  expect(breadcrumb.left).to.be.greaterThan(brand.right);
  expect(breadcrumb.left - brand.right).to.be.lessThan(24);
});

function createLeague(name) {
  cy.get("[data-cy='open-create-league']").click();
  cy.get("[data-cy='league-name-input']").type(name);
  cy.get("[data-cy='create-league']").click();
}

function createTournamentFromLeaguePage(name, date) {
  cy.get("[data-cy='create-tournament']").click();
  cy.get("[data-cy='tournament-name']").should("be.visible").clear().type(`${name}{enter}`);
  cy.get("[data-cy='tournament-date']").clear().type(date);
}
