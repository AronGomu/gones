import { createByeRoundEntry, createMatchRoundEntry, createRound } from "../domain/models.js";
import { calculateTournamentResult } from "../domain/results.js";
import { getTournamentWarnings } from "../domain/warnings.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { renderRoundEditor, replaceRoundEntriesFromText } from "../components/round-editor.js";
import { findLeague, findTournament, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
const tournamentId = params.get("tournamentId");
let league = findLeague(data, leagueId);
let tournament = findTournament(league, tournamentId);

render();

function render() {
  const app = document.querySelector("#app");
  if (!league || !tournament) {
    app.innerHTML = `<section class="panel"><h1>Tournament not found</h1><p><a href="leagues.html">Back to Leagues</a></p></section>`;
    return;
  }

  document.querySelector("#league-link").href = `league.html?leagueId=${encodeURIComponent(league.id)}`;
  document.querySelector("#league-link").textContent = league.name;
  const result = calculateTournamentResult(tournament);
  const warnings = getTournamentWarnings(tournament);

  document.title = `Gones - ${tournament.name}`;
  app.innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="section-header">
          <div>
            <h1 data-cy="tournament-title">${escapeHtml(tournament.name)}</h1>
            <p class="muted" data-cy="tournament-state">${result.provisional ? "Provisional Result" : result.incomplete ? "Incomplete Tournament" : "Tournament Result"}</p>
          </div>
          <button type="button" data-action="add-round" data-cy="add-round">Add Round</button>
        </div>
        <div class="field-row">
          <input data-field="name" data-cy="tournament-name" value="${escapeAttribute(tournament.name)}" aria-label="Tournament name">
          <input type="date" data-field="tournamentDate" data-cy="tournament-date" value="${escapeAttribute(tournament.tournamentDate)}" aria-label="Tournament Date">
        </div>
      </section>

      <section class="stack">
        <h2>Tournament Result</h2>
        ${renderRankingTable(result.rows, {
          emptyText: "No valid Round Entries yet",
          playerHref: (playerName) =>
            `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`
        })}
      </section>

      <section class="stack" data-cy="round-list">
        ${(tournament.rounds ?? []).map((round, index) => renderRoundEditor(round, index, warnings)).join("")}
      </section>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const entryRow = input.closest("[data-entry-id]");
      if (entryRow) {
        const round = findRound(entryRow.dataset.roundId);
        const entry = round.entries.find((item) => item.id === entryRow.dataset.entryId);
        entry[input.dataset.field] = input.value;
      } else {
        tournament[input.dataset.field] = input.value;
        if (input.dataset.field === "name") document.querySelector("[data-cy='tournament-title']").textContent = tournament.name;
      }
      saveData(data);
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.action;
      if (action === "add-round") {
        tournament.rounds.push(createRound());
      }
      if (action === "delete-round") {
        tournament.rounds = tournament.rounds.filter((round) => round.id !== event.currentTarget.dataset.roundId);
      }
      if (action === "add-match") {
        findRound(event.currentTarget.dataset.roundId).entries.push(createMatchRoundEntry());
      }
      if (action === "add-bye") {
        findRound(event.currentTarget.dataset.roundId).entries.push(createByeRoundEntry());
      }
      if (action === "delete-entry") {
        const round = findRound(event.currentTarget.dataset.roundId);
        round.entries = round.entries.filter((entry) => entry.id !== event.currentTarget.dataset.entryId);
      }
      if (action === "import-round") {
        const round = findRound(event.currentTarget.dataset.roundId);
        const textarea = document.querySelector(`textarea[data-round-id="${CSS.escape(round.id)}"]`);
        replaceRoundEntriesFromText(round, textarea.value);
      }
      saveAndRender();
    });
  });
}

function findRound(roundId) {
  return tournament.rounds.find((round) => round.id === roundId);
}

function saveAndRender() {
  saveData(data);
  render();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
