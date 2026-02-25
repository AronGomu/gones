class Tournament {
  player_list;

  constructor(league_id, name, date, round_list, tops, standings = []) {
    this.league_id = league_id;
    this.name = name;
    this.date = date;
    this.round_list = round_list;
    this.tops = tops;
    this.standings = standings
  }
}

function parseTournament(tournament) {
  const t = new Tournament(tournament.league_id, )
  t.league_id = tournament.league_id
  t.name = tournament.name
  t.date = new Date(tournament.date)
  t.round_list = tournament.round_list
  t.tops = tournament.tops
  t.standings = tournament.standings
  return t;

}

function parseTournamentList(tournament_list) {
  const t_list = []
  for (const t of tournament_list) {
    t_list.push(parseTournament(t))
  }
  return t_list
}

export { Tournament, parseTournament, parseTournamentList };