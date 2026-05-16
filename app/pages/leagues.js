import { createLeague } from "../domain/models.js";
import { restoreLeague } from "../domain/export-restore.js";
import { calculateLeagueResult } from "../domain/results.js";
import { loadData, saveData } from "../storage/league-store.js";
import { bindBackButton } from "../components/back-button.js";

let data = loadData();
let searchTerm = "";

const LAST_LEAGUE_KEY = "gones_last_league_id";
const dialog = document.querySelector("#create-league-dialog");
const createForm = document.querySelector("#create-league-form");
const leagueNameInput = document.querySelector("#new-league-name");

document.querySelector("#league-search").addEventListener("input", (event) => {
  searchTerm = event.currentTarget.value.trim().toLowerCase();
  render();
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const league = createLeague({ name: form.get("name") });
  data.leagues.unshift(league);
  saveData(data);
  localStorage.setItem(LAST_LEAGUE_KEY, league.id);
  location.href = `league.html?leagueId=${encodeURIComponent(league.id)}`;
});

document.querySelector("[data-action='restore']").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const status = document.querySelector("#restore-status");
  const file = input.files?.[0];
  if (!file) return;
  if (!isSupportedImportFile(file)) {
    status.textContent = "Import League supports only .json files.";
    input.value = "";
    return;
  }

  try {
    const restored = restoreLeague(JSON.parse(await file.text()), { existingLeagues: data.leagues });
    data.leagues.unshift(restored);
    saveData(data);
    localStorage.setItem(LAST_LEAGUE_KEY, restored.id);
    location.href = `league.html?leagueId=${encodeURIComponent(restored.id)}`;
  } catch {
    status.textContent = "That file is not a supported Gones Export.";
    input.value = "";
  }
});

function isSupportedImportFile(file) {
  return file.name.toLowerCase().endsWith(".json");
}

document.querySelector("[data-action='open-create-dialog']").addEventListener("click", openCreateDialog);

document.querySelectorAll("[data-action='close-create-dialog']").forEach((button) => {
  button.addEventListener("click", closeCreateDialog);
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeCreateDialog();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dialog.classList.contains("hidden")) closeCreateDialog();
});

bindBackButton();
render();

function render() {
  renderFeaturedLeague();
  const list = document.querySelector("#league-list");
  if (!data.leagues.length) {
    list.innerHTML = `
      <div class="panel grid gap-3 text-dim-ash" data-cy="empty-leagues">
        <p class="text-base font-semibold text-ash">No Leagues yet.</p>
        <p class="max-w-[64ch] text-sm">Organizers can create the first League here. Players can restore a Gones Export from the archive panel above.</p>
      </div>
    `;
    return;
  }

  const leagues = getSortedLeagues().filter((league) => league.name.toLowerCase().includes(searchTerm));
  if (!leagues.length) {
    list.innerHTML = `
      <div class="panel grid gap-2 text-dim-ash">
        <p class="font-semibold text-ash">No matching Leagues.</p>
        <p class="text-sm">Clear the search to return to the full ledger.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="league-card-grid" data-cy="league-card-grid">
      ${leagues.map((league) => renderLeagueCard(league)).join("")}
    </div>
  `;
}

function renderFeaturedLeague() {
  const section = document.querySelector("#featured-league-section");
  const league = getFeaturedLeague();
  if (!league) {
    section.innerHTML = "";
    return;
  }

  section.innerHTML = `
    <div class="flex items-center justify-between gap-4">
      <h2 id="current-league-title" class="kicker">Last consulted league</h2>
    </div>
    ${renderLeagueCard(league, { featured: true })}
  `;
}

function renderLeagueCard(league, { featured = false } = {}) {
  const result = calculateLeagueResult(league);
  const tournamentCount = league.tournaments?.length ?? 0;
  const playerCount = result.rows.length;
  const href = `league.html?leagueId=${encodeURIComponent(league.id)}`;
  const status = league.status === "finished" ? "finished" : "active";
  const statusLabel = status === "finished" ? "Finished" : "Active";
  const cardClass = featured ? "featured-league-card" : "league-card h-[320px] content-between gap-5 p-5";
  const titleClass = featured ? "m-0 text-3xl font-extrabold leading-tight text-ash md:text-4xl" : "m-0 text-2xl font-extrabold leading-tight text-ash";
  const description = featured
    ? "Continue with tournament entry, ranking review, source data, and player statistics from the same place."
    : leagueDescription({ tournamentCount, playerCount, status });
  const metricClass = featured ? "metric-box" : "";

  return `
    <a class="group ${cardClass}" href="${href}" data-cy="${featured ? "featured-league-card" : "league-list-item"}">
      <div class="grid content-between gap-6">
        <div class="grid gap-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <h3 class="${titleClass} line-clamp-2">${escapeHtml(league.name)}</h3>
            ${renderLeagueStatus(statusLabel, status)}
          </div>
          <p class="max-w-[62ch] text-sm text-dim-ash ${featured ? "md:text-base" : ""}">${description}</p>
        </div>

      </div>

      <div class="grid grid-cols-[1fr_auto] items-end gap-3">
      <dl class="grid flex-1 grid-cols-2 gap-3 ${featured ? "md:grid-cols-1" : ""}">
        <div class="${metricClass}">
          <dt class="metric-label">Tournaments</dt>
          <dd class="metric-value">${tournamentCount}</dd>
        </div>
        <div class="${metricClass}">
          <dt class="metric-label">Players</dt>
          <dd class="metric-value">${playerCount}</dd>
        </div>
      </dl>
      <span class="open-affordance self-end justify-self-end" data-cy="open-league" aria-hidden="true">→</span>
      </div>
    </a>
  `;
}

function leagueDescription({ tournamentCount, playerCount, status }) {
  if (status === "finished") return "Finished League data is preserved for standings review and Player Statistics.";
  if (!tournamentCount) return "Created and ready for the first Tournament import or manual entry.";
  if (playerCount) return "Tournament data is ready for standings review and Player Statistics.";
  return "Tournament source data is present, with no calculated League Result yet.";
}

function renderLeagueStatus(label, status) {
  return `
    <span class="league-status league-status-${status}">
      <span class="league-status-dot" aria-hidden="true"></span>
      ${label}
    </span>
  `;
}

function getFeaturedLeague() {
  const lastLeagueId = localStorage.getItem(LAST_LEAGUE_KEY);
  return data.leagues.find((item) => item.id === lastLeagueId) ?? getSortedLeagues()[0] ?? null;
}

function getSortedLeagues() {
  return [...data.leagues];
}

function openCreateDialog() {
  dialog.classList.remove("hidden");
  createForm.reset();
  requestAnimationFrame(() => leagueNameInput.focus());
}

function closeCreateDialog() {
  dialog.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
