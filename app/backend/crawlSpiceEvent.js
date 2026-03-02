const puppeteer = require('puppeteer');
const { Standing } = require('../class/Standing.mjs')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSelector(page, selector, timeout = 1000) {
	await page.waitForSelector(selector, {timeout: timeout});
	await page.click(selector);
	return true;
}


async function start(url) {
	const browser = await puppeteer.launch({ headless: false});
	const page = await browser.newPage();
	await page.goto(url);

	await delay(1000);
	const h2_el_list = await page.$$('h2');
	const tournament_name = await h2_el_list[1].evaluate(el =>  el.textContent);

	const tournament = { name: tournament_name, rounds: [], tops: null }

	return {browser,  page, tournament}
}

async function getMatchListResultRoundList(page, tournament) {
	let round_index = 0;
	let has_round = true;
	try {
		while (has_round) {
			await waitForSelector(page, `button::-p-text("Round ${round_index+1}")`)
			const results = await getMatchList(page);
			if (!results) has_round = false;
			else tournament.rounds[round_index] = results;
			round_index++;
		}
	} catch (error) {
		console.log("No more rounds starting from round " + round_index);
		return;
	}
}

async function getMatchListTopList(page, tournament, top_index) {
	tournament.tops = {}
	let has_top = true;
	try {
		while (has_top) {
			if (top_index === 1) break;
			await waitForSelector(page, `button::-p-text("Top ${top_index}")`)
			const results = await getMatchList(page);
			if (!results) has_top = false;
			else tournament.tops[`${top_index}`] = results;
			top_index = top_index / 2;
		}
	} catch (error) {
		console.error("There is top for " + top_index + '!');
		return;
	}
	
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

function getWinsLosesDrawsFromRecord(record) {
	const record_split = record.split('-');
	return {wins: record_split[0], loses: record_split[1], draws: record_split[2]}
}

async function getStandings(page, tournament) {
	await waitForSelector(page, 'td');

	tournament.standings = [];

	const td_list = await page.$$('td');
	if (td_list.length % 7 !== 0) throw new Error("Should always be divisible by 7 because 7 cells !");

	for (let i = 0; i < td_list.length; i++) {
		td_list[i] = await td_list[i].evaluate(el => el.textContent)
	}

	const nb_line = td_list.length / 7;
	for (let i = 0; i < nb_line; i++) {
		const rank = td_list[i*7];
		const player = td_list[i*7+1];
		const points = td_list[i*7+2];
		const record = td_list[i*7+3];
		const omw = td_list[i*7+4];
		const gw = td_list[i*7+5];
		const ogw = td_list[i*7+6];

		const {wins, loses, draws} = getWinsLosesDrawsFromRecord(record);

		tournament.standings.push(new Standing(
			rank, player, points, wins, loses, draws, omw, gw, ogw
		));
	}

	return tournament.standings
}


async function gotoAndGetStandingsAndComeback(page, tournament) {
	await waitForSelector(page, `a::-p-text("Standings")`);
	await getStandings(page, tournament)
	await waitForSelector(page,`a::-p-text("Pairings")`);
}


const crawlSpiceEvent = async function(url, top_index = null) {
	let {browser, page, tournament} = await start(url);

	await getMatchListResultRoundList(page, tournament);
	if (top_index) await getMatchListTopList(page, tournament, top_index);

	await gotoAndGetStandingsAndComeback(page, tournament);

	browser.close();
	return tournament;
};

// EXEMPLE HOW TO USE
// const url = "https://www.spicerack.gg/events/2938796/tournament";
// crawlSpiceEvent(url, 8);


module.exports = crawlSpiceEvent;