import { createTournament } from "../domain/models.js";
import { exportLeague, restoreLeague } from "../domain/export-restore.js";
import { calculateLeagueResult } from "../domain/results.js";
import { renderRankingTable } from "../components/ranking-table.js";
import { findLeague, loadData, saveData } from "../storage/league-store.js";

let data = loadData();
const params = new URLSearchParams(location.search);
const leagueId = params.get("leagueId");
let league = findLeague(data, leagueId);

render();

function render() {
  const app = document.querySelector("#app");
  if (!league) {
    app.innerHTML = `<section class="panel"><h1>League not found</h1><p><a href="leagues.html">Back to Leagues</a></p></section>`;
    return;
  }

  const result = calculateLeagueResult(league);
  document.title = `Gones - ${league.name}`;
  app.innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="section-header">
          <div>
            <h1 data-cy="league-title">${escapeHtml(league.name)}</h1>
            <p class="muted">${result.provisional ? "Provisional League Result" : result.rows.length ? "League Result" : "No League Result"}</p>
          </div>
          <div class="button-row">
            <button type="button" class="secondary" data-action="export" data-cy="export-league">Export</button>
            <label class="file-button">
              <input type="file" accept="application/json" data-action="restore" data-cy="restore-league">
              Restore
            </label>
          </div>
        </div>
        <div class="field-row">
          <input data-field="name" data-cy="league-name" value="${escapeAttribute(league.name)}" aria-label="League name">
          <input type="date" data-field="startDate" data-cy="league-start-date" value="${escapeAttribute(league.startDate)}" aria-label="Start date">
          <input type="date" data-field="endDate" data-cy="league-end-date" value="${escapeAttribute(league.endDate)}" aria-label="End date">
        </div>
      </section>

      <section class="stack">
        <div class="section-header">
          <h2>League Result</h2>
        </div>
        ${renderRankingTable(result.rows, {
          emptyText: "Empty League has no League Result",
          playerHref: (playerName) => `player.html?playerName=${encodeURIComponent(playerName)}&leagueId=${encodeURIComponent(league.id)}`
        })}
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Tournaments</h2>
          <form id="create-tournament-form" class="inline-form">
            <input name="name" data-cy="tournament-name-input" placeholder="Tournament name" required>
            <input type="date" name="tournamentDate" data-cy="tournament-date-input" aria-label="Tournament date">
            <button type="submit" data-cy="create-tournament">Add Tournament</button>
          </form>
        </div>
        <div class="list" data-cy="tournament-list">
          ${renderTournamentList()}
        </div>
      </section>
    </div>
  `;

  bindEvents();
}

function renderTournamentList() {
  if (!league.tournaments?.length) return `<p class="empty-state">No Tournaments yet.</p>`;
  return league.tournaments
    .map((tournament) => {
      const href = `tournament.html?leagueId=${encodeURIComponent(league.id)}&tournamentId=${encodeURIComponent(tournament.id)}`;
      const incomplete = !tournament.rounds?.length;
      return `
        <article class="list-item" data-cy="tournament-list-item">
          <div class="section-header">
            <div>
              <h3><a href="${href}">${escapeHtml(tournament.name)}</a></h3>
              <p class="muted">${tournament.tournamentDate || "No Tournament Date"} · ${incomplete ? "Incomplete Tournament" : `${tournament.rounds.length} rounds`}</p>
            </div>
            <a data-cy="open-tournament" href="${href}">Open</a>
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
