class Tournament {
  player_list;
  ranking;

  constructor(league_id, name, date, rounds, tops) {
    this.league_id = league_id;
    this.name = name;
    this.date = date;
    this.rounds = rounds;
    this.tops = tops;
  }

  
}

export { Tournament };