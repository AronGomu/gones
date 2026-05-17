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
  opponentName: ""
};
let matchSearch = "";
let matchSortDirection = "desc";

const INPUT_CLASSES = "field";
const PANEL_CLASSES = "panel";

render();

function render() {
  const app = document.querySelector("#app");
  document.title = `Gones - ${playerName}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      ${renderBackButton()}
      <section class="${PANEL_CLASSES}">
        <h1 class="page-title" data-cy="player-title">${escapeHtml(playerName)}</h1>
      </section>
      <section class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3" data-cy="player-stat-list"></section>
      <section class="${PANEL_CLASSES}">
        <div class="section-header">
          <h2 class="m-0 text-xl leading-tight">Matches</h2>
          <div class="flex flex-wrap items-center gap-2.5">
            <input class="${INPUT_CLASSES}" name="matchSearch" data-cy="filter-matches" placeholder="Filter matches" value="${escapeAttribute(matchSearch)}">
            <button type="button" class="button-secondary" data-action="toggle-match-sort" data-cy="toggle-match-sort" aria-label="Sort matches by date ${matchSortDirection === "asc" ? "descending" : "ascending"}">
              Date ${matchSortDirection === "asc" ? "ascending ↑" : "descending ↓"}
            </button>
          </div>
        </div>
        <div class="mt-5" data-cy="player-match-list"></div>
      </section>
      ${renderBackButton()}
    </div>
  `;

  bindMatchControls();
  renderStats();
  bindBackButton();
}

function bindMatchControls() {
  document.querySelector("[data-cy='filter-matches']").addEventListener("input", (event) => {
    matchSearch = event.currentTarget.value;
    renderStats();
  });

  document.querySelector("[data-action='toggle-match-sort']").addEventListener("click", () => {
    matchSortDirection = matchSortDirection === "asc" ? "desc" : "asc";
    render();
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
  const matches = stats.matches.filter(matchesSearch).sort(compareMatchesByDate);
  document.querySelector("[data-cy='player-match-list']").innerHTML = matches.length ? renderMatchTable(matches) : `<p class="text-dim-ash">No Matches.</p>`;
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

function renderMatchTable(matches) {
  return `
    <table class="table-shell" data-cy="player-match-table">
      <thead>
        <tr>
          <th class="table-head-cell">date match</th>
          <th class="table-head-cell">tournament</th>
          <th class="table-head-cell">opponent</th>
          <th class="table-head-cell">result</th>
        </tr>
      </thead>
      <tbody>${matches.map(renderMatchRow).join("")}</tbody>
    </table>`;
}

function renderMatchRow(match) {
  const cells = matchCells(match);
  const outcomeClass = matchOutcomeClass(match);
  const opponentHref = match.kind === "bye" ? "" : playerStatsHref(match.opponentName, match);
  const clickableAttributes = opponentHref
    ? `class="${outcomeClass} table-clickable-row" data-href="${escapeAttribute(opponentHref)}" tabindex="0" role="link" aria-label="Open Player Statistics for ${escapeAttribute(match.opponentName)}" onclick="location.href = this.dataset.href" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); location.href = this.dataset.href; }"`
    : `class="${outcomeClass}"`;
  return `<tr ${clickableAttributes} data-cy="player-match"><td class="table-cell">${escapeHtml(cells.date)}</td><td class="table-cell">${escapeHtml(cells.tournament)}</td><td class="table-cell">${opponentHref ? `<a class="text-link" href="${escapeAttribute(opponentHref)}">${escapeHtml(cells.opponent)}</a>` : escapeHtml(cells.opponent)}</td><td class="table-cell">${escapeHtml(cells.result)}</td></tr>`;
}

function playerStatsHref(playerName, match) {
  const next = new URLSearchParams({ playerName });
  if (match.league?.id) next.set("leagueId", match.league.id);
  if (match.tournament?.id) next.set("tournamentId", match.tournament.id);
  return `player.html?${next.toString()}`;
}

function matchOutcomeClass(match) {
  if (match.kind === "bye") return "match-row-win";
  if (match.ownScore > match.opponentScore) return "match-row-win";
  if (match.ownScore < match.opponentScore) return "match-row-loss";
  return "";
}

function matchCells(match) {
  if (match.kind === "bye") {
    return {
      date: match.tournament.tournamentDate || "No date",
      tournament: `${match.league.name} ${match.tournament.name} Round ${match.roundIndex + 1}`,
      opponent: "Bye",
      result: "Won 2-0"
    };
  }
  return {
    date: match.tournament.tournamentDate || "No date",
    tournament: `${match.league.name} ${match.tournament.name} Round ${match.roundIndex + 1}`,
    opponent: match.opponentName,
    result: formatMatchResult(match)
  };
}

function formatMatchResult(match) {
  const label = match.ownScore > match.opponentScore ? "Won" : match.ownScore < match.opponentScore ? "Lose" : "Draw";
  return `${label} ${match.ownScore}-${match.opponentScore}`;
}

function compareMatchesByDate(left, right) {
  const leftDate = left.tournament.tournamentDate || "9999-12-31";
  const rightDate = right.tournament.tournamentDate || "9999-12-31";
  const byDate = leftDate.localeCompare(rightDate) || left.tournament.name.localeCompare(right.tournament.name) || left.roundIndex - right.roundIndex;
  return matchSortDirection === "asc" ? byDate : -byDate;
}

function matchesSearch(match) {
  const search = matchSearch.trim().toLocaleLowerCase();
  if (!search) return true;
  const cells = matchCells(match);
  const haystack = Object.values(cells).join(" ").toLocaleLowerCase();
  return search.split(/\s+/).every((token) => haystack.includes(token));
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
