import { getUrlParams } from '../function/utils.js';

const league_id = getUrlParams('id');
const league_list = JSON.parse(localStorage.getItem('ligue_list')) || []
const league = league_list.find(l => l.id === league_id)

console.log(league_list, league_id, league);

document.getElementById("league_id").innerText = league_id

const tournaments_table = buildTournamentsTable(league)
// const standings_table = buildStandingsTable(league.standings)

// const edit_tournament_button = document.getElementById('edit_tournament_button')
// edit_tournament_button.onclick = gotoTournament
const b = document.getElementById('create_tournament_button')
console.log(b)

document.getElementById('create_tournament_button').addEventListener('click', () => addTournament())

if (!league_list | league_list.length === 0) alert("League not found !")


function buildTournamentsTable(tournament_list) {
	console.log(tournament_list);
	const tournament_list_table = document.getElementById('tournaments_table')
	const id_list = ['id', 'name', 'start', 'end', 'edit']
	const header_list = ['ID', 'Name', 'Start Date', 'End Date', '']
	const type_list = ['string', 'string', 'date', 'date', 'edit']
	const row_list = tournament_list;
	tournament_list_table.build('Tournaments', header_list, id_list, type_list, row_list)
	tournament_list_table.addEventListener('edit-row', (e) => gotoTournament(e.detail.tournament.id))
	return tournament_list_table
}

function editTournament(tournament_id) {
	window.location.href = `edit_tournament.html?league_id=${league.id}&tournament_id=${tournament_id}`
}

function addTournament() {
	window.location.href = `edit_tournament.html?league_id=${league.id}`
}

function buildStandingsTable(standing_list) {
	console.log(standing_list);
	const standings_table = document.getElementById('standings_table')
	const id_list = ['rank', 'player', 'points', 'record', 'omw', 'gw', 'ogw']
	const header_list = ['Rank', 'Player', 'Points', 'Record', 'OMW Sum', 'GW Sum', 'OGW Sum']
	const type_list = ['number', 'string', 'date', 'string', 'number', 'number', 'number']
	const row_list = standing_list;
	standings_table.build('Standings', header_list, id_list, type_list, row_list)
	return standings_table 
}


function gotoTournament() {
	window.location.href = `edit_tournament.html?id=${league_id}`;
}

