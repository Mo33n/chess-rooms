Chess rooms is a local web app where several chess games run at once, and a tournament opens one room per pairing.

There are no accounts and no database. Restarting the server clears every room and tournament. A player is a name plus a seat token returned when they sit down. That token is what lets them move.

Play
A person creates a named room and opens it in the browser. Two people sit in the same room, one as white and one as black, from two browsers. A seat already taken by someone else is refused. Both browsers show the same board and pick up the other person's move within a couple of seconds.

Moves are legal chess only. The game knows check, checkmate, and stalemate, including castling, en passant, and promotion. Scholar's mate (e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7) ends as checkmate for white. An illegal move, or a move after the game is over, is refused.

Tournament
A person creates a named tournament, adds at least two player names, and starts it. The start opens a room for each pairing in the round. A tournament room only lets the paired name sit in that seat.

A checkmate in a pairing's room records the result on its own. Someone can also report 1-0, 0-1, or 1/2-1/2 when the game was not already finished. The next round starts only after every pairing in the current round has a result.

Page
One page shows three areas: the list of rooms, the board, and the tournaments. The rooms area is id="rooms", the board is id="board", and the tournaments area is id="tournaments".

Out of scope
No login, no saved history, no clock, no chat, and no computer opponent.
