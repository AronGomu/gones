import { importRoundEntries } from "../domain/round-import.js";
import { validateRoundEntry } from "../domain/validation.js";

const BUTTON_PRIMARY = "button-primary";
const BUTTON_SECONDARY = "button-secondary";
const BUTTON_CREATE = "button-create";
const BUTTON_DANGER = "button-danger";
const INPUT_CLASSES = "field";

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
    <section class="panel grid gap-3.5" data-cy="round" data-round-id="${round.id}">
      <header class="section-header">
        <h3 class="m-0 text-base font-bold leading-tight">Round ${roundIndex + 1}</h3>
        <div class="flex flex-wrap items-center gap-2.5">
          <button type="button" class="${BUTTON_CREATE}" data-action="add-match" data-round-id="${round.id}" data-cy="add-match">+ Match</button>
          <button type="button" class="${BUTTON_CREATE}" data-action="add-bye" data-round-id="${round.id}" data-cy="add-bye">+ Bye</button>
          <button type="button" class="${BUTTON_DANGER}" data-action="delete-round" data-round-id="${round.id}" data-cy="delete-round">Delete</button>
        </div>
      </header>
      <div class="grid gap-2.5">
        <textarea class="field min-h-[78px] w-full resize-y" data-cy="round-import" data-round-id="${round.id}" placeholder="player_1,player_2,player_1_score,player_2_score"></textarea>
        <button type="button" class="${BUTTON_PRIMARY} min-h-[52px] w-full px-6 text-lg" data-action="import-round" data-round-id="${round.id}" data-cy="import-round">Import</button>
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
      ? "round-entry grid grid-cols-[minmax(180px,1fr)_auto_38px] max-[760px]:grid-cols-1"
      : "round-entry grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_72px_72px_38px] max-[760px]:grid-cols-1",
    validation.valid ? "" : "round-entry-invalid",
    warningCodes.length ? "round-entry-warning" : ""
  ].join(" ");
  const fields = entry.kind === "bye" ? renderByeFields(entry) : renderMatchFields(entry);
  const status = [
    ...validation.codes.map(validationText),
    ...warningCodes.map(warningText)
  ].filter(Boolean);

  return `
    <div class="${classes}" data-cy="round-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-kind="${entry.kind}">
      ${fields}
      <button type="button" class="button-danger min-h-[38px] w-[38px] p-0" title="Delete entry" data-action="delete-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-cy="delete-entry">x</button>
      ${status.length ? `<p class="col-span-full m-0 text-sm text-[oklch(82%_0.1_58)]" data-cy="entry-status">${status.join(", ")}</p>` : ""}
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
    <span class="inline-flex min-h-[38px] items-center text-dim-ash">Bye</span>
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
