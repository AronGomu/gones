export function renderRankingTable(rows, { emptyText = "No result yet", playerHref = defaultPlayerHref } = {}) {
  if (!rows?.length) {
    return `<p class="text-dim-ash" data-cy="empty-ranking">${emptyText}</p>`;
  }

  return `
    <table class="table-shell" data-cy="ranking-table">
      <thead>
        <tr>
          <th class="table-head-cell">Rank</th>
          <th class="table-head-cell">Player</th>
          <th class="table-head-cell">Record</th>
          <th class="table-head-cell">Pts</th>
          <th class="table-head-cell">OMW</th>
          <th class="table-head-cell">GW</th>
          <th class="table-head-cell">OGW</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => renderRow(row, playerHref)).join("")}
      </tbody>
    </table>
  `;
}

function renderRow(row, playerHref) {
  return `
    <tr data-cy="ranking-row">
      <td class="table-cell">${row.rank}</td>
      <td class="table-cell"><a class="text-link" data-cy="ranking-player" href="${playerHref(row.playerName)}">${escapeHtml(row.playerName)}</a></td>
      <td class="table-cell">${row.matchWins}-${row.matchLosses}-${row.matchDraws}${row.byes ? ` (${row.byes} bye)` : ""}</td>
      <td class="table-cell">${row.points}</td>
      <td class="table-cell">${formatPercentage(row.opponentsMatchWinPercentage)}</td>
      <td class="table-cell">${formatPercentage(row.gameWinPercentage)}</td>
      <td class="table-cell">${formatPercentage(row.opponentsGameWinPercentage)}</td>
    </tr>
  `;
}

export function formatPercentage(value) {
  if (value === null || value === undefined) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function defaultPlayerHref(playerName) {
  return `player.html?playerName=${encodeURIComponent(playerName)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
