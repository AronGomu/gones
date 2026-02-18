import { League } from './../class/League.js';

const ligue_list = JSON.parse(localStorage.getItem('ligue_list')) || []

const create_league_button = document.getElementById('create_league_button')
create_league_button.onclick = createLeague


const table = buildLeagueListTable(ligue_list)

function buildLeagueListTable(ligue_list) {
	console.log(ligue_list);
	const league_list_table = document.getElementById('ligue_list_table')
	const id_list = ['id', 'name', 'start', 'end', 'edit']
	const header_list = ['ID', 'Name', 'Start Date', 'End Date', '']
	const type_list = ['string', 'string', 'date', 'date', 'edit']
	const row_list = ligue_list;
	league_list_table.build('Leagues', header_list, id_list, type_list, row_list)
	league_list_table.addEventListener('edit-row', (e) => editLeague(e.detail.league, e.detail.row_index))
	return league_list_table
}


function createLeague() {
	window.location.href = `edit_league.html`;
}

function editLeague(league) {
	window.location.href = `edit_league.html?id=${league.id}`;
}