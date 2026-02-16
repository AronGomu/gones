import { loadRows, getUrlParams } from '../function/utils.js';

// const testtable = document.getElementById('test');
// const keys = [['id', 'ID'], ['name', 'Name'], ['date', 'Date']];
// const list = ["1", "2", "3"];
// testtable.loadData(keys, list)


const tournament_list_table = document.getElementById('tournament_list_table').getElementsByTagName('tbody')[0];
const add_tournament_button = document.getElementById('add_tournament_button');
add_tournament_button.onclick = addTournament;

const league_id = getUrlParams('id');
console.log("league_id", league_id);

const league_list = JSON.parse(localStorage.getItem('ligue_list')) || [];
console.log(league_list);

if (!league_list | league_list.length === 0) {
	alert("League not found !");
}


const league = league_list.find(league => league.id === league_id);
loadLeagueData(league);


function loadLeagueData(league) {
	document.getElementById('league_id').textContent = league.id;
	document.getElementById('name').value = league.name;
	document.getElementById('start').value = new Date(league.start).toISOString().split('T')[0];
	document.getElementById('end').value = league.end ? new Date(league.end).toISOString().split('T')[0] : '';
	loadRows(tournament_list_table, league.tournament_list, [['id', 'int'], ['name', 'str'], ['date', 'date']]);
	loadRows(ranking_table, league.ranking, [
		['rank', 'int'], 
		['playername', 'str'],
		['points', 'int'],
		['record', 'str'],
		['omw_sum', 'int'],
		['gw_sum', 'int'],
		['ogw_sum', 'int']
	]);
}

function addTournament() {
	console.log("add tournament");
	window.location.href = `add_tournament.html?id=${league_id}`;
	console.log("post add tournament", window.location.href);
	
}

