import { createLeague } from "../domain/models.js";
import { calculateLeagueResult } from "../domain/results.js";
import { loadData, saveData } from "../storage/league-store.js";

let data = loadData();

const LIST_ITEM_CLASSES = "grid gap-2 rounded-lg border border-slate-200 bg-white p-[18px]";
const SECTION_HEADER_CLASSES = "flex items-start justify-between gap-[18px] max-[760px]:grid max-[760px]:grid-cols-1";

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
    list.innerHTML = `<p class="text-slate-500" data-cy="empty-leagues">No Leagues yet.</p>`;
    return;
  }

  list.innerHTML = data.leagues
    .map((league) => {
      const result = calculateLeagueResult(league);
      const tournamentCount = league.tournaments?.length ?? 0;
      return `
        <article class="${LIST_ITEM_CLASSES}" data-cy="league-list-item">
          <div class="${SECTION_HEADER_CLASSES}">
            <div>
              <h2 class="m-0 text-xl leading-tight"><a class="text-teal-800 hover:underline" href="league.html?leagueId=${encodeURIComponent(league.id)}">${escapeHtml(league.name)}</a></h2>
              <p class="text-slate-500">${tournamentCount} tournament${tournamentCount === 1 ? "" : "s"} · ${result.rows.length ? `${result.rows.length} players` : "No League Result"}</p>
            </div>
            <a class="inline-flex min-h-[38px] items-center justify-center rounded-md border border-teal-700 bg-white px-3 py-2 font-semibold text-teal-800 hover:underline" data-cy="open-league" href="league.html?leagueId=${encodeURIComponent(league.id)}">Open</a>
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
