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


export const gones4 = {
    "name": "Gones League 6 - Day 4",
    "rounds": [
        [
            {
                "winner": "Thomas Clabaut",
                "loser": "bye",
                "winner_score": 1,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": true
            },
            {
                "winner": "Yo Plz",
                "loser": "Alex Daxe",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Samuel Brochet",
                "loser": "Gaël Lacroix",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Nurgle V",
                "loser": "Dimitri Grangeon",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true,
                "is_bye": false
            },
            {
                "winner": "Romain CORGNOLO",
                "loser": "Florent Jugnet",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Thomas Drescher",
                "loser": "Riccardo Giusti",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Timothée Oliger",
                "loser": "Stefano Valdemarin",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Maxime Oulès",
                "loser": "Simon Jugnet",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Louis JULLIEN",
                "loser": "Eric  Confortini ",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Nicolas Righi",
                "loser": "Benoît Guenin",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            }
        ],
        [
            {
                "winner": "Benoît Guenin",
                "loser": "bye",
                "winner_score": 1,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": true
            },
            {
                "winner": "Yo Plz",
                "loser": "Timothée Oliger",
                "winner_score": 1,
                "loser_score": 1,
                "is_draw": true,
                "is_bye": false
            },
            {
                "winner": "Romain CORGNOLO",
                "loser": "Louis JULLIEN",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Nicolas Righi",
                "loser": "Thomas Clabaut",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Samuel Brochet",
                "loser": "Maxime Oulès",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Thomas Drescher",
                "loser": "Nurgle V",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Riccardo Giusti",
                "loser": "Dimitri Grangeon",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Florent Jugnet",
                "loser": "Stefano Valdemarin",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Eric  Confortini ",
                "loser": "Gaël Lacroix",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Alex Daxe",
                "loser": "Simon Jugnet",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            }
        ],
        [
            {
                "winner": "Simon Jugnet",
                "loser": "bye",
                "winner_score": 1,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": true
            },
            {
                "winner": "Romain CORGNOLO",
                "loser": "Samuel Brochet",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Nicolas Righi",
                "loser": "Thomas Drescher",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Timothée Oliger",
                "loser": "Riccardo Giusti",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Yo Plz",
                "loser": "Louis JULLIEN",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Maxime Oulès",
                "loser": "Benoît Guenin",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Florent Jugnet",
                "loser": "Eric  Confortini ",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Thomas Clabaut",
                "loser": "Alex Daxe",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Gaël Lacroix",
                "loser": "Dimitri Grangeon",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Stefano Valdemarin",
                "loser": "Nurgle V",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            }
        ],
        [
            {
                "winner": "Dimitri Grangeon",
                "loser": "bye",
                "winner_score": 1,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": true
            },
            {
                "winner": "Romain CORGNOLO",
                "loser": "Nicolas Righi",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Timothée Oliger",
                "loser": "Maxime Oulès",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Yo Plz",
                "loser": "Florent Jugnet",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Thomas Drescher",
                "loser": "Samuel Brochet",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Thomas Clabaut",
                "loser": "Riccardo Giusti",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Gaël Lacroix",
                "loser": "Benoît Guenin",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Stefano Valdemarin",
                "loser": "Eric  Confortini ",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Alex Daxe",
                "loser": "Louis JULLIEN",
                "winner_score": 2,
                "loser_score": 1,
                "is_draw": false,
                "is_bye": false
            },
            {
                "winner": "Simon Jugnet",
                "loser": "Nurgle V",
                "winner_score": 2,
                "loser_score": 0,
                "is_draw": false,
                "is_bye": false
            }
        ]
    ],
    "tops": null,
    "standings": [
        {
            "rank": 1,
            "player": "Romain CORGNOLO",
            "points": 12,
            "record": "4-0-0",
            "omw": 0.52,
            "gw": 0.7272,
            "ogw": 0.5006,
            "win": 4,
            "draw": 0,
            "lose": 0
        },
        {
            "rank": 2,
            "player": "Yo Plz",
            "points": 10,
            "record": "3-0-1",
            "omw": 0.5407,
            "gw": 0.8148,
            "ogw": 0.5076,
            "win": 3,
            "draw": 1,
            "lose": 0
        },
        {
            "rank": 3,
            "player": "Timothée Oliger",
            "points": 10,
            "record": "3-0-1",
            "omw": 0.5407,
            "gw": 0.6667,
            "ogw": 0.5397,
            "win": 3,
            "draw": 1,
            "lose": 0
        },
        {
            "rank": 4,
            "player": "Nicolas Righi",
            "points": 9,
            "record": "3-1-0",
            "omw": 0.7075,
            "gw": 0.5833,
            "ogw": 0.649,
            "win": 3,
            "draw": 0,
            "lose": 1
        },
        {
            "rank": 5,
            "player": "Thomas Clabaut",
            "points": 9,
            "record": "3-1-0",
            "omw": 0.5266,
            "gw": 0.6364,
            "ogw": 0.4944,
            "win": 3,
            "draw": 0,
            "lose": 1
        },
        {
            "rank": 6,
            "player": "Thomas Drescher",
            "points": 9,
            "record": "3-1-0",
            "omw": 0.4775,
            "gw": 0.7778,
            "ogw": 0.4672,
            "win": 3,
            "draw": 0,
            "lose": 1
        },
        {
            "rank": 7,
            "player": "Samuel Brochet",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.6875,
            "gw": 0.5556,
            "ogw": 0.6149,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 8,
            "player": "Florent Jugnet",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.6657,
            "gw": 0.5,
            "ogw": 0.5875,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 9,
            "player": "Alex Daxe",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.6032,
            "gw": 0.5,
            "ogw": 0.5787,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 10,
            "player": "Maxime Oulès",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.5407,
            "gw": 0.5,
            "ogw": 0.5442,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 11,
            "player": "Stefano Valdemarin",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.4983,
            "gw": 0.4444,
            "ogw": 0.4651,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 12,
            "player": "Simon Jugnet",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.4433,
            "gw": 0.5,
            "ogw": 0.4433,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 13,
            "player": "Gaël Lacroix",
            "points": 6,
            "record": "2-2-0",
            "omw": 0.3733,
            "gw": 0.4545,
            "ogw": 0.4545,
            "win": 2,
            "draw": 0,
            "lose": 2
        },
        {
            "rank": 14,
            "player": "Dimitri Grangeon",
            "points": 4,
            "record": "1-2-1",
            "omw": 0.3867,
            "gw": 0.4444,
            "ogw": 0.3948,
            "win": 1,
            "draw": 1,
            "lose": 2
        },
        {
            "rank": 15,
            "player": "Riccardo Giusti",
            "points": 3,
            "record": "1-3-0",
            "omw": 0.6667,
            "gw": 0.4,
            "ogw": 0.6313,
            "win": 1,
            "draw": 0,
            "lose": 3
        },
        {
            "rank": 16,
            "player": "Louis JULLIEN",
            "points": 3,
            "record": "1-3-0",
            "omw": 0.6657,
            "gw": 0.3636,
            "ogw": 0.6014,
            "win": 1,
            "draw": 0,
            "lose": 3
        },
        {
            "rank": 17,
            "player": "Benoît Guenin",
            "points": 3,
            "record": "1-3-0",
            "omw": 0.5833,
            "gw": 0.4545,
            "ogw": 0.5125,
            "win": 1,
            "draw": 0,
            "lose": 3
        },
        {
            "rank": 18,
            "player": "Eric  Confortini ",
            "points": 3,
            "record": "1-3-0",
            "omw": 0.4575,
            "gw": 0.3636,
            "ogw": 0.4407,
            "win": 1,
            "draw": 0,
            "lose": 3
        },
        {
            "rank": 19,
            "player": "Nurgle V",
            "points": 1,
            "record": "0-3-1",
            "omw": 0.5208,
            "gw": 0.33,
            "ogw": 0.5417,
            "win": 0,
            "draw": 1,
            "lose": 3
        }
    ],
    "league_id": "1772020531244"
}