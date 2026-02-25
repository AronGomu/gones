import { getUrlParams } from '../function/utils.js';
import { tournamentsMock } from '../mock/tournamentsMock.js'

const league_id = getUrlParams('league_id')
if (!league_id) throw new Error("NO LEAGUE ID GIVEN !");
const tournament_id = getUrlParams('tournament_id') || Date.now().toString()
const league_list = JSON.parse(localStorage.getItem('league_list')) || []
const league = league_list.find(l => l.id === league_id)

let tournament = null
if (league.tournament_list && league.tournament_list.length > 0) {
	tournament = league.tournament_list.find(t => t.id === tournament_id)
}

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const nav_league = document.getElementById('nav-league')
const nav_tournament = document.getElementById('nav-tournament')

const league_id_span = document.getElementById('league_id')
const date_input = document.getElementById('date_input')
const start_scrapping_button = document.getElementById('start_scrapping_button')
const tournament_h2 = document.getElementById('standings_h2')
const standings_table = document.getElementById('standings_table')

nav_menu.textContent = " > Menu "
nav_leagues.textContent = " > Leagues "
nav_league.textContent = " > League " + league_id
nav_tournament.textContent = " > Tournament " + tournament_id
league_id_span.textContent = league_id

nav_menu.onclick = () => window.location.href = "menu.html"
nav_league.onclick = () => window.location.href = "edit_league.html?=" + league_id

start_scrapping_button.onclick = startScrapping;




// TEST ONLY //
document.getElementById('spice_url').value = "https://www.spicerack.gg/events/2938796/tournament"
startScrapping(null);
// TEST ONLY //


async function startScrapping(url) {
	const spice_url = document.getElementById('spice_url').value;
	
	console.log("start scrapping", spice_url);
	// const tournament  = await window.electronAPI.crawlSpiceEvent(spice_url, null)
    const tournament = tournamentsMock

	const newTournament = tournament
	newTournament['league_id'] = league_id
	newTournament['date'] = document.getElementById('tournament_date').value

	console.log('newTournament :', newTournament)

	loadTournamentH2(newTournament.name, newTournament.rounds.length, newTournament.standings.length)
	loadStandingsTable(newTournament.standings)
}

function loadTournamentH2(tournament_name, tournament_rounds, tournament_players_sum) {
	tournament_h2.textContent =  tournament_name + " Standings - " + tournament_rounds + " Rounds - " + tournament_players_sum + " Players"
}

function loadStandingsTable(standings) {
	const id_list = ["rank","player","points","record","omw","gw","ogw"]
	const type_list = ["string","string","number","string","number","number","number"]
	const header_list = ["Rank","Player","Points","Record","OMW Sum","GW Sum","OGW Sum"]
	console.log(standings_table)
	standings_table.build('Standings', header_list, id_list, type_list, standings)
}