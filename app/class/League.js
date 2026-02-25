import { parseTournamentList } from './Tournament.js'

class League {
  constructor(name) {
	  this.id = Date.now().toString()
    this.name = name
    this.start = new Date() // Date
    this.end = null     // Date | null
    this.tournament_list = []
    this.player_list = []
    this.standings = []
  }
}

function parseLeague(league) {
  const l = new League(league.name)
  l.id = league.id
  l.start = new Date(league.start)
  l.end = new Date(league.end)
  l.tournament_list = league.tournament_list
  l.player_list = league.player_list
  l.standings = league.standings
  return l
}

function parseLeagueList(league_list_string) {
  const league_list = JSON.parse(league_list_string)
  
  const l_list = []
  for (const l of league_list) {
    l_list.push(parseLeague(l))
  }
  return l_list
  
}

export { League, parseLeague, parseLeagueList };