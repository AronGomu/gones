import { League } from './../class/League.js';

const league_list = JSON.parse(localStorage.getItem('league_list')) || []

const nav_menu = document.getElementById('nav-menu')
const nav_leagues = document.getElementById('nav-leagues')
const create_league_button = document.getElementById('create_league_button')
const table = buildLeagueListTable(league_list)

// nav_menu.textContent = "> Menu "
// nav_leagues.textContent = " > Leagues"

// nav_menu.onclick = () => window.location.href = "menu.html"
create_league_button.onclick = createLeague


function buildLeagueListTable(league_list) {
	console.log(league_list);
	const league_list_table = document.getElementById('league_list_table')
	const id_list = ['name', 'start', 'end']
	const header_list = ['Name', 'Start Date', 'End Date']
	const type_list = ['string', 'date', 'date']
	const row_list = league_list;
	league_list_table.build('Leagues', header_list, id_list, type_list, row_list)
	league_list_table.addEventListener('edit-row', (e) => editLeague(e.detail.row.id))
	return league_list_table
}


function createLeague() {
	window.location.href = `edit_league.html`;
}

function editLeague(id) {
	window.location.href = `edit_league.html?id=${id}`;
}