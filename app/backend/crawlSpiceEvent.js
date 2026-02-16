const puppeteer = require('puppeteer');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const crawlSpiceEvent = async function(url, top_index = null) {
	// START //
	const browser = await puppeteer.launch( { headless: false});
	const page = await browser.newPage();
	await page.goto(url);
	// START //

	// get tournament name //
	await delay(1000);
	const h2_el_list = await page.$$('h2');
	const tournament_name = await h2_el_list[1].evaluate(el =>  el.textContent);
	// get tournament name //

	const tournament = {
		name: tournament_name,
		rounds: {},
		tops: null,
	}

	let round_index = 1;
	let has_round = true;
	while (has_round) {
		const results = await getMatchListResultRounds(page, round_index);
		if (!results) has_round = false;
		else tournament.rounds[`${round_index}`] = results;
		round_index++;
	}

	// console.log("all rounds dones", tournament, url, top_index);

	browser.close();
	
	if (!top_index) return tournament;

	tournament.tops = {}
	let has_top = true;
	while (has_top) {
		if (top_index === 1) break;

		const results = await getMatchListResultTops(page, top_index);
		if (!results) has_top = false;
		else tournament.tops[`${top_index}`] = results;
		top_index = top_index / 2;

	}

	// console.log('tournament', tournament);
	// console.log(tournament.tops);

	browser.close();

	return tournament;
	
};

async function getMatchListResultRounds(page, round_index) {
	try {
		await page.waitForSelector(
			`button::-p-text("Round ${round_index}")`,
			{timeout: 1000}
		);
		await page.click(`button::-p-text("Round ${round_index}")`);
		
	} catch (error) { return null; }

	return getMatchList(page);
}

async function getMatchListResultTops(page, top_index) {
	try {
		await page.waitForSelector(
			`button::-p-text("Top ${top_index}")`,
			{timeout: 1000}
		);
		await page.click(`button::-p-text("Top ${top_index}")`);
	} catch (error) { return null; }

	return getMatchList(page);
}

async function getMatchList(page) {
	await delay(1000)

	let round_match_list = [];

	await page.waitForFunction(() => document.body.innerText.includes('Table 1'));

	const td_list = await page.$$('td');
	if (td_list.length % 4 !== 0) throw new Error("Should always be divisible by 4 because 4 cells !");

	const nb_line = td_list.length / 4;
	for (let i = 0; i < nb_line; i++) {
		const players_cell_el = td_list[i*4+1];
		const result_cell_el = td_list[i*4+3];

		const players = await getPlayers(players_cell_el);
		const result = await getResult(result_cell_el);

		let winner, loser;
		if (players.player1 === result.winner_name) {
			winner = players.player1;
			loser = players.player2;
		}
		else {
			winner = players.player2;
			loser = players.player1;
		}

		round_match_list.push({
			winner: winner,
			loser: loser,
			winner_score: result.winner_score,
			loser_score: result.loser_score,
			is_draw: result.is_draw,
		});
	}

	return round_match_list
}

async function getPlayers(players_cell_el) {
	const player_el_list = await players_cell_el.$$('span');

	const player1 = await player_el_list[0].evaluate(el => el.textContent.slice(1))
	const player2 = await player_el_list[1].evaluate(el => el.textContent.slice(1))

	return {player1, player2}
}

async function getResult(result_cell_el) {
	const result_el = await result_cell_el.$('p');
	const result = await result_el.evaluate(el => el.textContent);

	if (result === 'Draw') return {
		winner_name: null,
		winner_score: 1,
		loser_score: 1,
		is_draw: true,
	}

	const result_split = result.split(':');
	const winner_name = result_split.at(0);
	const score = result_split[1];
	const score_split = score.split('-')
	const winner_score = Number(score_split[0].slice(1));
	const loser_score = Number(score_split[1]);
	
	return {
		winner_name,
		winner_score,
		loser_score,
		is_draw: false,
	}
}


// EXEMPLE HOW TO USE
// const url = "https://www.spicerack.gg/events/2938796/tournament";
// const top_index
// getTournamentData(url, 8);


module.exports = crawlSpiceEvent;