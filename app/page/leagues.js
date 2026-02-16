import { League } from './../class/League.js';
import { loadRows } from './../function/utils.js';

const create_league_button = document.getElementById('create_league_button');
create_league_button.onclick = createLeague;

const ligue_list = JSON.parse(localStorage.getItem('ligue_list')) || [];
const table = document.getElementById('ligue_list_table');
table.loadData([['ID', 'id', 'int'], ['Name', 'name', 'str'], ['Start Date', 'start', 'date'], ['End Date', 'end', 'date'], ['', 'edit', "edit_league"]], ligue_list);


function createLeague() {
	const name_league = document.getElementById('name_league').value;
	const new_league = new League(name_league);

	const ligue_list = JSON.parse(localStorage.getItem('ligue_list')) || [];
	ligue_list.push(new_league);
	localStorage.setItem('ligue_list', JSON.stringify(ligue_list));
	loadRows(table, ligue_list, [['id', 'int'], ['name', 'str'], ['start', 'date'], ['end', 'date'], ['edit', "edit_league"]]);
}

function editLeague(leagueId) {
	console.log(`Edit league with ID: ${leagueId}`);
}