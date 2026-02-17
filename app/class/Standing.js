class Standing {
  rank;
  player;
  points;
  win;
  lose;
  draw;
  omw;
  gw;
  ogw;
  record;

  constructor(rank, player, points, win, lose, draw, omw, gw, ogw) {
    this.rank   = rank;
    this.player = player;
    this.points = points;
    this.win    = win;
    this.lose   = lose;
    this.draw   = draw;
    this.omw    = omw;
    this.gw     = gw;
    this.ogw    = ogw;
    this.record = `${win}-${lose}-${draw}`
  }

  setRecordFromStanding() {
    return this.record = `${win}-${lose}-${draw}`;
  }
}



module.exports = { Standing };