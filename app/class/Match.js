class Match {
  constructor( winner, loser, winner_score, loser_score, is_draw) {
    this.winner = winner;
	this.loser = loser;
	this.winner_score = winner_score;
	this.loser_score = loser_score;
	this.is_draw = is_draw;
  }
}

export { Match };