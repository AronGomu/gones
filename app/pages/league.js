import { createTournament } from "../domain/models.js";
import { exportLeague } from "../domain/export-restore.js";
import { calculateLeagueResult, calculateTournamentResult } from "../domain/results.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { bindBackButton, renderBackButton } from "../components/back-button.js";
import { findLeague, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
let league = findLeague(data, leagueId);
const LAST_LEAGUE_KEY = "gones_last_league_id";

const BUTTON_CREATE = "button-create";
const INPUT_CLASSES = "field";
const PANEL_CLASSES = "panel";
const SECTION_HEADER_CLASSES = "section-header";

render();

function render() {
  const app = document.querySelector("#app");
  if (!league) {
    app.innerHTML = `<div class="grid gap-[18px]"><section class="${PANEL_CLASSES}"><h1 class="page-title">League not found</h1><p><a class="text-link" href="leagues.html">Back to Leagues</a></p></section>${renderBackButton()}</div>`;
    bindBackButton();
    return;
  }

  const result = calculateLeagueResult(league);
  const leagueActive = league.status !== "finished";
  localStorage.setItem(LAST_LEAGUE_KEY, league.id);
  renderBreadcrumb();
  document.title = `Gones - ${league.name}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <div class="min-w-0">
            <button type="button" class="page-title block max-w-full cursor-text border-0 bg-transparent p-0 text-left" data-action="edit-league-title" data-cy="league-title" title="Edit league name">${escapeHtml(league.name)}</button>
            <input class="${INPUT_CLASSES} mt-1 hidden w-full max-w-[560px] text-3xl font-extrabold leading-tight md:text-5xl" data-action="league-title-input" data-cy="league-name" value="${escapeAttribute(league.name)}" aria-label="League name">
          </div>
        </div>
        <div class="mt-5 grid gap-3 sm:ml-auto sm:w-auto sm:min-w-[520px] sm:grid-cols-3">
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            Status
            <button type="button" class="grid min-h-[38px] grid-cols-[1fr_auto] items-center gap-3 rounded-card border px-2.5 py-1.5 text-left font-bold normal-case tracking-normal transition ${leagueActive ? "border-[oklch(55%_0.13_142)] bg-[oklch(27%_0.06_142)] text-[oklch(84%_0.11_142)]" : "border-[oklch(50%_0.16_28)] bg-[oklch(24%_0.12_27)] text-[oklch(90%_0.045_38)]"}" data-action="toggle-status" data-cy="league-status" aria-pressed="${leagueActive}">
              <span>${leagueActive ? "Active" : "Inactive"}</span>
              <span class="relative h-5 w-10 rounded-full ${leagueActive ? "bg-[oklch(72%_0.18_145)]" : "bg-hot-blood"}" aria-hidden="true">
                <span class="absolute top-0.5 size-4 rounded-full bg-[oklch(96%_0.018_70)] transition ${leagueActive ? "right-0.5" : "left-0.5"}"></span>
              </span>
            </button>
          </label>
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            Start date
            <input class="${INPUT_CLASSES} normal-case tracking-normal" type="date" data-field="startDate" data-cy="league-start-date" value="${escapeAttribute(league.startDate)}">
          </label>
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            End date
            <input class="${INPUT_CLASSES} normal-case tracking-normal" type="date" data-field="endDate" data-cy="league-end-date" value="${escapeAttribute(league.endDate)}">
          </label>
        </div>
      </section>

      <section class="grid gap-[18px]">
        <div class="${SECTION_HEADER_CLASSES}">
          <h2 class="section-title">League Result</h2>
        </div>
        ${renderRankingTable(result.rows, {
    emptyText: "Empty League has no League Result",
    playerHref: (playerName) => `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}`
  })}
      </section>

      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <h2 class="section-title">Tournaments</h2>
          <form id="create-tournament-form" class="flex flex-wrap items-center gap-2.5">
            <input class="${INPUT_CLASSES}" name="name" data-cy="tournament-name-input" placeholder="Tournament name" minlength="3" required>
            <input class="${INPUT_CLASSES}" type="date" name="tournamentDate" data-cy="tournament-date-input" aria-label="Tournament date">
            <button class="${BUTTON_CREATE}" type="submit" data-cy="create-tournament" disabled>Add Tournament</button>
          </form>
        </div>
        <div class="mt-5 grid gap-3" data-cy="tournament-list">
          ${renderTournamentList()}
        </div>
      </section>
      ${renderBackButton()}
    </div>
  `;

  bindEvents();
  bindBackButton();
}

function renderTournamentList() {
  if (!league.tournaments?.length) return `<p class="text-dim-ash">No Tournaments yet.</p>`;
  return league.tournaments
    .map((tournament) => {
      const href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`;
      const playerCount = calculateTournamentResult(tournament).rows.length;
      return `
        <a class="group league-card" data-cy="tournament-list-item" href="${href}">
          <div class="${SECTION_HEADER_CLASSES}">
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="m-0 text-xl font-extrabold leading-tight text-hot-blood md:text-2xl">${escapeHtml(tournament.name)}</h3>
              <span class="text-sm font-semibold text-dim-ash">${tournament.tournamentDate || "No Tournament Date"}</span>
              <span class="text-sm font-semibold text-dim-ash">${playerCount} player${playerCount === 1 ? "" : "s"}</span>
            </div>
            <span class="open-affordance" data-cy="open-tournament" aria-hidden="true">→</span>
          </div>
        </a>
      `;
    })
    .join("");
}

function bindEvents() {
  const titleButton = document.querySelector("[data-action='edit-league-title']");
  const titleInput = document.querySelector("[data-action='league-title-input']");

  titleButton.addEventListener("click", () => {
    titleButton.classList.add("hidden");
    titleInput.classList.remove("hidden");
    titleInput.focus();
    titleInput.select();
  });

  const saveLeagueTitle = () => {
    league.name = titleInput.value.trim() || "New League";
    titleInput.value = league.name;
    saveData(data);
    titleButton.textContent = league.name;
    document.title = `Gones - ${league.name}`;
    renderBreadcrumb();
    titleInput.classList.add("hidden");
    titleButton.classList.remove("hidden");
  };

  titleInput.addEventListener("blur", saveLeagueTitle);
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") titleInput.blur();
    if (event.key === "Escape") {
      titleInput.value = league.name;
      titleInput.blur();
    }
  });

  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      league[input.dataset.field] = input.value;
      saveData(data);
    });
  });

  document.querySelector("[data-action='toggle-status']").addEventListener("click", () => {
    league.status = league.status === "finished" ? "active" : "finished";
    saveData(data);
    render();
  });

  document.querySelector("[data-action='export']").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportLeague(league), null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${league.name || "gones-league"}.gones.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  });

  const tournamentForm = document.querySelector("#create-tournament-form");
  const tournamentNameInput = tournamentForm.querySelector("[name='name']");
  const createTournamentButton = tournamentForm.querySelector("[data-cy='create-tournament']");
  const syncCreateTournamentButton = () => {
    createTournamentButton.disabled = tournamentNameInput.value.trim().length < 3;
  };

  tournamentNameInput.addEventListener("input", syncCreateTournamentButton);
  syncCreateTournamentButton();

  tournamentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (tournamentNameInput.value.trim().length < 3) return;
    const form = new FormData(event.currentTarget);
    const tournament = createTournament({
      leagueId: league.id,
      name: form.get("name"),
      tournamentDate: form.get("tournamentDate")
    });
    league.tournaments.push(tournament);
    saveData(data);
    location.href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`;
  });

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
  document.querySelector("[data-cy='breadcrumb-current']").textContent = league.name;
}
