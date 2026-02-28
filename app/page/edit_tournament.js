import { getUrlParams } from '../function/utils.js';
import { getRandomTournamentMock } from '../mock/tournamentsMock.js'
import { Tournament } from '../class/Tournament.js'
import { saveToLocal } from "../function/utils.js";
import { parseLeagueList } from "../class/League.js";

const league_id = getUrlParams('league_id')
const league_list = parseLeagueList(localStorage.getItem('league_list'))
const league = league_list.find(l => l.id === league_id)

console.log(window.location.href);
console.log(getUrlParams('league_id'));
console.log(getUrlParams('tournament_id'));
console.log(league_list);
console.log(league);

const tournament_id = getTournamentId(league)
const tournament = league.tournament_list.find(t => t.id === tournament_id)

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const nav_league = document.getElementById('nav-league')
const nav_tournament = document.getElementById('nav-tournament')

const name_input = document.getElementById('name_input')
const date_input = document.getElementById('date_input')
const url_input = document.getElementById('url_input');
const start_scrapping_button = document.getElementById('start_scrapping_button')
const tournament_h2 = document.getElementById('standings_h2')
const standings_table = document.getElementById('standings-table')
const delete_tournament_button = document.getElementById('delete-tournament-button')

nav_menu.textContent = " > Menu "
nav_leagues.textContent = " > Leagues "
nav_league.textContent = " > League " + league_id
nav_tournament.textContent = " > Tournament " + tournament_id

loadStandings(standings_table, tournament)	

saveTournament(league_list, league.tournament_list, tournament, name_input.value, date_input.value, null, null, null)
setInputs(tournament)
nav_menu.onclick = () => window.location.href = "menu.html"
nav_league.onclick = () => window.location.href = "edit_league.html?id=" + league_id
name_input.oninput = () => saveTournament(league_list, league.tournament_list, tournament, name_input.value, date_input.value, null, null, null)
date_input.oninput = () => saveTournament(league_list, league.tournament_list, tournament, name_input.value, date_input.value, null, null, null)
start_scrapping_button.onclick = () => startScrapping(url_input.value, tournament, league_list, league_id, standings_table);
delete_tournament_button.onclick = () => createConfirmDeleteWindow(league_list, league_id, tournament_id)


// TEST ONLY //
document.getElementById('url_input').value = "https://www.spicerack.gg/events/2938796/tournament"
// startScrapping(null);
// TEST ONLY //

function getTournamentId(league) {
	if (!league) return console.error("No League found within league_list !");
	
	const tournament_id = getUrlParams('tournament_id')
	console.log('tournament_id : ', tournament_id);
	console.log(tournament_id);
	
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
	console.log(tournament);
	
	name_input.value = tournament.name || null
	date_input.value = tournament.date || null
}

/** Save tournament by giving all values from inputs and updating the tournament then saving in local */
function saveTournament(league_list, tournament_list, tournament, name, date, rounds, tops, standings) {
	console.log('league_list', league_list);
	console.log('tournament_list', tournament_list);
	
	if (!tournament) return tournament_list;
	console.log(tournament);
	
	if (name) tournament.name = name
	if (date) tournament.date = new Date(date)
	if (rounds) tournament.rounds = rounds
	if (tops) tournament.tops = tops
	if (standings) tournament.standings = standings
	
	const leagueToUpdate = league_list.find(l => l.id === tournament.league_id)
	leagueToUpdate.tournament = tournament

	for (let i = 0; i < league_list.length; i++) {
		if (league_list[i].id === leagueToUpdate.id) {
			league_list[i] = leagueToUpdate
			return saveToLocal('league_list', league_list)
		}
	}
	
}

function loadStandings(standings_table, tournament) {
	if (!tournament?.rounds || !tournament?.standings) return console.log("No Standings to load");
	loadTournamentH2(tournament.name, tournament.rounds.length, tournament.standings.length)
	loadStandingsTable(standings_table, tournament.standings)
}


async function startScrapping(url, tournament, league_list, league_id, standings_table) {
	console.log("Start Scrapping");
	
	// const tournament  = await window.electronAPI.crawlSpiceEvent(url, null)
    const tournamentImported = getRandomTournamentMock(league_id)
	tournament.rounds = tournamentImported.rounds
	tournament.tops = tournamentImported.tops
	tournament.standings = tournamentImported.standings

	loadStandings(standings_table, tournament)	
	return saveTournament(
		league_list, 
		league.tournament_list, 
		tournament,
		tournament.name, 
		tournament.date, 
		tournament.rounds, 
		tournament.tops, 
		tournament.standings
	)
}

function loadTournamentH2(tournament_name, tournament_rounds, tournament_players_sum) {
	tournament_h2.textContent =  tournament_name + " Standings - " + tournament_rounds + " Rounds - " + tournament_players_sum + " Players"
}

function loadStandingsTable(standings_table, standings) {
	console.log('loadStandingsTable');
	console.log('standings', standings);
	const id_list = ["rank","player","points","record","omw","gw","ogw"]
	const type_list = ["string","string","number","string","number","number","number"]
	const header_list = ["Rank","Player","Points","Record","OMW Sum","GW Sum","OGW Sum"]
	console.log(standings_table)
	standings_table.build('Standings', header_list, id_list, type_list, standings)
}

function createConfirmDeleteWindow(league_list, league_id, tournament_id) {
	if (confirm("Are you sure to delete Tournament ?")) deleteTournament(league_list, league_id, tournament_id)
}

function deleteTournament(league_list, league_id, tournament_id) {
		for (let i = 0; i < league_list.length; i++) {
			const l = league_list[i];
			if (l.id === league_id) {
				console.log("working", l);
				
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