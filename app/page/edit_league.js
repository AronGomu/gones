import { getUrlParams } from '../function/utils.js';
import { League, parseLeagueList } from '../class/League.js'
import { saveToLocal, YYYYMMDD } from '../function/utils.js'


const league_id = getId()
let league_list = parseLeagueList(localStorage.getItem('league_list')) || []
console.log('league_list', league_list)
console.log('league_id', league_id)

const league = league_list.find(l => l.id === league_id) || new League('New League')
league_list = saveLeague(league_list, league)

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const nav_league = document.getElementById('nav-league')
const id = document.getElementById('id') 
const name = document.getElementById('name') 
const start = document.getElementById('start') 
const end = document.getElementById('end') 
const tournaments_table = buildTournamentsTable(league)
const create_tournament_button = document.getElementById('create_tournament_button')
// const standings_table = buildStandingsTable(league.standings)

console.log(YYYYMMDD(league.start))


nav_menu.textContent = "> Menu "
nav_leagues.textContent = " > Leagues"
nav_league.textContent = " > League" + league_id
id.innerText = league_id 
name.value = league.name
start.value = YYYYMMDD(league.start)
end.value = YYYYMMDD(league.end) || null

nav_menu.onclick = () => window.location.href = "menu.html"
nav_leagues.onclick = () => window.location.href = "menu.html"
name.oninput = () => saveLeague(league_list, league, name.value, start.value, end.value)
create_tournament_button.onclick = () => addTournament(league)

function getId() {
	let id = getUrlParams('id')
	if (!id) return Date.now().toString()
	else return id
}

function saveLeague(league_list, league, name, start, end) {
	console.log('league_list', league_list);
	
	if (!league) return league_list;
	console.log(league);
	
	if (name) league.name = name
	if (start) league.start = new Date(start)
	if (end) league.end = new Date(end) 

	if (league_list.length < 1) return saveToLocal('league_list', [league])
	for (let i = 0; i < league_list.length; i++) {
		if (league_list[i].id === league.id) {
			league_list[i] = league
			return saveToLocal('league_list', league_list)
		}
	}
 }

function buildTournamentsTable(league) {
	console.log('buildTournamentsTable', league.tournament_list);
	const tournament_list_table = document.getElementById('tournaments_table')
	const id_list = ['id', 'name', 'date', 'edit']
	const header_list = ['ID', 'Name', 'Date', '']
	const type_list = ['string', 'string', 'date', 'edit']
	const row_list = league.tournament_list;
	console.log(row_list);
	
	tournament_list_table.build('Tournaments', header_list, id_list, type_list, row_list)
	tournament_list_table.addEventListener('edit-row', (e) => gotoTournament(league.id, e.detail.row.id))
	return tournament_list_table
}

function addTournament(league) {
	window.location.href = `edit_tournament.html?league_id=${league.id}`
}

function buildStandingsTable(standing_list) {
	console.log('standing_list', standing_list);
	const standings_table = document.getElementById('standings_table')
	const id_list = ['rank', 'player', 'points', 'record', 'omw', 'gw', 'ogw']
	const header_list = ['Rank', 'Player', 'Points', 'Record', 'OMW Sum', 'GW Sum', 'OGW Sum']
	const type_list = ['number', 'string', 'date', 'string', 'number', 'number', 'number']
	const row_list = standing_list;
	standings_table.build('Standings', header_list, id_list, type_list, row_list)
	return standings_table 
}


function gotoTournament(league_id, tournament_id) {
	console.log(tournament_id);
	
	if (!tournament_id) window.location.href = `edit_tournament.html?league_id=${league_id}`;
	else window.location.href = `edit_tournament.html?league_id=${league_id}&tournament_id=${tournament_id}`;
}

