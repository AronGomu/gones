# Gones

Gones is a pure javascript purely frontend application.
Its goal is allow to register results of tournament, with final standing and all round pairing. From this data, it generates a league standing and player statistics like win between players, deck winrate and more.

## Functonalities

### Leagues

You can create, delete Leagues.
A League contains a list of tournament and a ranking from those tournaments

### Tournaments

A tournament contains a standings of the tournaments and a list of rounds. In a round, there is a list of matchs played between 2 players with a winner + loser, of a draw.

To fill a tournament, you have only 1 way :
- raw text : just paste and format tournament result csv from spicerack into a textarea, you can edit directly within to add missing information. If anything is not properly formatted, an error must be showed indicating the error

You have 1 textarea for the standings each line being a result
Then 1 textarea for each round pairing, each line being a match result

You can then export tournament data as a csv file.

You can also export league tournament data as a zip file containing all tournament data in the league page

### Statistics

When you consult the information of a player. You get all the name of the player and those following statistics calculated from their match played :
- Winrate (you can filter by players)
- % of Deck played
- Nemesis : player he lost the most against
- Rival : player he played the most
[... if you have more idea it's welcomed]

