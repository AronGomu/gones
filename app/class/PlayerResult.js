class PlayerResult {
  constructor({
    rank,
    player_name,
    points,
    record,
    OMW,
    GW,
    OGW
  }) {
    this.rank = rank;
    this.player_name = player_name;
    this.points = points;
    this.record = record
    this.draw = draw;
    this.OMW = OMW;
    this.GW = GW;
    this.OGW = OGW;
  }
}

export { PlayerResult };