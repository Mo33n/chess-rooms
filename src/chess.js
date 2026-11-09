// Ordinary piece movement and check. No castling, en passant, or promotion.
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

function clone(board) {
  return board.map((row) => row.slice());
}

export function startingBoard() {
  return clone(START);
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
  if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8]$/.test(uci)) return null;
  return {
    fromCol: FILES.indexOf(uci[0]),
    fromRow: 8 - Number(uci[1]),
    toCol: FILES.indexOf(uci[2]),
    toRow: 8 - Number(uci[3]),
  };
}

function toUci(fromRow, fromCol, toRow, toCol) {
  return FILES[fromCol] + (8 - fromRow) + FILES[toCol] + (8 - toRow);
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

function pseudo(board, row, col) {
  const piece = board[row][col];
  const white = isWhite(piece);
  const kind = piece.toLowerCase();
  const out = [];
  if (kind === "p") {
    const dir = white ? -1 : 1;
    const start = white ? 6 : 1;
    const nextRow = row + dir;
    if (onBoard(nextRow, col) && board[nextRow][col] === "." && nextRow !== 0 && nextRow !== 7) {
      out.push([nextRow, col]);
      const jump = row + 2 * dir;
      if (row === start && board[jump][col] === ".") out.push([jump, col]);
    }
    for (const dCol of [-1, 1]) {
      const nextCol = col + dCol;
      if (!onBoard(nextRow, nextCol) || nextRow === 0 || nextRow === 7) continue;
      const target = board[nextRow][nextCol];
      if (target !== "." && target.toLowerCase() !== "k" && (white ? isBlack(target) : isWhite(target))) {
        out.push([nextRow, nextCol]);
      }
    }
  } else if (kind === "n") {
    for (const [dRow, dCol] of KNIGHT) {
      const nextRow = row + dRow;
      const nextCol = col + dCol;
      if (onBoard(nextRow, nextCol) && canLand(board, nextRow, nextCol, white)) out.push([nextRow, nextCol]);
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
        if (onBoard(nextRow, nextCol) && canLand(board, nextRow, nextCol, white)) out.push([nextRow, nextCol]);
      }
    }
  }
  return out;
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

function leavesKing(board, row, col, toRow, toCol, white) {
  const next = clone(board);
  next[toRow][toCol] = next[row][col];
  next[row][col] = ".";
  const king = findKing(next, white);
  if (!king || attacked(next, king[0], king[1], !white)) return null;
  return next;
}

export function legalMoves(board, whiteTurn) {
  const moves = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece === ".") continue;
      if (whiteTurn ? !isWhite(piece) : !isBlack(piece)) continue;
      for (const [toRow, toCol] of pseudo(board, row, col)) {
        if (leavesKing(board, row, col, toRow, toCol, whiteTurn)) moves.push(toUci(row, col, toRow, toCol));
      }
    }
  }
  return moves;
}

// Returns the board after a legal move, or null. checkmate is the opponent to move.
export function play(board, uci, whiteTurn) {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  const piece = board[parsed.fromRow][parsed.fromCol];
  if (piece === "." || (whiteTurn ? !isWhite(piece) : !isBlack(piece))) return null;
  const next = leavesKing(board, parsed.fromRow, parsed.fromCol, parsed.toRow, parsed.toCol, whiteTurn);
  if (!next) return null;
  const reachable = pseudo(board, parsed.fromRow, parsed.fromCol)
    .some(([row, col]) => row === parsed.toRow && col === parsed.toCol);
  if (!reachable) return null;
  const opponentWhite = !whiteTurn;
  const king = findKing(next, opponentWhite);
  const inCheck = king && attacked(next, king[0], king[1], whiteTurn);
  const replies = legalMoves(next, opponentWhite);
  return { board: next, checkmate: Boolean(inCheck && replies.length === 0) };
}
