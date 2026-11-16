const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";

function fileOf(index) {
  return index % 8;
}

function rankOf(index) {
  return 8 - Math.floor(index / 8);
}

function toIndex(file, rank) {
  return (8 - rank) * 8 + file;
}

function onBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 1 && rank <= 8;
}

function algebraic(file, rank) {
  return FILES[file] + rank;
}

function algToIndex(text) {
  return toIndex(FILES.indexOf(text[0]), Number(text[1]));
}

function indexAlg(index) {
  return algebraic(fileOf(index), rankOf(index));
}

function parseFen(fen) {
  const [board, turn, castling, ep, half, full] = fen.split(" ");
  const squares = Array(64).fill(null);
  let index = 0;
  for (const char of board) {
    if (char === "/") continue;
    if (char >= "1" && char <= "8") index += Number(char);
    else squares[index++] = char;
  }
  return { squares, turn, castling, ep, half: Number(half), full: Number(full) };
}

function clone(state) {
  return {
    squares: state.squares.slice(),
    turn: state.turn,
    castling: state.castling,
    ep: state.ep,
    half: state.half,
    full: state.full,
  };
}

function toFen(state) {
  let board = "";
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = state.squares[rank * 8 + file];
      if (!piece) empty += 1;
      else {
        if (empty) board += empty;
        empty = 0;
        board += piece;
      }
    }
    if (empty) board += empty;
    if (rank < 7) board += "/";
  }
  const castle = ["K", "Q", "k", "q"].filter((flag) => state.castling.includes(flag)).join("") || "-";
  return `${board} ${state.turn} ${castle} ${state.ep} ${state.half} ${state.full}`;
}

function isWhite(piece) {
  return piece === piece.toUpperCase();
}

function opponent(turn) {
  return turn === "w" ? "b" : "w";
}

function kingIndex(state, turn) {
  const want = turn === "w" ? "K" : "k";
  return state.squares.indexOf(want);
}

function attacked(state, target, by) {
  if (target < 0) return false;
  const byWhite = by === "w";
  const file = fileOf(target);
  const rank = rankOf(target);
  const pawnRank = byWhite ? rank - 1 : rank + 1;
  for (const delta of [-1, 1]) {
    if (!onBoard(file + delta, pawnRank)) continue;
    const piece = state.squares[toIndex(file + delta, pawnRank)];
    if (piece === (byWhite ? "P" : "p")) return true;
  }
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    if (!onBoard(file + df, rank + dr)) continue;
    const piece = state.squares[toIndex(file + df, rank + dr)];
    if (piece === (byWhite ? "N" : "n")) return true;
  }
  const rays = [
    [1, 0, "rq"],
    [-1, 0, "rq"],
    [0, 1, "rq"],
    [0, -1, "rq"],
    [1, 1, "bq"],
    [1, -1, "bq"],
    [-1, 1, "bq"],
    [-1, -1, "bq"],
  ];
  for (const [df, dr, kinds] of rays) {
    let nextFile = file + df;
    let nextRank = rank + dr;
    while (onBoard(nextFile, nextRank)) {
      const piece = state.squares[toIndex(nextFile, nextRank)];
      if (piece) {
        if (isWhite(piece) === byWhite && kinds.includes(piece.toLowerCase())) return true;
        break;
      }
      nextFile += df;
      nextRank += dr;
    }
  }
  for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (!onBoard(file + df, rank + dr)) continue;
    const piece = state.squares[toIndex(file + df, rank + dr)];
    if (piece === (byWhite ? "K" : "k")) return true;
  }
  return false;
}

function applyKnown(state, uci) {
  const from = algToIndex(uci.slice(0, 2));
  const to = algToIndex(uci.slice(2, 4));
  const promo = uci[4];
  const piece = state.squares[from];
  const pawn = piece.toLowerCase() === "p";
  const fileDelta = Math.abs(fileOf(from) - fileOf(to));
  let captured = state.squares[to] != null;
  if (pawn && fileDelta === 1 && state.ep !== "-" && uci.slice(2, 4) === state.ep && !state.squares[to]) {
    state.squares[toIndex(fileOf(to), rankOf(from))] = null;
    captured = true;
  }
  state.squares[to] = piece;
  state.squares[from] = null;
  if (promo) state.squares[to] = state.turn === "w" ? promo.toUpperCase() : promo.toLowerCase();
  if (piece.toLowerCase() === "k" && fileDelta === 2) {
    const rank = rankOf(from);
    if (fileOf(to) === 6) {
      state.squares[toIndex(5, rank)] = state.squares[toIndex(7, rank)];
      state.squares[toIndex(7, rank)] = null;
    } else {
      state.squares[toIndex(3, rank)] = state.squares[toIndex(0, rank)];
      state.squares[toIndex(0, rank)] = null;
    }
  }
  let castle = state.castling;
  const drop = (flag) => {
    castle = castle.replace(flag, "");
  };
  if (from === 60 || to === 60) {
    drop("K");
    drop("Q");
  }
  if (from === 63 || to === 63) drop("K");
  if (from === 56 || to === 56) drop("Q");
  if (from === 4 || to === 4) {
    drop("k");
    drop("q");
  }
  if (from === 7 || to === 7) drop("k");
  if (from === 0 || to === 0) drop("q");
  state.castling = castle;
  if (pawn && Math.abs(rankOf(to) - rankOf(from)) === 2) {
    state.ep = algebraic(fileOf(from), (rankOf(from) + rankOf(to)) / 2);
  } else state.ep = "-";
  state.half = pawn || captured ? 0 : state.half + 1;
  if (state.turn === "b") state.full += 1;
  state.turn = opponent(state.turn);
}

