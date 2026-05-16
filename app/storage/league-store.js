import { GONES_DATA_VERSION, createGonesData, normalizeLeague } from "../domain/models.js";
import { migrateLegacyLeagueList } from "../domain/migration.js";

const STORAGE_KEY = "gones_data";
const LEGACY_STORAGE_KEY = "league_list";

export function loadData(storage = globalThis.localStorage) {
  const stored = readJson(storage.getItem(STORAGE_KEY));
  if (isVersionedData(stored)) return stored;

  const migrated = migrateLegacyLeagueList(storage.getItem(LEGACY_STORAGE_KEY));
  if (migrated) {
    saveData(migrated, storage);
    return migrated;
  }

  return createGonesData();
}

export function saveData(data, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizeVersionedData(data)));
}

export function normalizeVersionedData(data) {
  if (!isVersionedData(data)) return createGonesData();
  return {
    version: GONES_DATA_VERSION,
    leagues: Array.isArray(data.leagues) ? data.leagues.map((league) => normalizeLeague(league)) : []
  };
}

export function findLeague(data, leagueId) {
  return data.leagues.find((league) => league.id === leagueId) ?? null;
}

export function findTournament(league, tournamentId) {
  return league?.tournaments?.find((tournament) => tournament.id === tournamentId) ?? null;
}

function isVersionedData(data) {
  return data?.version === GONES_DATA_VERSION && Array.isArray(data.leagues);
}

function readJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
