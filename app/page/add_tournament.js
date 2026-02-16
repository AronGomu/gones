// import { loadRows, getUrlParams } from '../function/utils.js';
import { Tournament } from '../class/Tournament.js'
import { Match } from '../class/Match.js'

const tournamentMock = {
    "name": "Test Event",
    "rounds": {
        "1": [
            {
                "winner": "John Opffer",
                "loser": "Bob Dylan",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Tim Wade",
                "loser": "Jake T (young trenby)",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Destiny Wilson",
                "loser": "Crust M",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Quinton Wilckens",
                "loser": "Owen Moyer",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "AL",
                "loser": "Jeremy Lesher",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "cam hawk",
                "loser": "Carmen Hazard",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Nate Antonioli",
                "loser": "Dalton Rederick",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "Jake Mcmillian",
                "loser": "Tyler Gibson",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Gerard collin",
                "loser": "Marc Garen",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Lance Ballester",
                "loser": "Niall Kelly",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Timothy taranto",
                "loser": "Sean Nessinger",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Anon-31 last-31",
                "loser": "Bobby Taylor",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "kevin sherry",
                "loser": "Aeddon Lukens",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "kylyn kunkel",
                "loser": "zach trenberth",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Dan Gomba",
                "loser": "Justin Huffman",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Matt Gooding",
                "loser": "Zachary Ritz",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            }
        ],
        "2": [
            {
                "winner": "Dan Gomba",
                "loser": "Destiny Wilson",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "John Opffer",
                "loser": "cam hawk",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "AL",
                "loser": "Tim Wade",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "kevin sherry",
                "loser": "Lance Ballester",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jake Mcmillian",
                "loser": "Anon-31 last-31",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Quinton Wilckens",
                "loser": "Matt Gooding",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Timothy taranto",
                "loser": "kylyn kunkel",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Gerard collin",
                "loser": "Dalton Rederick",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Crust M",
                "loser": "Nate Antonioli",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "Owen Moyer",
                "loser": "zach trenberth",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Bobby Taylor",
                "loser": "Tyler Gibson",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Aeddon Lukens",
                "loser": "Justin Huffman",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jeremy Lesher",
                "loser": "Jake T (young trenby)",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Marc Garen",
                "loser": "Zachary Ritz",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Carmen Hazard",
                "loser": "Bob Dylan",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Niall Kelly",
                "loser": "Sean Nessinger",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            }
        ],
        "3": [
            {
                "winner": "AL",
                "loser": "Dan Gomba",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Timothy taranto",
                "loser": "kevin sherry",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "John Opffer",
                "loser": "Quinton Wilckens",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Jake Mcmillian",
                "loser": "Gerard collin",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "kylyn kunkel",
                "loser": "Carmen Hazard",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Owen Moyer",
                "loser": "Marc Garen",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jeremy Lesher",
                "loser": "Lance Ballester",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Matt Gooding",
                "loser": "Tim Wade",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Aeddon Lukens",
                "loser": "Destiny Wilson",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Bobby Taylor",
                "loser": "cam hawk",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Nate Antonioli",
                "loser": "Anon-31 last-31",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Crust M",
                "loser": "Niall Kelly",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Sean Nessinger",
                "loser": "Dalton Rederick",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Zachary Ritz",
                "loser": "Justin Huffman",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jake T (young trenby)",
                "loser": "zach trenberth",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Tyler Gibson",
                "loser": "Bob Dylan",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            }
        ],
        "4": [
            {
                "winner": "AL",
                "loser": "John Opffer",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Timothy taranto",
                "loser": "Jake Mcmillian",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jeremy Lesher",
                "loser": "Gerard collin",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Owen Moyer",
                "loser": "Dan Gomba",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Bobby Taylor",
                "loser": "Matt Gooding",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "kevin sherry",
                "loser": "kylyn kunkel",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Aeddon Lukens",
                "loser": "Quinton Wilckens",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Sean Nessinger",
                "loser": "Nate Antonioli",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Lance Ballester",
                "loser": "Crust M",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "Tyler Gibson",
                "loser": "Tim Wade",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Destiny Wilson",
                "loser": "Anon-31 last-31",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jake T (young trenby)",
                "loser": "Carmen Hazard",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "cam hawk",
                "loser": "Zachary Ritz",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Marc Garen",
                "loser": "Dalton Rederick",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "Niall Kelly",
                "loser": "Justin Huffman",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "zach trenberth",
                "loser": "Bob Dylan",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            }
        ],
        "5": [
            {
                "winner": "Timothy taranto",
                "loser": "AL",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jeremy Lesher",
                "loser": "kevin sherry",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "John Opffer",
                "loser": "Aeddon Lukens",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Bobby Taylor",
                "loser": "Owen Moyer",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Jake Mcmillian",
                "loser": "Sean Nessinger",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Quinton Wilckens",
                "loser": "Gerard collin",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Dan Gomba",
                "loser": "kylyn kunkel",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Destiny Wilson",
                "loser": "cam hawk",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true
            },
            {
                "winner": "Tyler Gibson",
                "loser": "Matt Gooding",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Crust M",
                "loser": "Jake T (young trenby)",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Lance Ballester",
                "loser": "Nate Antonioli",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Niall Kelly",
                "loser": "Marc Garen",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Anon-31 last-31",
                "loser": "Tim Wade",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "zach trenberth",
                "loser": "Carmen Hazard",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            },
            {
                "winner": "Zachary Ritz",
                "loser": "Dalton Rederick",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false
            },
            {
                "winner": "Bob Dylan",
                "loser": "Justin Huffman",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false
            }
        ]
    },
    "tops": null
}

const league_id = document.getElementById('league_id');
const date = document.getElementById('date_input');

const start_scrapping_button = document.getElementById('start_scrapping_button');
start_scrapping_button.onclick = startScrapping;

document.getElementById('spice_url').value = "https://www.spicerack.gg/events/2938796/tournament"

async function startScrapping(url) {
	const spice_url = document.getElementById('spice_url').value;
	
	console.log("start scrapping", spice_url);
	// const result = await window.electronAPI.crawlSpiceEvent(spice_url, null);
	const result = tournamentMock;


	const newTournament = result;
	newTournament['league_id'] = league_id;
	newTournament['date'] = date;

	console.log(newTournament);
	
	





	
}

// const tournament_list_table = document.getElementById('ranking_table').getElementsByTagName('tbody')[0];
// const league_id = getUrlParams('id');

// init();

// function init() { }


// function importTournamentCsv() {
	
// }