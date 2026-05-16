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

  return `
    <section class="panel grid gap-3.5" data-cy="round" data-round-id="${round.id}">
      <div class="section-header">
        <button type="button" class="group flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-ash" data-action="toggle-round-collapse" data-round-id="${round.id}" data-cy="toggle-round-collapse" aria-expanded="${collapsed ? "false" : "true"}">
          <span class="inline-flex size-7 items-center justify-center bg-transparent text-lg text-steel transition-colors group-hover:text-ash" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
          <h3 class="m-0 text-base font-bold leading-tight">Round ${roundIndex + 1}</h3>
        </button>
        <div class="flex flex-wrap gap-2 ${collapsed ? "hidden" : ""}">
          <button type="button" class="${BUTTON_CREATE}" data-action="add-match" data-round-id="${round.id}" data-cy="add-match">+ Match</button>
          <button type="button" class="${BUTTON_DANGER}" data-action="delete-round" data-round-id="${round.id}" data-cy="delete-round">Delete</button>
        </div>
      </div>
      ${collapsed ? "" : `
        <div class="grid gap-2 md:grid-cols-[1fr_auto]">
          <textarea class="field min-h-[78px] w-full resize-y" data-cy="round-import" data-round-id="${round.id}" placeholder="Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist"></textarea>
          <button type="button" class="${BUTTON_PRIMARY} min-h-[52px] w-full px-6 text-lg" data-action="import-round" data-round-id="${round.id}" data-cy="import-round">Import</button>
        </div>
        <div class="grid gap-2" data-cy="round-entries">
          ${(round.entries ?? []).map((entry) => renderEntry(round.id, entry, warningByEntryId.get(entry.id) ?? [])).join("")}
        </div>`}
    </section>`;
}

function renderEntry(roundId, entry, warningCodes) {
  const validation = validateRoundEntry(entry);
  const classes = [
    "round-entry grid grid-cols-[64px_minmax(120px,1fr)_120px_minmax(120px,1fr)_38px] max-[760px]:grid-cols-1",
    validation.valid ? "" : "round-entry-invalid",
    warningCodes.length ? "round-entry-warning" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="${classes}" data-cy="round-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-kind="${entry.kind}">
      ${renderMatchFields(entry)}
      <button type="button" class="button-danger min-h-[38px] w-[38px] p-0" title="Delete entry" data-action="delete-entry" data-round-id="${roundId}" data-entry-id="${entry.id}" data-cy="delete-entry">x</button>
      ${renderMessages(validation.codes, warningCodes)}
    </div>`;
}

function renderMatchFields(entry) {
  return `
    <input class="${INPUT_CLASSES}" value="${escapeAttribute(entry.table ?? "")}" aria-label="Table" readonly disabled>
    <input class="${INPUT_CLASSES}" data-field="player" aria-label="Player" value="${escapeAttribute(entry.player ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="result" aria-label="Result" placeholder="Won 2-0" value="${escapeAttribute(entry.result ?? "")}">
    <input class="${INPUT_CLASSES}" data-field="opponent" aria-label="Opponent" value="${escapeAttribute(entry.opponent ?? "")}">`;
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