function pseudo(state) {
  const moves = [];
  const white = state.turn === "w";
  const push = (from, file, rank, suffix = "") => {
    moves.push(indexAlg(from) + algebraic(file, rank) + suffix);
  };
  for (let index = 0; index < 64; index++) {
    const piece = state.squares[index];
    if (!piece || isWhite(piece) !== white) continue;
    const kind = piece.toLowerCase();
    const file = fileOf(index);
    const rank = rankOf(index);
    if (kind === "p") {
      const dir = white ? 1 : -1;
      const next = rank + dir;
      if (onBoard(file, next) && !state.squares[toIndex(file, next)]) {
        addPawn(index, file, next);
        const start = white ? 2 : 7;
        const beyond = rank + dir * 2;
        if (rank === start && !state.squares[toIndex(file, beyond)]) addPawn(index, file, beyond);
      }
      for (const delta of [-1, 1]) {
        if (!onBoard(file + delta, next)) continue;
        const dest = state.squares[toIndex(file + delta, next)];
        const ep = algebraic(file + delta, next) === state.ep;
        if ((dest && isWhite(dest) !== white) || (!dest && ep)) addPawn(index, file + delta, next);
      }
    } else if (kind === "n") {
      for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
        step(index, file + df, rank + dr);
      }
    } else if (kind === "k") {
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        step(index, file + df, rank + dr);
      }
    } else {
      const dirs = [];
      if (kind === "b" || kind === "q") dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      if (kind === "r" || kind === "q") dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      for (const [df, dr] of dirs) {
        let nextFile = file + df;
        let nextRank = rank + dr;
        while (onBoard(nextFile, nextRank)) {
          const dest = state.squares[toIndex(nextFile, nextRank)];
          if (!dest) push(index, nextFile, nextRank);
          else {
            if (isWhite(dest) !== white) push(index, nextFile, nextRank);
            break;
          }
          nextFile += df;
          nextRank += dr;
        }
      }
    }
  }
  const back = white ? 1 : 8;
  const kingFlag = white ? "K" : "k";
  const queenFlag = white ? "Q" : "q";
  const opp = opponent(state.turn);
  const king = toIndex(4, back);
  if (state.castling.includes(kingFlag) && clear(5, 6) && rook(7) && safe(4, 5, 6)) {
    push(king, 6, back);
  }
  if (state.castling.includes(queenFlag) && clear(1, 2, 3) && rook(0) && safe(4, 3, 2)) {
    push(king, 2, back);
  }
  return moves;

  function addPawn(from, file, rank) {
    const last = white ? 8 : 1;
    if (rank === last) {
      for (const suffix of ["q", "r", "b", "n"]) push(from, file, rank, suffix);
    } else push(from, file, rank);
  }

  function step(from, file, rank) {
    if (!onBoard(file, rank)) return;
    const dest = state.squares[toIndex(file, rank)];
    if (!dest || isWhite(dest) !== white) push(from, file, rank);
  }

  function clear(...files) {
    return files.every((squareFile) => !state.squares[toIndex(squareFile, back)]);
  }

  function rook(squareFile) {
    const piece = state.squares[toIndex(squareFile, back)];
    return piece && piece.toLowerCase() === "r" && isWhite(piece) === white;
  }

  function safe(...files) {
    return files.every((squareFile) => !attacked(state, toIndex(squareFile, back), opp));
  }
}

function legalMoves(state) {
  const moves = [];
  for (const uci of pseudo(state)) {
    const next = clone(state);
    applyKnown(next, uci);
    if (!attacked(next, kingIndex(next, state.turn), next.turn)) moves.push(uci);
  }
  return moves;
}

function play(fen, uci) {
  const state = parseFen(fen);
  if (!legalMoves(state).includes(uci)) return null;
  applyKnown(state, uci);
  const mover = opponent(state.turn);
  const mate = attacked(state, kingIndex(state, state.turn), mover) && legalMoves(state).length === 0;
  return {
    fen: toFen(state),
    status: mate ? "checkmate" : "playing",
    winner: mate ? (mover === "w" ? "white" : "black") : null,
  };
}

export { START_FEN, play };
