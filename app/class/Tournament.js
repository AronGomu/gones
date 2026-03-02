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
  const t = new Tournament()
  t.id = tournament.id
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
  console.log('parseTournamentList', tournament_list);

  for (let i = 0; i < tournament_list.length; i++) {
    const t = tournament_list[i];
    t_list.push(parseTournament(t))
    console.log('parseTournamentList 2', JSON.stringify(t_list.at(-1).id));
  }
  
  return t_list
}

export { Tournament, parseTournament, parseTournamentList };