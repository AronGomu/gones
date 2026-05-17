import { createTournament } from "../domain/models.js";
import { exportLeague } from "../domain/export-restore.js";
import { calculateLeagueEndDate, calculateLeagueResult, calculateLeagueStartDate, calculateTournamentResult } from "../domain/results.js";
import { hasMissingByeWarning } from "../domain/warnings.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { bindBackButton, renderBackButton, renderBackButtonsAround } from "../components/back-button.js";
import { findLeague, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
let league = findLeague(data, leagueId);
let leagueResultCollapsed = false;
let tournamentSortDirection = "desc";
const LAST_LEAGUE_KEY = "gones_last_league_id";

const BUTTON_CREATE = "button-create";
const INPUT_CLASSES = "field";
const PANEL_CLASSES = "panel";
const SECTION_HEADER_CLASSES = "section-header";

render();

function render() {
  const app = document.querySelector("#app");
  if (!league) {
    app.innerHTML = `<div class="grid gap-[18px]">${renderBackButtonsAround(`<section class="${PANEL_CLASSES}"><h1 class="page-title">League not found</h1><p><a class="text-link" href="leagues.html">Back to Leagues</a></p></section>`)}</div>`;
    bindBackButton();
    return;
  }

  const result = calculateLeagueResult(league);
  const leagueActive = league.status !== "finished";
  const leagueStartDate = calculateLeagueStartDate(league);
  const leagueEndDate = calculateLeagueEndDate(league);
  localStorage.setItem(LAST_LEAGUE_KEY, league.id);
  renderBreadcrumb();
  document.title = `Gones - ${league.name}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      ${renderBackButton()}
      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <div class="min-w-0">
            <button type="button" class="page-title block max-w-full cursor-text border-0 bg-transparent p-0 text-left" data-action="edit-league-title" data-cy="league-title" title="Edit league name">${escapeHtml(league.name)}</button>
            <input class="${INPUT_CLASSES} mt-1 hidden w-full max-w-[560px] text-3xl font-extrabold leading-tight md:text-5xl" data-action="league-title-input" data-cy="league-name" value="${escapeAttribute(league.name)}" aria-label="League name">
          </div>
        </div>
        <div class="mt-5 flex flex-wrap items-end justify-start gap-3">
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel" style="width: 9.5rem;">
            Status
            <button type="button" class="grid min-h-[38px] w-full grid-cols-[1fr_auto] items-center gap-3 rounded-card border px-2.5 py-1.5 text-left font-bold normal-case tracking-normal transition ${leagueActive ? "border-[oklch(55%_0.13_142)] bg-[oklch(27%_0.06_142)] text-[oklch(84%_0.11_142)]" : "border-soot bg-raised-iron text-dim-ash"}" style="width: 100%;" data-action="toggle-status" data-cy="league-status" aria-pressed="${leagueActive}">
              <span>${leagueActive ? "Active" : "Completed"}</span>
              <span class="relative h-5 w-10 rounded-full ${leagueActive ? "bg-[oklch(72%_0.18_145)]" : "bg-steel"}" aria-hidden="true">
                <span class="absolute top-0.5 size-4 rounded-full bg-[oklch(96%_0.018_70)] transition ${leagueActive ? "right-0.5" : "left-0.5"}"></span>
              </span>
            </button>
          </label>
          <div class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            Start date
            <span class="status-seal min-h-[38px] items-center normal-case tracking-normal" data-cy="league-start-date">${leagueStartDate || "No tournaments"}</span>
          </div>
          <div class="grid justify-start gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            End date
            <span class="status-seal min-h-[38px] items-center normal-case tracking-normal" data-cy="league-end-date">${leagueEndDate || "No tournaments"}</span>
          </div>
        </div>
      </section>

      <section class="grid gap-[18px]">
        <button type="button" class="group flex min-h-[44px] items-center gap-3 border-0 bg-transparent p-0 text-left text-ash" data-action="toggle-league-result" data-cy="toggle-league-result" aria-expanded="${leagueResultCollapsed ? "false" : "true"}">
          <span class="inline-flex size-7 items-center justify-center bg-transparent text-lg text-steel transition-colors group-hover:text-ash" aria-hidden="true">${leagueResultCollapsed ? "▸" : "▾"}</span>
          <h2 class="section-title">League Ranking</h2>
        </button>
        ${leagueResultCollapsed ? "" : renderRankingTable(result.rows, {
    emptyText: "Empty League has no League Result",
    playerHref: (playerName) => `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}`
  })}
      </section>

      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <div class="grid gap-2">
            <h2 class="section-title">Tournaments</h2>
            <button type="button" class="button-secondary w-fit" data-action="toggle-tournament-sort" data-cy="toggle-tournament-sort" aria-label="Sort tournaments by date ${tournamentSortDirection === "asc" ? "descending" : "ascending"}">
              Date ${tournamentSortDirection === "asc" ? "ascending ↑" : "descending ↓"}
            </button>
          </div>
          <button class="${BUTTON_CREATE}" type="button" data-action="create-tournament" data-cy="create-tournament" ${leagueActive ? "" : "disabled aria-disabled=\"true\" title=\"Completed Leagues cannot add Tournaments\""}>Add Tournament</button>
        </div>
        <div class="mt-5 grid gap-3" data-cy="tournament-list">
          ${renderTournamentList()}
        </div>
      </section>
      ${renderLeagueBottomNav()}
      ${renderDeleteLeagueDialog()}
    </div>
  `;

  bindEvents();
  bindBackButton();
}

