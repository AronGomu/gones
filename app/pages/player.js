import { calculatePlayerStatistics } from "../domain/player-stats.js";
import { formatPercentage } from "../components/ranking-table.js";
import { loadData } from "../storage/league-store.js";

const data = loadData();
const params = new URLSearchParams(location.search);
const playerName = params.get("playerName") ?? "";
const filters = {
  leagueId: params.get("leagueId") ?? "",
  tournamentId: params.get("tournamentId") ?? "",
  opponentName: params.get("opponentName") ?? ""
};

render();

function render() {
  const app = document.querySelector("#app");
  const stats = calculatePlayerStatistics(data, playerName, filters);
  document.title = `Gones - ${playerName}`;
  app.innerHTML = `
    <div class="stack">
      <section class="panel">
        <h1 data-cy="player-title">${escapeHtml(playerName)}</h1>
        <form id="filters" class="field-row">
          <select name="leagueId" data-cy="filter-league">
            <option value="">All Leagues</option>
            ${data.leagues.map((league) => `<option value="${league.id}" ${league.id === filters.leagueId ? "selected" : ""}>${escapeHtml(league.name)}</option>`).join("")}
          </select>
          <select name="tournamentId" data-cy="filter-tournament">
            <option value="">All Tournaments</option>
            ${data.leagues
              .flatMap((league) => league.tournaments ?? [])
              .map((tournament) => `<option value="${tournament.id}" ${tournament.id === filters.tournamentId ? "selected" : ""}>${escapeHtml(tournament.name)}</option>`)
              .join("")}
          </select>
          <input name="opponentName" data-cy="filter-opponent" placeholder="Opponent Player Name" value="${escapeAttribute(filters.opponentName)}">
          <button type="submit">Apply</button>
        </form>
      </section>
      <section class="stat-grid">
        ${stat("Played Match Count", stats.playedMatchCount)}
        ${stat("Bye Count", stats.byeCount)}
        ${stat("Match Winrate", formatPercentage(stats.matchWinrate))}
        ${stat("Game Winrate", formatPercentage(stats.gameWinrate))}
        ${stat("Nemesis", stats.nemesis ?? "N/A")}
        ${stat("Rival", stats.rival ?? "N/A")}
      </section>
      <section class="panel">
        <h2>Matches</h2>
        <div class="list" data-cy="player-match-list">
          ${stats.matches.length ? stats.matches.map(renderMatch).join("") : `<p class="empty-state">No Matches.</p>`}
        </div>
      </section>
    </div>
  `;

  document.querySelector("#filters").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams({ playerName });
    for (const key of ["leagueId", "tournamentId", "opponentName"]) {
      const value = form.get(key);
      if (value) next.set(key, value);
    }
    location.href = `player.html?${next.toString()}`;
  });
}

function stat(label, value) {
  return `<article class="stat"><span class="muted">${label}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderMatch(match) {
  if (match.kind === "bye") {
    return `<article class="list-item" data-cy="player-match">Bye in ${escapeHtml(match.tournament.name)}, Round ${match.roundIndex + 1}</article>`;
  }
  return `<article class="list-item" data-cy="player-match">${escapeHtml(match.opponentName)} · ${match.ownScore}-${match.opponentScore} · ${escapeHtml(match.tournament.name)}, Round ${match.roundIndex + 1}</article>`;
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

