import { createLeague } from "../domain/models.js";
import { calculateLeagueResult } from "../domain/results.js";
import { loadData, saveData } from "../storage/league-store.js";

let data = loadData();

document.querySelector("#create-league-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const league = createLeague({ name: form.get("name") });
  data.leagues.push(league);
  saveData(data);
  location.href = `league.html?leagueId=${encodeURIComponent(league.id)}`;
});

render();

function render() {
  const list = document.querySelector("#league-list");
  if (!data.leagues.length) {
    list.innerHTML = `<p class="empty-state" data-cy="empty-leagues">No Leagues yet.</p>`;
    return;
  }

  list.innerHTML = data.leagues
    .map((league) => {
      const result = calculateLeagueResult(league);
      const tournamentCount = league.tournaments?.length ?? 0;
      return `
        <article class="list-item" data-cy="league-list-item">
          <div class="section-header">
            <div>
              <h2><a href="league.html?leagueId=${encodeURIComponent(league.id)}">${escapeHtml(league.name)}</a></h2>
              <p class="muted">${tournamentCount} tournament${tournamentCount === 1 ? "" : "s"} · ${result.rows.length ? `${result.rows.length} players` : "No League Result"}</p>
            </div>
            <a class="button-link" data-cy="open-league" href="league.html?leagueId=${encodeURIComponent(league.id)}">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

