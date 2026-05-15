export function renderRankingTable(rows, { emptyText = "No result yet", playerHref = defaultPlayerHref } = {}) {
  if (!rows?.length) {
    return `<p class="empty-state" data-cy="empty-ranking">${emptyText}</p>`;
  }

  return `
    <table class="ranking-table" data-cy="ranking-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Record</th>
          <th>Pts</th>
          <th>OMW</th>
          <th>GW</th>
          <th>OGW</th>
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
      <td>${row.rank}</td>
      <td><a data-cy="ranking-player" href="${playerHref(row.playerName)}">${escapeHtml(row.playerName)}</a></td>
      <td>${row.matchWins}-${row.matchLosses}-${row.matchDraws}${row.byes ? ` (${row.byes} bye)` : ""}</td>
      <td>${row.points}</td>
      <td>${formatPercentage(row.opponentsMatchWinPercentage)}</td>
      <td>${formatPercentage(row.gameWinPercentage)}</td>
      <td>${formatPercentage(row.opponentsGameWinPercentage)}</td>
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

