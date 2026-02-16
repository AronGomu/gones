class League {
  constructor(name) {
	this.id = Date.now().toString();
    this.name = name;
    this.start = new Date(); // Date
    this.end = null;     // Date | null
    this.tournament_list = [];
    this.playerList = [];
    this.ranking = [];
  }
}

export { League };