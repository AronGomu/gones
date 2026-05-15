import { importRoundEntries } from "../domain/round-import.js";
import { validateRoundEntry } from "../domain/validation.js";

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
    <section class="round-editor" data-cy="round" data-round-id="${round.id}">
      <header class="round-header">
        <h3>Round ${roundIndex + 1}</h3>
        <div class="button-row">
          <button type="button" class="secondary" data-action="add-match" data-round-id="${round.id}" data-cy="add-match">+ Match</button>
          <button type="button" class="secondary" data-action="add-bye" data-round-id="${round.id}" data-cy="add-bye">+ Bye</button>
          <button type="button" class="danger" data-action="delete-round" data-round-id="${round.id}" data-cy="delete-round">Delete</button>
        </div>
      </header>
      <div class="import-box">
        <textarea data-cy="round-import" data-round-id="${round.id}" placeholder="player_1,player_2,player_1_score,player_2_score"></textarea>
        <button type="button" data-action="import-round" data-round-id="${round.id}" data-cy="import-round">Replace Round</button>
      </div>
      <div class="entry-list">
        ${(round.entries ?? []).map((entry) => renderEntry(round.id, entry, warningByEntryId.get(entry.id) ?? [])).join("")}
      </div>
    </section>
  `;
}

function renderEntry(roundId, entry, warningCodes) {
  const validation = validateRoundEntry(entry);
  const classes = ["entry-row", validation.valid ? "" : "is-invalid", warningCodes.length ? "has-warning" : ""].join(" ");
  const fields = entry.kind === "bye" ? renderByeFields(entry) : renderMatchFields(entry);
  const status = [
    ...validation.codes.map(validationText),
    ...warningCodes.map(warningText)
  ].filter(Boolean);

  return `
    <div class="${classes}" data-cy="round-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-kind="${entry.kind}">
      ${fields}
      <button type="button" class="icon-button danger" title="Delete entry" data-action="delete-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-cy="delete-entry">x</button>
      ${status.length ? `<p class="entry-status" data-cy="entry-status">${status.join(", ")}</p>` : ""}
    </div>
  `;
}

function renderMatchFields(entry) {
  return `
    <input data-field="player1Name" aria-label="Player 1" value="${escapeAttribute(entry.player1Name ?? "")}">
    <input data-field="player2Name" aria-label="Player 2" value="${escapeAttribute(entry.player2Name ?? "")}">
    <input data-field="player1Score" class="score-input" aria-label="Player 1 score" value="${escapeAttribute(entry.player1Score ?? "")}">
    <input data-field="player2Score" class="score-input" aria-label="Player 2 score" value="${escapeAttribute(entry.player2Score ?? "")}">
  `;
}

function renderByeFields(entry) {
  return `
    <input data-field="playerName" aria-label="Player name" value="${escapeAttribute(entry.playerName ?? "")}">
    <span class="bye-label">Bye</span>
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