function renderLeagueBottomNav() {
  return `
    <nav class="bottom-nav items-center justify-between gap-3" aria-label="Page navigation">
      <button class="button-secondary min-h-[64px] gap-3 px-8 py-4 text-xl" type="button" data-action="go-back" data-cy="back-button"><svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg> Back</button>
      <button class="button-danger min-h-[64px] px-8 py-4 text-xl" type="button" data-action="open-delete-league-dialog" data-cy="open-delete-league">Delete League</button>
    </nav>
  `;
}

function renderDeleteLeagueDialog() {
  return `
    <div class="modal-backdrop hidden" data-cy="delete-league-dialog" data-dialog="delete-league" role="dialog" aria-modal="true" aria-labelledby="delete-league-title">
      <section class="modal-panel border-[oklch(46%_0.15_27)] bg-[oklch(13%_0.052_29)]">
        <div class="grid gap-2 border-b border-soot pb-4">
          <p class="kicker text-hot-blood">Destructive action</p>
          <h2 id="delete-league-title" class="section-title">Delete League</h2>
          <p class="muted-copy">This permanently deletes <strong class="text-ash">${escapeHtml(league.name)}</strong>, its Tournaments, rounds, and Player Statistics source data.</p>
        </div>
        <label class="grid gap-2 text-sm font-bold uppercase tracking-[0.08em] text-steel">
          Type the League name to confirm
          <input class="field normal-case tracking-normal" data-action="delete-league-confirmation-input" data-cy="delete-league-confirmation-input" autocomplete="off" value="" placeholder="${escapeAttribute(league.name)}">
        </label>
        <div class="flex flex-wrap justify-end gap-3">
          <button class="button-secondary" type="button" data-action="close-delete-league-dialog">Cancel</button>
          <button class="button-danger" type="button" data-action="confirm-delete-league" data-cy="confirm-delete-league" disabled>Delete League</button>
        </div>
      </section>
    </div>
  `;
}

function renderTournamentList() {
  if (!league.tournaments?.length) return `<p class="text-dim-ash">No Tournaments yet.</p>`;
  return [...league.tournaments]
    .sort(compareTournamentsByDate)
    .map((tournament) => {
      const href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`;
      const playerCount = calculateTournamentResult(tournament).rows.length;
      const hasMissingBye = hasMissingByeWarning(tournament);
      return `
        <a class="group league-card ${hasMissingBye ? "border-blood" : ""}" data-cy="tournament-list-item" href="${href}">
          <div class="${SECTION_HEADER_CLASSES} items-center">
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h3 class="m-0 text-xl font-extrabold leading-tight text-hot-blood">${escapeHtml(tournament.name)}</h3>
              <span class="text-xl font-semibold leading-tight text-dim-ash">${formatTournamentDate(tournament.tournamentDate)}</span>
              <span class="text-xl font-semibold leading-tight text-dim-ash">${playerCount} player${playerCount === 1 ? "" : "s"}</span>
            </div>
            <span class="open-affordance" data-cy="open-tournament" aria-hidden="true">→</span>
          </div>
          ${hasMissingBye ? `<div class="warning-message" data-cy="tournament-list-missing-bye-warning"><span aria-hidden="true">⚠</span> Missing bye matches. Open tournament and click Add Missing Byes Matches.</div>` : ""}
        </a>
      `;
    })
    .join("");
}

function compareTournamentsByDate(left, right) {
  const leftDate = left.tournamentDate || "9999-12-31";
  const rightDate = right.tournamentDate || "9999-12-31";
  const byDate = leftDate.localeCompare(rightDate);
  const byName = left.name.localeCompare(right.name);
  return tournamentSortDirection === "asc" ? byDate || byName : -(byDate || byName);
}

function formatTournamentDate(value) {
  if (!value) return "No Tournament Date";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
  return `${monthName} ${ordinal(day)} ${year}`;
}

function ordinal(day) {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
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

  bindDeleteLeagueDialog();

  document.querySelector("[data-action='toggle-league-result']").addEventListener("click", () => {
    leagueResultCollapsed = !leagueResultCollapsed;
    render();
  });

  document.querySelector("[data-action='toggle-status']").addEventListener("click", () => {
    league.status = league.status === "finished" ? "active" : "finished";
    saveData(data);
    render();
  });

  document.querySelector("[data-action='toggle-tournament-sort']").addEventListener("click", () => {
    tournamentSortDirection = tournamentSortDirection === "asc" ? "desc" : "asc";
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

  document.querySelector("[data-action='create-tournament']").addEventListener("click", () => {
    const tournament = createTournament({ leagueId: league.id });
    league.tournaments.push(tournament);
    saveData(data);
    location.href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}&editName=1`;
  });

}

function bindDeleteLeagueDialog() {
  const dialog = document.querySelector("[data-dialog='delete-league']");
  const input = document.querySelector("[data-action='delete-league-confirmation-input']");
  const confirmButton = document.querySelector("[data-action='confirm-delete-league']");
  const closeDialog = () => {
    dialog.classList.add("hidden");
    input.value = "";
    confirmButton.disabled = true;
  };

  document.querySelector("[data-action='open-delete-league-dialog']").addEventListener("click", () => {
    dialog.classList.remove("hidden");
    requestAnimationFrame(() => input.focus());
  });

  document.querySelector("[data-action='close-delete-league-dialog']").addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  input.addEventListener("input", () => {
    confirmButton.disabled = input.value !== league.name;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDialog();
  });
  confirmButton.addEventListener("click", () => {
    if (input.value !== league.name) return;
    data.leagues = data.leagues.filter((item) => item.id !== league.id);
    if (localStorage.getItem(LAST_LEAGUE_KEY) === league.id) localStorage.removeItem(LAST_LEAGUE_KEY);
    saveData(data);
    location.href = "leagues.html";
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
