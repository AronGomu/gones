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

const INPUT_CLASSES = "min-h-[38px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-900";
const PANEL_CLASSES = "rounded-lg border border-slate-200 bg-white p-[18px]";

render();

function render() {
  const app = document.querySelector("#app");
  const stats = calculatePlayerStatistics(data, playerName, filters);
  document.title = `Gones - ${playerName}`;
  app.innerHTML = `
    <div class="grid gap-[18px]">
      <section class="${PANEL_CLASSES}">
        <h1 class="m-0 text-3xl leading-tight" data-cy="player-title">${escapeHtml(playerName)}</h1>
        <form id="filters" class="flex flex-wrap items-center gap-2.5">
          <select class="${INPUT_CLASSES}" name="leagueId" data-cy="filter-league">
            <option value="">All Leagues</option>
            ${data.leagues.map((league) => `<option value="${league.id}" ${league.id === filters.leagueId ? "selected" : ""}>${escapeHtml(league.name)}</option>`).join("")}
          </select>
          <select class="${INPUT_CLASSES}" name="tournamentId" data-cy="filter-tournament">
            <option value="">All Tournaments</option>
            ${data.leagues
              .flatMap((league) => league.tournaments ?? [])
              .map((tournament) => `<option value="${tournament.id}" ${tournament.id === filters.tournamentId ? "selected" : ""}>${escapeHtml(tournament.name)}</option>`)
              .join("")}
          </select>
          <input class="${INPUT_CLASSES}" name="opponentName" data-cy="filter-opponent" placeholder="Opponent Player Name" value="${escapeAttribute(filters.opponentName)}">
          <button class="min-h-[38px] cursor-pointer rounded-md border border-teal-700 bg-teal-700 px-3 py-2 font-semibold text-white" type="submit">Apply</button>
        </form>
      </section>
      <section class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        ${stat("Played Match Count", stats.playedMatchCount)}
        ${stat("Bye Count", stats.byeCount)}
        ${stat("Match Winrate", formatPercentage(stats.matchWinrate))}
        ${stat("Game Winrate", formatPercentage(stats.gameWinrate))}
        ${stat("Nemesis", stats.nemesis ?? "N/A")}
        ${stat("Rival", stats.rival ?? "N/A")}
      </section>
      <section class="${PANEL_CLASSES}">
        <h2 class="m-0 text-xl leading-tight">Matches</h2>
        <div class="mt-5 grid gap-3" data-cy="player-match-list">
          ${stats.matches.length ? stats.matches.map(renderMatch).join("") : `<p class="text-slate-500">No Matches.</p>`}
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
  return `<article class="rounded-lg border border-slate-200 bg-white p-3.5"><span class="text-slate-500">${label}</span><strong class="block text-2xl">${escapeHtml(value)}</strong></article>`;
}

function renderMatch(match) {
  if (match.kind === "bye") {
    return `<article class="grid gap-2 rounded-lg border border-slate-200 bg-white p-[18px]" data-cy="player-match">Bye in ${escapeHtml(match.tournament.name)}, Round ${match.roundIndex + 1}</article>`;
  }
  return `<article class="grid gap-2 rounded-lg border border-slate-200 bg-white p-[18px]" data-cy="player-match">${escapeHtml(match.opponentName)} · ${match.ownScore}-${match.opponentScore} · ${escapeHtml(match.tournament.name)}, Round ${match.roundIndex + 1}</article>`;
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
