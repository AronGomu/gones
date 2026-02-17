import {tournamentMock} from '../mock/tournamentMock.js'

const params = new URLSearchParams(document.location.search);

const league_id_param = params.get('id');
const league_id_span = document.getElementById('league_id');
league_id_span.textContent = league_id_param;

const date = document.getElementById('date_input');

const start_scrapping_button = document.getElementById('start_scrapping_button');
start_scrapping_button.onclick = startScrapping;

const standings_table = document.getElementById('standings_table');

// TEST ONLY //
// document.getElementById('spice_url').value = "https://www.spicerack.gg/events/2938796/tournament"
startScrapping(null);
// TEST ONLY //


async function startScrapping(url) {
	const spice_url = document.getElementById('spice_url').value;
	
	console.log("start scrapping", spice_url);
	// const tournament  = await window.electronAPI.crawlSpiceEvent(spice_url, null);
    const tournament = tournamentMock;

	const newTournament = tournament;
	newTournament['league_id'] = league_id_param;
	newTournament['date'] = document.getElementById('tournament_date').value;

	console.log('newTournament :', newTournament);

	loadStandingsTable(newTournament.standings);
}


function loadStandingsTable(standings) {
	const id_list = ["rank","player","points","record","omw","gw","ogw"]
	const type_list = ["string","string","number","string","number","number","number"]
	const header_list = ["Rank","Player","Points","Record","OMW Sum","GW Sum","OGW Sum"]
	console.log(standings_table);
	standings_table.loadData(header_list, id_list, type_list, standings)
}