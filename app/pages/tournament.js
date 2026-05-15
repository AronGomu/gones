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

const BUTTON_PRIMARY = "min-h-[38px] cursor-pointer rounded-md border border-teal-700 bg-teal-700 px-3 py-2 font-semibold text-white";
const INPUT_CLASSES = "min-h-[38px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-900";
const PANEL_CLASSES = "rounded-lg border border-slate-200 bg-white p-[18px]";
const SECTION_HEADER_CLASSES = "flex items-start justify-between gap-[18px] max-[760px]:grid max-[760px]:grid-cols-1";

render();

function render() {
  const app = document.querySelector("#app");
  if (!league || !tournament) {
    app.innerHTML = `<section class="${PANEL_CLASSES}"><h1 class="m-0 text-3xl leading-tight">Tournament not found</h1><p><a class="text-teal-800 hover:underline" href="leagues.html">Back to Leagues</a></p></section>`;
    return;
  }

  renderBreadcrumb();
  const result = calculateTournamentResult(tournament);
  const warnings = getTournamentWarnings(tournament);

  document.title = `Gones - ${tournament.name}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <div>
            <h1 class="m-0 text-3xl leading-tight" data-cy="tournament-title">${escapeHtml(tournament.name)}</h1>
            <p class="text-slate-500" data-cy="tournament-state">${result.provisional ? "Provisional Result" : result.incomplete ? "Incomplete Tournament" : "Tournament Result"}</p>
          </div>
          <button type="button" class="${BUTTON_PRIMARY}" data-action="add-round" data-cy="add-round">Add Round</button>
        </div>
        <div class="flex flex-wrap items-center gap-2.5">
          <input class="${INPUT_CLASSES}" data-field="name" data-cy="tournament-name" value="${escapeAttribute(tournament.name)}" aria-label="Tournament name">
          <input class="${INPUT_CLASSES}" type="date" data-field="tournamentDate" data-cy="tournament-date" value="${escapeAttribute(tournament.tournamentDate)}" aria-label="Tournament Date">
        </div>
      </section>

      <section class="grid gap-[18px]">
        <h2 class="m-0 text-xl leading-tight">Tournament Result</h2>
        ${renderRankingTable(result.rows, {
    emptyText: "No valid Round Entries yet",
    playerHref: (playerName) =>
      `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`
  })}
      </section>

      <section class="grid gap-[18px]" data-cy="round-list">
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
        if (input.dataset.field === "name") renderBreadcrumb();
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

function renderBreadcrumb() {
  const leagueLink = document.querySelector("#breadcrumb-league");
  leagueLink.href = `league.html?leagueId=${encodeURIComponent(league.id)}`;
  leagueLink.textContent = league.name;
  document.querySelector("[data-cy='breadcrumb-current']").textContent = tournament.name;
}
