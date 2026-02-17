class Tournament {
  player_list;

  constructor(league_id, name, date, rounds, tops, standings = []) {
    this.league_id = league_id;
    this.name = name;
    this.date = date;
    this.rounds = rounds;
    this.tops = tops;
    this.standings = standings
  }

  
}

export { Tournament };