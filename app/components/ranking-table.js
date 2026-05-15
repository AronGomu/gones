export function renderRankingTable(rows, { emptyText = "No result yet", playerHref = defaultPlayerHref } = {}) {
  if (!rows?.length) {
    return `<p class="text-slate-500" data-cy="empty-ranking">${emptyText}</p>`;
  }

  return `
    <table class="w-full overflow-hidden rounded-lg border border-slate-200 bg-white border-collapse max-[760px]:block max-[760px]:overflow-x-auto" data-cy="ranking-table">
      <thead>
        <tr>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">Rank</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">Player</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">Record</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">Pts</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">OMW</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">GW</th>
          <th class="whitespace-nowrap border-b border-slate-200 bg-emerald-50 px-3 py-2.5 text-left text-sm text-slate-800">OGW</th>
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
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${row.rank}</td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left"><a class="text-teal-800 hover:underline" data-cy="ranking-player" href="${playerHref(row.playerName)}">${escapeHtml(row.playerName)}</a></td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${row.matchWins}-${row.matchLosses}-${row.matchDraws}${row.byes ? ` (${row.byes} bye)` : ""}</td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${row.points}</td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${formatPercentage(row.opponentsMatchWinPercentage)}</td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${formatPercentage(row.gameWinPercentage)}</td>
      <td class="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left">${formatPercentage(row.opponentsGameWinPercentage)}</td>
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
