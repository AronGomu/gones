import { calculatePlayerStatistics } from "../domain/player-stats.js";
import { formatPercentage } from "../components/ranking-table.js";
import { bindBackButton, renderBackButton } from "../components/back-button.js";
import { loadData } from "../storage/league-store.js";

const data = loadData();
const params = new URLSearchParams(location.search);
const playerName = params.get("playerName") ?? "";
let filters = {
  leagueId: params.get("leagueId") ?? "",
  tournamentId: params.get("tournamentId") ?? "",
  opponentName: params.get("opponentName") ?? ""
};

const INPUT_CLASSES = "field";
const PANEL_CLASSES = "panel";

render();

function render() {
  const app = document.querySelector("#app");
  document.title = `Gones - ${playerName}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      <section class="${PANEL_CLASSES}">
        <h1 class="page-title" data-cy="player-title">${escapeHtml(playerName)}</h1>
        <form id="filters" class="flex flex-wrap items-end gap-2.5">
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            League
            <select class="${INPUT_CLASSES} normal-case tracking-normal" name="leagueId" data-cy="filter-league">
              <option value="">All Leagues</option>
              ${data.leagues.map((league) => `<option value="${escapeAttribute(league.id)}" ${league.id === filters.leagueId ? "selected" : ""}>${escapeHtml(league.name)}</option>`).join("")}
            </select>
          </label>
          <label class="grid gap-1.5 text-sm font-bold uppercase tracking-[0.08em] text-steel">
            Tournament
            <select class="${INPUT_CLASSES} normal-case tracking-normal" name="tournamentId" data-cy="filter-tournament">
              <option value="">All Tournaments</option>
              ${data.leagues
                .filter((league) => !filters.leagueId || league.id === filters.leagueId)
                .flatMap((league) => league.tournaments ?? [])
                .map((tournament) => `<option value="${escapeAttribute(tournament.id)}" ${tournament.id === filters.tournamentId ? "selected" : ""}>${escapeHtml(tournament.name)}</option>`)
                .join("")}
            </select>
          </label>
          <input class="${INPUT_CLASSES}" name="opponentName" data-cy="filter-opponent" placeholder="Opponent Player Name" value="${escapeAttribute(filters.opponentName)}">
        </form>
      </section>
      <section class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3" data-cy="player-stat-list"></section>
      <section class="${PANEL_CLASSES}">
        <h2 class="m-0 text-xl leading-tight">Matches</h2>
        <div class="mt-5 grid gap-3" data-cy="player-match-list"></div>
      </section>
      ${renderBackButton()}
    </div>
  `;

  bindFilters();
  renderStats();
  bindBackButton();
}

function bindFilters() {
  const form = document.querySelector("#filters");
  form.addEventListener("submit", (event) => event.preventDefault());

  form.querySelector("[name='leagueId']").addEventListener("change", (event) => {
    filters = { ...filters, leagueId: event.currentTarget.value, tournamentId: "" };
    updateUrl();
    render();
  });

  form.querySelector("[name='tournamentId']").addEventListener("change", (event) => {
    filters = { ...filters, tournamentId: event.currentTarget.value };
    updateUrl();
    renderStats();
  });

  form.querySelector("[name='opponentName']").addEventListener("input", (event) => {
    filters = { ...filters, opponentName: event.currentTarget.value };
    updateUrl();
    renderStats();
  });
}

function renderStats() {
  const stats = calculatePlayerStatistics(data, playerName, filters);
  document.querySelector("[data-cy='player-stat-list']").innerHTML = `
    ${stat("Played Matches", stats.playedMatchCount, "Number of non-bye matches this player has played in the selected scope.")}
    ${stat("Byes", stats.byeCount, "Number of rounds where this player received a bye instead of playing an opponent.")}
    ${stat("Match Win Rate", formatPercentage(stats.matchWinrate), "Percentage of played matches this player won, excluding byes.")}
    ${stat("Game Win Rate", formatPercentage(stats.gameWinrate), "Percentage of individual games this player won across played matches, excluding byes.")}
    ${stat("Nemesis", stats.nemesis ?? "N/A", "Opponent this player performs worst against in the selected scope.")}
    ${stat("Rival", stats.rival ?? "N/A", "Opponent this player has faced most often in the selected scope.")}
  `;
  document.querySelector("[data-cy='player-match-list']").innerHTML = stats.matches.length ? stats.matches.map(renderMatch).join("") : `<p class="text-dim-ash">No Matches.</p>`;
}

function updateUrl() {
  const next = new URLSearchParams({ playerName });
  for (const key of ["leagueId", "tournamentId", "opponentName"]) {
    if (filters[key]) next.set(key, filters[key]);
  }
  history.replaceState(null, "", `player.html?${next.toString()}`);
}

function stat(label, value, description = "") {
  const tooltip = description
    ? `<span class="stat-tooltip" role="tooltip">${escapeHtml(description)}</span>`
    : "";
  return `<article class="panel p-3.5"><span class="stat-tooltip-trigger text-dim-ash" tabindex="0">${escapeHtml(label)}${tooltip}</span><strong class="block text-2xl text-ash">${escapeHtml(value)}</strong></article>`;
}

function renderMatch(match) {
  if (match.kind === "bye") {
    return `<article class="league-card" data-cy="player-match">Bye in ${escapeHtml(match.tournament.name)}, Round ${match.roundIndex + 1}</article>`;
  }
  return `<article class="league-card flex flex-wrap items-baseline gap-x-6 gap-y-1" data-cy="player-match"><strong>${escapeHtml(match.opponentName)}</strong><span>${match.ownScore}-${match.opponentScore}</span><span>Tournament: <strong>${escapeHtml(match.tournament.name)}</strong></span><span>round ${match.roundIndex + 1}</span></article>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
