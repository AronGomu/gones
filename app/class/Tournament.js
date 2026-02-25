class Tournament {
  id;

  constructor(league_id, name, date, rounds, tops, standings = []) {
    this.league_id = league_id;
    this.id = Date.now().toString();
    this.name = name;
    this.date = date;
    this.rounds = rounds;
    this.tops = tops;
    this.standings = standings
  }
}

function parseTournament(tournament) {
  const t = new Tournament(tournament.league_id, )
  t.league_id = tournament.league_id
  t.name = tournament.name
  t.date = new Date(tournament.date)
  t.rounds = tournament.rounds
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