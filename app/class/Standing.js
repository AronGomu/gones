import { trunc4 } from "../function/utils.js";

export class Standing {
  rank;
  player;
  points;
  record;
  omw;
  gw;
  ogw;
  win;
  draw;
  lose;

  constructor(rank, player, points, win, lose, draw, omw, gw, ogw) {
    this.player = player
    this.win    = Number(win)
    this.lose   = Number(lose)
    this.draw   = Number(draw)
    this.rank   = Number(rank)
    this.points = Number(this.win) * 3 + Number(this.draw)
    this.omw    = trunc4(Number(omw))
    this.gw     = trunc4(Number(gw))
    this.ogw    = trunc4(Number(ogw))
    this.record = `${win}-${lose}-${draw}`
  }

  addStanding(standing) {
    if (this.player !== standing.player) {
      console.error("Cannot add standing to different player !", this.player, standing.player);
      return null
    }
    this.win = Number(this.win) + Number(standing.win)
    this.lose = Number(this.lose) + Number(standing.lose)
    this.draw = Number(this.draw) + Number(standing.draw)
    this.points = (Number(this.win) * 3 + Number(standing.draw))
    this.omw = trunc4(Number(this.omw) + Number(standing.omw))
    this.gw = trunc4(Number(this.gw) + Number(standing.gw))
    this.ogw = trunc4(Number(this.ogw) + Number(standing.ogw))
    this.record = `${this.win}-${this.lose}-${this.draw}`
  }
}

export function parseStanding(s) {
  return new Standing(s.rank, s.player, s.points, s.win, s.lose, s.draw, s.omw, s.gw, s.ogw)
}