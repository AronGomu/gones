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

export { Tournament };