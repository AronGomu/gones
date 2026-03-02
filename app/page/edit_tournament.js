import { getUrlParams, YYYYMMDD } from '../function/utils.js';
import { getRandomTournamentMock, gones4 } from '../mock/tournamentsMock.js'
import { Tournament } from '../class/Tournament.js'
import { saveToLocal } from "../function/utils.js";
import { parseLeagueList } from "../class/League.js";

const league_id = getUrlParams('league_id')
const league_list = parseLeagueList(localStorage.getItem('league_list'))

const league = league_list.find(l => l.id === league_id)

const tournament_id = getTournamentId(league)
let tournament = league.tournament_list.find(t => t.id === tournament_id)

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const nav_league = document.getElementById('nav-league')
const nav_tournament = document.getElementById('nav-tournament')
const h1 = document.getElementById('h1')
const name = document.getElementById('name')
const name_input = document.getElementById('name-input')
const tournament_date_input = document.getElementById('tournament-date-input')
const url_input = document.getElementById('url_input')
const start_scrapping_button = document.getElementById('start_scrapping_button')
const import_standings_button_div = document.getElementById('import-standings-button-div')
const tournament_h2 = document.getElementById('standings-h2')
const standings_table = document.getElementById('standings-table')
const delete_tournament_button = document.getElementById('delete-tournament-button')
const to_league_button = document.getElementById('to-league-button')

nav_league.textContent = "League " + league_id
nav_tournament.textContent = "Tournament " + tournament_id
h1.innerText = tournament.name
name_input.value = tournament.name

loadStandings(standings_table, tournament)	

saveTournament(league_list, tournament)
setInputs(tournament)
// nav_menu.onclick = () => window.location.href = "menu.html"
nav_league.onclick = () => window.location.href = "edit_league.html?id=" + league_id
name_input.oninput = () => {
  tournament.name = name_input.value
  saveTournament(league_list, tournament)
}
h1.onclick = () => enterH1Input(h1, name)
name_input.onblur = () => exitH1Input()
name_input.onkeydown = (e) => {
	h1.textContent = name_input.value
 	if (e.key === "Enter" || e.key === "Escape") exitH1Input()
}
tournament_date_input.oninput = () => {
  tournament.date = tournament_date_input.value
  saveTournament(league_list, tournament)
}
start_scrapping_button.onclick = () => startScrapping(url_input.value, tournament, league_list, league_id, standings_table, h1, name_input)
import_csv.onclick = () => startScrapping(url_input.value, tournament, league_list, league_id, standings_table, h1, name_input)
delete_tournament_button.onclick = () => createConfirmDeleteWindow(league_list, league_id, tournament_id)
to_league_button.onclick = () => window.location.href = "edit_league.html?id=" + league_id


// TEST ONLY //
// document.getElementById('url_input').value = "https://www.spicerack.gg/events/2945730/tournament"
// startScrapping(null);
// TEST ONLY //

function getTournamentId(league) {
	if (!league) return console.error("No League found within league_list !")
	const tournament_id = getUrlParams('tournament_id')
	if (!tournament_id) {
		if (!league.tournament_list) league.tournament_list = [new Tournament(league.id)]
		else league.tournament_list.push(new Tournament(league.id))
		return league.tournament_list[0].id
	} 
	return tournament_id
}

function getTournamentH1(tournament) {
	if (tournament.name) return tournament.name 
	return "Import Tournament"
}

function setInputs(tournament) {
	name_input.value = tournament.name || null
	tournament_date_input.value = YYYYMMDD(tournament.date)
}

/** Save tournament by giving all values from inputs and updating the tournament then saving in local */
function saveTournament(league_list, tournament) {
  if (!league_list || league_list.length < 1) {
    console.error("Cannot save because league_list is null or empty !", league_list);
    return league_list.tournament_list;
  }

  if (!tournament || !tournament.id) {
    console.error("Cannot save because tournament is null or has no id !", tournament);
    return league_list.tournament_list;
  }

  const leagueToUpdate = league_list.find(l => l.id === league_id)

	
	
  for (let i = 0; i < leagueToUpdate.tournament_list.length; i++) {
    const t = leagueToUpdate.tournament_list[i];
    if (t.id === tournament.id) {
      leagueToUpdate.tournament_list[i] = tournament
      break
    }
  }

  return saveToLocal('league_list', league_list)
}

function loadStandings(standings_table, tournament) {
	if (!tournament?.rounds || !tournament?.standings) return console.log("No Standings to load");
	loadTournamentH2(tournament.rounds.length, tournament.standings.length)
	console.log(standings_table);
	loadStandingsTable(standings_table, tournament)
}


async function startScrapping(url, tournament, league_list, league_id, standings_table, h1, name_input) {
  const tournament_id = tournament.id
	tournament = await window.electronAPI.crawlSpiceEvent(url, null)
  // TEST ONLY //
	// tournament = gones4
  // TEST ONLY //
  tournament.id = tournament_id
	tournament.league_id = league_id
	
	h1.innerText = tournament.name
	name_input.value = tournament.name
	loadStandings(standings_table, tournament)	

	saveTournament(league_list, tournament)
}

function loadTournamentH2(tournament_rounds, tournament_players_sum) {
	tournament_h2.textContent = tournament_rounds + " Rounds - " + tournament_players_sum + " Players"
}

function loadStandingsTable(standings_table, tournament) {
	const id_list = ["rank","player","points","record","omw","gw","ogw"]
	const type_list = ["string","string","number","string","number","number","number"]
	const header_list = ["Rank","Player","Points","Record","OMW Sum","GW Sum","OGW Sum"]
	standings_table.build('Standings', header_list, id_list, type_list, tournament.standings)
}

function createConfirmDeleteWindow(league_list, league_id, tournament_id) {
	if (confirm("Are you sure to delete Tournament ?")) deleteTournament(league_list, league_id, tournament_id)
}

function deleteTournament() {
		for (let i = 0; i < league_list.length; i++) {
			const l = league_list[i];
			if (l.id === league_id) {
				for (let j = 0; j < l.tournament_list.length; j++) {
					const t = l.tournament_list[j];
					if (t.id === tournament_id) {
						console.log("Tournament Found and deleted succesfully");
						l.tournament_list.splice(j, 1)
						break;
					}
				}
			}
		}
		saveToLocal('league_list', league_list)
		return window.location.href = 'edit_league.html?id=' + league_id
}

function enterH1Input() {
	h1.hidden = true
	name.hidden = false
	name_input.focus()
}

function exitH1Input() {
	name_input.blur()
	name.hidden = true
	h1.hidden = false
}
