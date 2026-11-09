// Piece movement, check, castling, en passant, promotion, and stalemate.
const FILES = "abcdefgh";

const START = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  [".", ".", ".", ".", ".", ".", ".", "."],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const FULL_CASTLE = "KQkq";

function clone(board) {
  return board.map((row) => row.slice());
}

export function startingBoard() {
  return clone(START);
}

export function startingCastle() {
  return FULL_CASTLE;
}

function onBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function isWhite(piece) {
  return piece >= "A" && piece <= "Z";
}

function isBlack(piece) {
  return piece >= "a" && piece <= "z";
}

function parseUci(uci) {
  if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return {
    fromCol: FILES.indexOf(uci[0]),
    fromRow: 8 - Number(uci[1]),
    toCol: FILES.indexOf(uci[2]),
    toRow: 8 - Number(uci[3]),
    promo: uci[4] || "",
  };
}

function toUci(fromRow, fromCol, toRow, toCol, promo) {
  return FILES[fromCol] + (8 - fromRow) + FILES[toCol] + (8 - toRow) + (promo || "");
}

function canLand(board, row, col, white) {
  const piece = board[row][col];
  if (piece === "." || piece.toLowerCase() === "k") return piece === ".";
  return white ? isBlack(piece) : isWhite(piece);
}

function slide(board, row, col, white, dirs, out) {
  for (const [dRow, dCol] of dirs) {
    let nextRow = row + dRow;
    let nextCol = col + dCol;
    while (onBoard(nextRow, nextCol)) {
      const piece = board[nextRow][nextCol];
      if (piece === ".") out.push([nextRow, nextCol]);
      else {
        if (piece.toLowerCase() !== "k" && (white ? isBlack(piece) : isWhite(piece))) {
          out.push([nextRow, nextCol]);
        }
        break;
      }
      nextRow += dRow;
      nextCol += dCol;
    }
  }
}

function pseudo(board, row, col, ep) {
  const piece = board[row][col];
  const white = isWhite(piece);
  const kind = piece.toLowerCase();
  const out = [];
  if (kind === "p") {
    const dir = white ? -1 : 1;
    const start = white ? 6 : 1;
    const nextRow = row + dir;
    if (onBoard(nextRow, col) && board[nextRow][col] === ".") {
      out.push([nextRow, col, nextRow === 0 || nextRow === 7]);
      const jump = row + 2 * dir;
      if (row === start && board[jump][col] === ".") out.push([jump, col, false]);
    }
    for (const dCol of [-1, 1]) {
      const nextCol = col + dCol;
      if (!onBoard(nextRow, nextCol)) continue;
      const target = board[nextRow][nextCol];
      const capture = target !== "." && target.toLowerCase() !== "k" && (white ? isBlack(target) : isWhite(target));
      const passant = ep && ep.row === nextRow && ep.col === nextCol && target === ".";
      if (capture || passant) out.push([nextRow, nextCol, nextRow === 0 || nextRow === 7]);
    }
  } else if (kind === "n") {
    for (const [dRow, dCol] of KNIGHT) {
      const nextRow = row + dRow;
      const nextCol = col + dCol;
      if (onBoard(nextRow, nextCol) && canLand(board, nextRow, nextCol, white)) out.push([nextRow, nextCol, false]);
    }
  } else if (kind === "b") slide(board, row, col, white, BISHOP, out);
  else if (kind === "r") slide(board, row, col, white, ROOK, out);
  else if (kind === "q") slide(board, row, col, white, [...BISHOP, ...ROOK], out);
  else if (kind === "k") {
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        if (!dRow && !dCol) continue;
        const nextRow = row + dRow;
        const nextCol = col + dCol;
        if (onBoard(nextRow, nextCol) && canLand(board, nextRow, nextCol, white)) out.push([nextRow, nextCol, false]);
      }
    }
  }
  return out.map(([toRow, toCol, promote]) => (promote ? [toRow, toCol, true] : [toRow, toCol, false]));
}

function rayHits(board, row, col, dRow, dCol, byWhite, kinds) {
  let nextRow = row + dRow;
  let nextCol = col + dCol;
  while (onBoard(nextRow, nextCol)) {
    const piece = board[nextRow][nextCol];
    if (piece !== ".") {
      return (byWhite ? isWhite(piece) : isBlack(piece)) && kinds.includes(piece);
    }
    nextRow += dRow;
    nextCol += dCol;
  }
  return false;
}

