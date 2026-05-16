import { createByeRoundEntry, createMatchRoundEntry, createRound } from "../domain/models.js";
import { calculateTournamentResult } from "../domain/results.js";
import { getTournamentWarnings } from "../domain/warnings.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { bindBackButton, renderBackButton } from "../components/back-button.js";
import { renderRoundEditor, replaceRoundEntriesFromText } from "../components/round-editor.js";
import { findLeague, findTournament, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
const tournamentId = params.get("tournamentId");
let league = findLeague(data, leagueId);
let tournament = findTournament(league, tournamentId);

const BUTTON_CREATE = "button-create";
const INPUT_CLASSES = "field";
const PANEL_CLASSES = "panel";
const SECTION_HEADER_CLASSES = "section-header";

render();

function render() {
  const app = document.querySelector("#app");
  if (!league || !tournament) {
    app.innerHTML = `<div class="grid gap-[18px]"><section class="${PANEL_CLASSES}"><h1 class="page-title">Tournament not found</h1><p><a class="text-link" href="leagues.html">Back to Leagues</a></p></section>${renderBackButton()}</div>`;
    bindBackButton();
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
          <div class="min-w-0">
            <button type="button" class="page-title block max-w-full cursor-text border-0 bg-transparent p-0 text-left" data-action="edit-tournament-title" data-cy="tournament-title" title="Edit tournament name">${escapeHtml(tournament.name)}</button>
            <input class="${INPUT_CLASSES} mt-1 hidden w-full max-w-[560px] text-3xl font-extrabold leading-tight md:text-5xl" data-action="tournament-title-input" data-cy="tournament-name" value="${escapeAttribute(tournament.name)}" aria-label="Tournament name">
            <p class="mt-2 text-dim-ash" data-cy="tournament-state">${result.provisional ? "Provisional Result" : result.incomplete ? "Incomplete Tournament" : "Tournament Result"}</p>
          </div>
        </div>
        <div class="mt-5 grid gap-3 sm:ml-auto sm:w-auto sm:min-w-[240px]">
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            Tournament date
            <input class="${INPUT_CLASSES} normal-case tracking-normal" type="date" data-field="tournamentDate" data-cy="tournament-date" value="${escapeAttribute(tournament.tournamentDate)}">
          </label>
        </div>
      </section>

      <section class="grid gap-[18px]">
        <h2 class="section-title">Tournament Result</h2>
        ${renderRankingTable(result.rows, {
    emptyText: "No valid Round Entries yet",
    playerHref: (playerName) =>
      `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`
  })}
      </section>

      <div class="flex justify-center">
        <button type="button" class="${BUTTON_CREATE} min-h-14 px-8 text-base" data-action="add-round" data-cy="add-round">Add Round</button>
      </div>

      <section class="grid gap-[18px]" data-cy="round-list">
        ${(tournament.rounds ?? []).map((round, index) => renderRoundEditor(round, index, warnings)).join("")}
      </section>
      ${renderBackButton()}
    </div>
  `;

  bindEvents();
  bindBackButton();
}

function bindEvents() {
  const titleButton = document.querySelector("[data-action='edit-tournament-title']");
  const titleInput = document.querySelector("[data-action='tournament-title-input']");

  titleButton.addEventListener("click", () => {
    titleButton.classList.add("hidden");
    titleInput.classList.remove("hidden");
    titleInput.focus();
    titleInput.select();
  });

  const saveTournamentTitle = () => {
    tournament.name = titleInput.value.trim() || "New Tournament";
    titleInput.value = tournament.name;
    saveData(data);
    titleButton.textContent = tournament.name;
    document.title = `Gones - ${tournament.name}`;
    renderBreadcrumb();
    titleInput.classList.add("hidden");
    titleButton.classList.remove("hidden");
  };

  titleInput.addEventListener("blur", saveTournamentTitle);
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") titleInput.blur();
    if (event.key === "Escape") {
      titleInput.value = tournament.name;
      titleInput.blur();
    }
  });

  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const entryRow = input.closest("[data-entry-id]");
      if (entryRow) {
        const round = findRound(entryRow.dataset.roundId);
        const entry = round.entries.find((item) => item.id === entryRow.dataset.entryId);
        entry[input.dataset.field] = input.value;
      } else {
        tournament[input.dataset.field] = input.value;
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
