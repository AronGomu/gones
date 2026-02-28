import {standingsMock1} from './standingsMock1.js'
import {standingsMock2} from './standingsMock2.js'
import { roundsMock } from "./roundsMock.js";

export function getRandomTournamentMock(league_id) {
    return Math.random() < 0.5 ? getTournamentMock1(league_id) : getTournamentMock2(league_id);
}

export function getTournamentMock1(league_id) {
    return {
        "name": "Test Event 1",
        "rounds": roundsMock,
        "tops": null,
        "standings": standingsMock1,
        "league_id": league_id,
        "date": ""
    }
}

export function getTournamentMock2(league_id) {
    return {
        "name": "Test Event 2",
        "rounds": roundsMock,
        "tops": null,
        "standings": standingsMock2,
        "league_id": league_id,
        "date": ""
    }
}