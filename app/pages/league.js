import { createTournament } from "../domain/models.js";
import { exportLeague, restoreLeague } from "../domain/export-restore.js";
import { calculateLeagueResult } from "../domain/results.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { findLeague, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
let league = findLeague(data, leagueId);

const BUTTON_PRIMARY = "min-h-[38px] cursor-pointer rounded-md border border-teal-700 bg-teal-700 px-3 py-2 font-semibold text-white";
const BUTTON_SECONDARY = "inline-flex min-h-[38px] cursor-pointer items-center justify-center rounded-md border border-teal-700 bg-white px-3 py-2 font-semibold text-teal-800";
const INPUT_CLASSES = "min-h-[38px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-900";
const PANEL_CLASSES = "rounded-lg border border-slate-200 bg-white p-[18px]";
const SECTION_HEADER_CLASSES = "flex items-start justify-between gap-[18px] max-[760px]:grid max-[760px]:grid-cols-1";

render();

function render() {
  const app = document.querySelector("#app");
  if (!league) {
    app.innerHTML = `<section class="${PANEL_CLASSES}"><h1 class="m-0 text-3xl leading-tight">League not found</h1><p><a class="text-teal-800 hover:underline" href="leagues.html">Back to Leagues</a></p></section>`;
    return;
  }

  const result = calculateLeagueResult(league);
  renderBreadcrumb();
  document.title = `Gones - ${league.name}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <div>
            <h1 class="m-0 text-3xl leading-tight" data-cy="league-title">${escapeHtml(league.name)}</h1>
            <p class="text-slate-500">${result.provisional ? "Provisional League Result" : result.rows.length ? "League Result" : "No League Result"}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2.5">
            <button type="button" class="${BUTTON_SECONDARY}" data-action="export" data-cy="export-league">Export</button>
            <label class="${BUTTON_SECONDARY}">
              <input class="pointer-events-none absolute h-px w-px opacity-0" type="file" accept="application/json" data-action="restore" data-cy="restore-league">
              Restore
            </label>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2.5">
          <input class="${INPUT_CLASSES}" data-field="name" data-cy="league-name" value="${escapeAttribute(league.name)}" aria-label="League name">
          <input class="${INPUT_CLASSES}" type="date" data-field="startDate" data-cy="league-start-date" value="${escapeAttribute(league.startDate)}" aria-label="Start date">
          <input class="${INPUT_CLASSES}" type="date" data-field="endDate" data-cy="league-end-date" value="${escapeAttribute(league.endDate)}" aria-label="End date">
        </div>
      </section>

      <section class="grid gap-[18px]">
        <div class="${SECTION_HEADER_CLASSES}">
          <h2 class="m-0 text-xl leading-tight">League Result</h2>
        </div>
        ${renderRankingTable(result.rows, {
    emptyText: "Empty League has no League Result",
    playerHref: (playerName) => `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}`
  })}
      </section>

      <section class="${PANEL_CLASSES}">
        <div class="${SECTION_HEADER_CLASSES}">
          <h2 class="m-0 text-xl leading-tight">Tournaments</h2>
          <form id="create-tournament-form" class="flex flex-wrap items-center gap-2.5">
            <input class="${INPUT_CLASSES}" name="name" data-cy="tournament-name-input" placeholder="Tournament name" required>
            <input class="${INPUT_CLASSES}" type="date" name="tournamentDate" data-cy="tournament-date-input" aria-label="Tournament date">
            <button class="${BUTTON_PRIMARY}" type="submit" data-cy="create-tournament">Add Tournament</button>
          </form>
        </div>
        <div class="mt-5 grid gap-3" data-cy="tournament-list">
          ${renderTournamentList()}
        </div>
      </section>
    </div>
  `;

  bindEvents();
}

function renderTournamentList() {
  if (!league.tournaments?.length) return `<p class="text-slate-500">No Tournaments yet.</p>`;
  return league.tournaments
    .map((tournament) => {
      const href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`;
      const incomplete = !tournament.rounds?.length;
      return `
        <article class="grid gap-2 rounded-lg border border-slate-200 bg-white p-[18px]" data-cy="tournament-list-item">
          <div class="${SECTION_HEADER_CLASSES}">
            <div>
              <h3 class="m-0 text-base leading-tight"><a class="text-teal-800 hover:underline" href="${href}">${escapeHtml(tournament.name)}</a></h3>
              <p class="text-slate-500">${tournament.tournamentDate || "No Tournament Date"} · ${incomplete ? "Incomplete Tournament" : `${tournament.rounds.length} rounds`}</p>
            </div>
            <a class="text-teal-800 hover:underline" data-cy="open-tournament" href="${href}">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      league[input.dataset.field] = input.value;
      saveData(data);
      document.querySelector("[data-cy='league-title']").textContent = league.name;
      if (input.dataset.field === "name") renderBreadcrumb();
    });
  });

  document.querySelector("#create-tournament-form").addEventListener("submit", (event) => {
    event.preventDefault();
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

  document.querySelector("[data-action='export']").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportLeague(league), null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${league.name || "gones-league"}.gones.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  });

  document.querySelector("[data-action='restore']").addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const restored = restoreLeague(JSON.parse(await file.text()), { existingLeagues: data.leagues });
    data.leagues.push(restored);
    saveData(data);
    location.href = `league.html?leagueId=${encodeURIComponent(restored.id)}`;
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