function attacked(board, row, col, byWhite) {
  const pawnRow = row + (byWhite ? 1 : -1);
  for (const dCol of [-1, 1]) {
    const pawnCol = col + dCol;
    if (!onBoard(pawnRow, pawnCol)) continue;
    const piece = board[pawnRow][pawnCol];
    if (byWhite && piece === "P") return true;
    if (!byWhite && piece === "p") return true;
  }
  for (const [dRow, dCol] of KNIGHT) {
    const nextRow = row + dRow;
    const nextCol = col + dCol;
    if (!onBoard(nextRow, nextCol)) continue;
    const piece = board[nextRow][nextCol];
    if (byWhite && piece === "N") return true;
    if (!byWhite && piece === "n") return true;
  }
  for (const [dRow, dCol] of BISHOP) {
    if (rayHits(board, row, col, dRow, dCol, byWhite, byWhite ? "BQ" : "bq")) return true;
  }
  for (const [dRow, dCol] of ROOK) {
    if (rayHits(board, row, col, dRow, dCol, byWhite, byWhite ? "RQ" : "rq")) return true;
  }
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      if (!dRow && !dCol) continue;
      const nextRow = row + dRow;
      const nextCol = col + dCol;
      if (!onBoard(nextRow, nextCol)) continue;
      const piece = board[nextRow][nextCol];
      if (byWhite && piece === "K") return true;
      if (!byWhite && piece === "k") return true;
    }
  }
  return false;
}

function findKing(board, white) {
  const king = white ? "K" : "k";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (board[row][col] === king) return [row, col];
    }
  }
  return null;
}

export function sideInCheck(board, whiteTurn) {
  const king = findKing(board, whiteTurn);
  return Boolean(king && attacked(board, king[0], king[1], !whiteTurn));
}

function applySimple(board, row, col, toRow, toCol, promo, white) {
  const next = clone(board);
  const piece = next[row][col];
  if (promo) next[toRow][toCol] = white ? promo.toUpperCase() : promo;
  else next[toRow][toCol] = piece;
  next[row][col] = ".";
  return next;
}

function safe(board, white) {
  const king = findKing(board, white);
  return Boolean(king && !attacked(board, king[0], king[1], !white));
}

function castleTargets(white) {
  const row = white ? 7 : 0;
  const flag = white ? ["K", "Q"] : ["k", "q"];
  return [
    { flag: flag[0], kingTo: 6, rookFrom: 7, rookTo: 5, empty: [5, 6], pass: [4, 5, 6] },
    { flag: flag[1], kingTo: 2, rookFrom: 0, rookTo: 3, empty: [1, 2, 3], pass: [4, 3, 2] },
  ].map((entry) => ({ ...entry, row }));
}

function castleBoard(board, white, which) {
  const next = clone(board);
  const king = white ? "K" : "k";
  const rook = white ? "R" : "r";
  next[which.row][4] = ".";
  next[which.row][which.rookFrom] = ".";
  next[which.row][which.kingTo] = king;
  next[which.row][which.rookTo] = rook;
  return next;
}

function canCastle(board, white, rights, which) {
  if (!rights.includes(which.flag)) return false;
  const king = white ? "K" : "k";
  const rook = white ? "R" : "r";
  if (board[which.row][4] !== king || board[which.row][which.rookFrom] !== rook) return false;
  if (which.empty.some((col) => board[which.row][col] !== ".")) return false;
  if (which.pass.some((col) => attacked(board, which.row, col, !white))) return false;
  return true;
}

function rightsAfter(rights, board, fromRow, fromCol) {
  let next = rights;
  const piece = board[fromRow][fromCol];
  const drop = (flag) => {
    next = next.replace(flag, "");
  };
  if (piece === "K") drop("K"), drop("Q");
  if (piece === "k") drop("k"), drop("q");
  if (piece === "R" && fromRow === 7 && fromCol === 7) drop("K");
  if (piece === "R" && fromRow === 7 && fromCol === 0) drop("Q");
  if (piece === "r" && fromRow === 0 && fromCol === 7) drop("k");
  if (piece === "r" && fromRow === 0 && fromCol === 0) drop("q");
  return next;
}

