import { importRoundEntries } from "../domain/round-import.js";
import { validateRoundEntry } from "../domain/validation.js";

const BUTTON_PRIMARY = "min-h-[38px] cursor-pointer rounded-md border border-teal-700 bg-teal-700 px-3 py-2 font-semibold text-white";
const BUTTON_SECONDARY = "min-h-[38px] cursor-pointer rounded-md border border-teal-700 bg-white px-3 py-2 font-semibold text-teal-800";
const BUTTON_DANGER = "min-h-[38px] cursor-pointer rounded-md border border-red-700 bg-white px-3 py-2 font-semibold text-red-700";
const INPUT_CLASSES = "min-h-[38px] rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-900";

export function renderRoundEditor(round, roundIndex, warnings = []) {
  const warningByEntryId = new Map();
  for (const warning of warnings) {
    for (const entryId of warning.entryIds ?? []) {
      const list = warningByEntryId.get(entryId) ?? [];
      list.push(warning.code);
      warningByEntryId.set(entryId, list);
    }
  }

  return `
    <section class="grid gap-3.5 rounded-lg border border-slate-200 bg-white p-[18px]" data-cy="round" data-round-id="${round.id}">
      <header class="flex items-start justify-between gap-[18px] max-[760px]:grid max-[760px]:grid-cols-1">
        <h3 class="m-0 text-base leading-tight">Round ${roundIndex + 1}</h3>
        <div class="flex flex-wrap items-center gap-2.5">
          <button type="button" class="${BUTTON_SECONDARY}" data-action="add-match" data-round-id="${round.id}" data-cy="add-match">+ Match</button>
          <button type="button" class="${BUTTON_SECONDARY}" data-action="add-bye" data-round-id="${round.id}" data-cy="add-bye">+ Bye</button>
          <button type="button" class="${BUTTON_DANGER}" data-action="delete-round" data-round-id="${round.id}" data-cy="delete-round">Delete</button>
        </div>
      </header>
      <div class="grid grid-cols-[1fr_auto] items-start gap-2.5 max-[760px]:grid-cols-1">
        <textarea class="min-h-[78px] w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-slate-900" data-cy="round-import" data-round-id="${round.id}" placeholder="player_1,player_2,player_1_score,player_2_score"></textarea>
        <button type="button" class="${BUTTON_PRIMARY}" data-action="import-round" data-round-id="${round.id}" data-cy="import-round">Replace Round</button>
      </div>
      <div class="grid gap-2">
        ${(round.entries ?? []).map((entry) => renderEntry(round.id, entry, warningByEntryId.get(entry.id) ?? [])).join("")}
      </div>
    </section>
  `;
}

function renderEntry(roundId, entry, warningCodes) {
  const validation = validateRoundEntry(entry);
  const classes = [
    entry.kind === "bye"
      ? "grid grid-cols-[minmax(180px,1fr)_auto_38px] items-start gap-2 rounded-md border border-slate-200 p-2 max-[760px]:grid-cols-1"
      : "grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_72px_72px_38px] items-start gap-2 rounded-md border border-slate-200 p-2 max-[760px]:grid-cols-1",
    validation.valid ? "" : "border-red-300 bg-red-50",
    warningCodes.length ? "border-yellow-400 bg-yellow-50" : ""
  ].join(" ");
  const fields = entry.kind === "bye" ? renderByeFields(entry) : renderMatchFields(entry);
  const status = [
    ...validation.codes.map(validationText),
    ...warningCodes.map(warningText)
  ].filter(Boolean);

  return `
    <div class="${classes}" data-cy="round-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-kind="${entry.kind}">
      ${fields}
      <button type="button" class="min-h-[38px] w-[38px] cursor-pointer rounded-md border border-red-700 bg-white p-0 font-semibold text-red-700" title="Delete entry" data-action="delete-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-cy="delete-entry">x</button>
      ${status.length ? `<p class="col-span-full m-0 text-sm text-yellow-700" data-cy="entry-status">${status.join(", ")}</p>` : ""}
    </div>
  `;
}

function renderMatchFields(entry) {
  return `
    <input class="${INPUT_CLASSES}" data-field="player1Name" aria-label="Player 1" value="${escapeAttribute(entry.player1Name ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="player2Name" aria-label="Player 2" value="${escapeAttribute(entry.player2Name ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="player1Score" aria-label="Player 1 score" value="${escapeAttribute(entry.player1Score ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="player2Score" aria-label="Player 2 score" value="${escapeAttribute(entry.player2Score ?? "")}">
  `;
}

function renderByeFields(entry) {
  return `
    <input class="${INPUT_CLASSES}" data-field="playerName" aria-label="Player name" value="${escapeAttribute(entry.playerName ?? "")}">
    <span class="inline-flex min-h-[38px] items-center text-slate-500">Bye</span>
  `;
}

export function replaceRoundEntriesFromText(round, text, { idFactory } = {}) {
  round.entries = importRoundEntries(text, { idFactory }).entries;
}

function validationText(code) {
  return {
    invalidRoundEntry: "Invalid Round Entry",
    playerNameRequired: "Player Name required",
    player1NameRequired: "Player 1 required",
    player2NameRequired: "Player 2 required",
    byeReservedPlayerName: "bye is reserved",
    byeReservedPlayer1Name: "bye is reserved",
    byeReservedPlayer2Name: "bye is reserved",
    samePlayerName: "same Player Name",
    player1ScoreInvalid: "Player 1 score invalid",
    player2ScoreInvalid: "Player 2 score invalid",
    drawScoreInvalid: "draw must be 0-0 or 1-1"
  }[code] ?? code;
}

function warningText(code) {
  return {
    repeatedPairing: "repeated pairing",
    duplicateSameRoundPlayerName: "Player Name appears multiple times",
    multipleByesInRound: "multiple Byes"
  }[code] ?? code;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
