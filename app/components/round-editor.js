import { importRoundEntries } from "../domain/round-import.js";
import { validateRoundEntry } from "../domain/validation.js";

const INPUT_CLASSES = "field w-full";
const BUTTON_PRIMARY = "button-primary";
const BUTTON_CREATE = "button-create";
const BUTTON_DANGER = "button-danger";

export function renderRoundEditor(round, roundIndex, warnings = [], { collapsed = false } = {}) {
  const warningByEntryId = new Map();
  for (const warning of warnings.filter((item) => item.roundId === round.id)) {
    for (const entryId of warning.entryIds ?? []) {
      const list = warningByEntryId.get(entryId) ?? [];
      list.push(warning.code);
      warningByEntryId.set(entryId, list);
    }
  }

  const hasMissingBye = warnings.some((warning) => warning.roundId === round.id && warning.code === "missingBye");

  return `
    <section class="panel grid gap-3.5 ${hasMissingBye ? "border-blood" : ""}" data-cy="round" data-round-id="${round.id}">
      <div class="section-header">
        <button type="button" class="group flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-ash" data-action="toggle-round-collapse" data-round-id="${round.id}" data-cy="toggle-round-collapse" aria-expanded="${collapsed ? "false" : "true"}">
          <span class="inline-flex size-7 items-center justify-center bg-transparent text-lg text-steel transition-colors group-hover:text-ash" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
          <h3 class="m-0 text-base font-bold leading-tight">Round ${roundIndex + 1}</h3>
        </button>
        ${hasMissingBye ? `<div class="warning-message" data-cy="missing-bye-warning"><span aria-hidden="true">⚠</span> Missing bye match. Click Add Missing Byes Matches at the top of the page.</div>` : ""}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="${BUTTON_DANGER}" data-action="delete-round" data-round-id="${round.id}" data-cy="delete-round">Delete</button>
        </div>
      </div>
      ${collapsed ? "" : `
        <div class="grid gap-2 md:grid-cols-[1fr_auto]">
          <textarea class="field min-h-[78px] w-full resize-y" data-cy="round-import" data-round-id="${round.id}" placeholder="Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist"></textarea>
          <button type="button" class="${BUTTON_PRIMARY} min-h-[52px] w-full px-6 text-lg" data-action="import-round" data-round-id="${round.id}" data-cy="import-round">Import</button>
        </div>
        <div class="grid gap-2" data-cy="round-entries">
          <div class="round-entry-header" data-cy="round-entry-header">
            <span>Table</span>
            <span>Player 1</span>
            <span>Deck archetype</span>
            <span>Result</span>
            <span>Player 2</span>
            <span>Deck archetype</span>
            <span></span>
          </div>
          ${(round.entries ?? []).map((entry) => renderEntry(round.id, entry, warningByEntryId.get(entry.id) ?? [])).join("")}
        </div>
        <div class="flex justify-start">
          <button type="button" class="${BUTTON_CREATE}" data-action="add-match" data-round-id="${round.id}" data-cy="add-match">Add Match</button>
        </div>`}
    </section>`;
}

function renderEntry(roundId, entry, warningCodes) {
  const validation = validateRoundEntry(entry);
  const classes = [
    "round-entry grid grid-cols-[64px_minmax(120px,1fr)_minmax(120px,1fr)_120px_minmax(120px,1fr)_minmax(120px,1fr)_auto] max-[760px]:grid-cols-1",
    validation.valid ? "" : "round-entry-invalid",
    warningCodes.length ? "round-entry-warning" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="${classes}" data-cy="round-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-kind="${entry.kind}">
      ${renderMatchFields(entry)}
      <button type="button" class="button-danger min-h-[38px] whitespace-nowrap" title="Delete match" data-action="delete-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-cy="delete-entry">Delete Match</button>
      ${renderMessages(validation.codes, warningCodes)}
    </div>`;
}

function renderMatchFields(entry) {
  return `
    <input class="${INPUT_CLASSES}" value="${escapeAttribute(entry.table ?? "")}" aria-label="Table" readonly disabled>
    <input class="${INPUT_CLASSES}" data-field="player" aria-label="Player 1" value="${escapeAttribute(entry.player ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="playerDecklist" aria-label="Player 1 deck archetype" placeholder="deck archetype" value="${escapeAttribute(entry.playerDecklist ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="result" aria-label="Result" placeholder="Won 2-0" value="${escapeAttribute(entry.result ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="opponent" aria-label="Player 2" value="${escapeAttribute(entry.opponent ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="opponentDecklist" aria-label="Player 2 deck archetype" placeholder="deck archetype" value="${escapeAttribute(entry.opponentDecklist ?? "")}">`;
}

export function replaceRoundEntriesFromText(round, text, { idFactory } = {}) {
  round.entries = importRoundEntries(text, { idFactory }).entries;
}

function renderMessages(validationCodes, warningCodes) {
  const labels = {
    invalidRoundEntry: "Invalid row",
    playerRequired: "Player required",
    opponentRequired: "Opponent required",
    samePlayerName: "same player on both sides",
    resultInvalid: "Result invalid",
    byeReservedPlayerName: "bye is reserved",
    byeReservedOpponentName: "bye is reserved",
    repeatedPairing: "repeated pairing",
    duplicateSameRoundPlayerName: "player appears multiple times in this round"
  };
  const messages = [...validationCodes, ...warningCodes].map((code) => labels[code] ?? code);
  if (!messages.length) return "";
  return `<div class="col-span-full text-sm font-bold text-blood" data-cy="entry-message">${messages.map(escapeHtml).join(", ")}</div>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