function epAfter(board, fromRow, fromCol, toRow, toCol) {
  const piece = board[fromRow][fromCol];
  if (piece === "P" && fromRow === 6 && toRow === 4 && fromCol === toCol) return { row: 5, col: toCol };
  if (piece === "p" && fromRow === 1 && toRow === 3 && fromCol === toCol) return { row: 2, col: toCol };
  return null;
}

export function legalMoves(board, whiteTurn, state) {
  const rights = state?.castle ?? "";
  const ep = state?.ep ?? null;
  const moves = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece === ".") continue;
      if (whiteTurn ? !isWhite(piece) : !isBlack(piece)) continue;
      for (const [toRow, toCol, promote] of pseudo(board, row, col, ep)) {
        const letters = promote ? ["q", "r", "b", "n"] : [""];
        for (const letter of letters) {
          const next = applyPlaced(board, row, col, toRow, toCol, letter, whiteTurn, ep);
          if (next && safe(next, whiteTurn)) moves.push(toUci(row, col, toRow, toCol, letter));
        }
      }
    }
  }
  for (const which of castleTargets(whiteTurn)) {
    if (!canCastle(board, whiteTurn, rights, which)) continue;
    moves.push(toUci(which.row, 4, which.row, which.kingTo));
  }
  return moves;
}

function applyPlaced(board, row, col, toRow, toCol, promo, white, ep) {
  const piece = board[row][col];
  const passant = ep && piece.toLowerCase() === "p" && toRow === ep.row && toCol === ep.col && col !== toCol;
  if (passant) {
    const capturedRow = white ? ep.row + 1 : ep.row - 1;
    const victim = board[capturedRow][ep.col];
    if (victim !== (white ? "p" : "P")) return null;
    const next = applySimple(board, row, col, toRow, toCol, "", white);
    next[capturedRow][ep.col] = ".";
    return next;
  }
  if (promo && piece.toLowerCase() !== "p") return null;
  return applySimple(board, row, col, toRow, toCol, promo, white);
}

function finish(nextBoard, whiteTurn, castle, ep) {
  const opponentWhite = !whiteTurn;
  const check = sideInCheck(nextBoard, opponentWhite);
  const replies = legalMoves(nextBoard, opponentWhite, { castle, ep });
  return {
    board: nextBoard,
    checkmate: Boolean(check && replies.length === 0),
    stalemate: Boolean(!check && replies.length === 0),
    castle,
    ep,
  };
}

// playing, check, checkmate, or stalemate for the side about to move.
export function classify(board, whiteTurn, state) {
  const check = sideInCheck(board, whiteTurn);
  const moves = legalMoves(board, whiteTurn, state);
  if (moves.length === 0) return check ? "checkmate" : "stalemate";
  return check ? "check" : "playing";
}

// Returns the board after a legal move, or null.
export function play(board, uci, whiteTurn, state) {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  const rights = state?.castle ?? FULL_CASTLE;
  const ep = state?.ep ?? null;
  const piece = board[parsed.fromRow][parsed.fromCol];
  if (piece === "." || (whiteTurn ? !isWhite(piece) : !isBlack(piece))) return null;
  if (parsed.promo && piece.toLowerCase() !== "p") return null;

  const kingHome = piece.toLowerCase() === "k" && parsed.fromCol === 4 && Math.abs(parsed.toCol - 4) === 2 && parsed.fromRow === parsed.toRow;
  if (kingHome) {
    if (parsed.promo) return null;
    const which = castleTargets(whiteTurn).find((entry) => entry.kingTo === parsed.toCol && entry.row === parsed.fromRow);
    if (!which || !canCastle(board, whiteTurn, rights, which)) return null;
    const next = castleBoard(board, whiteTurn, which);
    const castle = rightsAfter(rights, board, parsed.fromRow, parsed.fromCol);
    return finish(next, whiteTurn, castle, null);
  }

  const choices = pseudo(board, parsed.fromRow, parsed.fromCol, ep);
  const match = choices.find(([row, col]) => row === parsed.toRow && col === parsed.toCol);
  if (!match) return null;
  const promote = match[2];
  if (promote && !parsed.promo) return null;
  if (!promote && parsed.promo) return null;
  const next = applyPlaced(board, parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol, parsed.promo, whiteTurn, ep);
  if (!next || !safe(next, whiteTurn)) return null;
  const castle = rightsAfter(rights, board, parsed.fromRow, parsed.fromCol);
  const nextEp = epAfter(board, parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol);
  return finish(next, whiteTurn, castle, nextEp);
}
