import { deepCopySimpleObject, getUrlParams } from '../function/utils.js';
import { League, parseLeagueList } from '../class/League.js'
import { saveToLocal, YYYYMMDD } from '../function/utils.js'
import { parseStanding } from "../class/Standing.js";

const league_id = getId()
let league_list = getLeagueList();
const league = league_list.find(l => l.id === league_id) || new League('New League')

league_list = saveLeague(league_list, league)

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const nav_league = document.getElementById('nav-league')
const h1 = document.getElementById('h1') 
const name = document.getElementById('name') 
const name_input = document.getElementById('name-input') 
const start = document.getElementById('start') 
const end = document.getElementById('end') 
const tournaments_table = document.getElementById('tournaments-table')
const create_tournament_button = document.getElementById('create-tournament-button')
const standings_table = document.getElementById('standings-table')
const delete_league_button = document.getElementById('delete-league-button')

// nav_menu.textContent = "> Menu "
// nav_leagues.textContent = " > Leagues"
if (league_id) nav_league.textContent = "League " + league.name
// h1.innerText = "Edit League " + league_id 
h1.innerText = league.name
name_input.value = league.name
start.value = YYYYMMDD(league.start)
end.value = YYYYMMDD(league.end)
loadTournaments(tournaments_table, league.tournament_list)
loadStandings(standings_table, league.tournament_list)

// nav_menu.onclick = () => window.location.href = "menu.html"
nav_leagues.onclick = () => window.location.href = "leagues.html"
h1.onclick = () => enterH1Input(h1, name)
name_input.oninput = () => saveLeague(league_list, league, name_input.value, start.value, end.value)
create_tournament_button.onclick = () => addTournament(league_id)
delete_league_button.onclick = () => createConfirmDeleteWindow(league_list, league_id)

function getId() {
	let id = getUrlParams('id')
	if (!id) {
		id = Date.now().toString()
		window.location.href = "edit_league.html?id=" + id
	}
	else return id
}

function getLeagueList() {
	const league_list_local = localStorage.getItem('league_list')
	if (league_list_local) return parseLeagueList(league_list_local)
	else return []
}

function saveLeague(league_list, league, name, start, end) {
	console.log('saveLeague : ', league_list, league, name, start, end);
	
	if (!league) return league_list;
	
	if (name) league.name = name
	if (start) league.start = new Date(start)
	if (end) league.end = new Date(end) 

	for (let i = 0; i < league_list.length; i++) {
		if (league_list[i].id === league.id) {
			console.log("Found League in League List => Update League and Save");
			league_list[i] = league
			return saveToLocal('league_list', league_list)
		}
	}

	console.log("Fail to find League in League List => Add League to List and Save");
	if (!league_list) league_list = []
	league_list.push(league)
	return saveToLocal('league_list', league_list)
 }

function loadTournaments(tournaments_table, tournament_list) {
	const id_list = ['name', 'date']
	const header_list = ['Name', 'Date',]
	const type_list = ['string', 'date']
	const row_list = tournament_list;
	tournaments_table.build('Tournaments', header_list, id_list, type_list, row_list)
	tournaments_table.addEventListener('edit-row', (e) => gotoTournament(e.detail.row))
}

function addTournament(league_id) {
	window.location.href = `edit_tournament.html?league_id=${league_id}`
}

function loadStandings(standings_table, tournament_list) {
	if (!tournament_list || tournament_list.length < 1) return null;
	const standings = buildLeagueStandings(tournament_list)
	const id_list = ["rank","player","points","record","omw","gw","ogw"]
	const type_list = ["string","string","number","string","number","number","number"]
	const header_list = ["Rank","Player","Points","Record","OMW Sum","GW Sum","OGW Sum"]
	standings_table.build('Standings', header_list, id_list, type_list, standings)
}

function buildLeagueStandings(tournament_list) {
	// Load all standings
	const global_standings = []
	for (let i = 0; i < tournament_list.length; i++) {
		const t = tournament_list[i]
		for (let j = 0; j < t.standings.length; j++) {
			const s = t.standings[j];
			const found = global_standings.find(gs => s.player === gs.player)
			if (found) found.addStanding(s)
			else global_standings.push(parseStanding(s))
		}
	}

	// Correct errors and reorder based on points
	global_standings.sort((a,b) => {
		if (a.points !== b.points) return a.points < b.points ? 1 : -1
		if (a.omw !== b.omw) return a.omw < b.omw? 1 : -1
		if (a.gw !== b.gw) return a.gw < b.gw ? 1 : -1
		return a.ogw < b.ogw ? 1 : -1
		
	})
	for (let i = 0; i < global_standings.length; i++) {
		global_standings[i].rank = i+1
	}

	return global_standings
}


function gotoTournament(tournament) {
	window.location.href = `edit_tournament.html?league_id=${tournament.league_id}&tournament_id=${tournament.id}`;
}

function createConfirmDeleteWindow(league_list, league_id) {
	if (confirm("Are you sure to delete League ?")) deleteLeague(league_list, league_id)
}

function deleteLeague(league_list, league_id) {
		for (let i = 0; i < league_list.length; i++) {
			const l = league_list[i];
			if (l.id === league_id) {
				console.log("League Found and deleted succesfully");
				league_list.splice(i, 1)
				break;
			}
		}
		saveToLocal('league_list', league_list)
		return window.location.href = 'leagues.html'
}

function enterH1Input(h1, name) {
	h1.hidden = true
	name.hidden = false
	name.focus()
}

function exitH1Input() {
	h1.hidden = false
	name.hidden = true
}