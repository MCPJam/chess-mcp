import { Chess, SQUARES } from "chess.js";
import { z } from "zod";

interface ChessState {
  fen: string;
  turn: "w" | "b";
  inCheck: boolean;
  isGameOver: boolean;
  result: "white" | "black" | "draw" | null;
  moveHistory: string[];
}

export function createChessViewTools(options: {
  game: Chess;
  getState: () => ChessState;
  publishState: (reason: string) => void;
  identity: string;
  asciiBoard: (fen: string) => string;
}): WebMCP.ModelContextTool[] {
  const { game, getState, publishState, identity, asciiBoard } = options;
  const state = () => ({
    ...getState(), identity, board: asciiBoard(game.fen()),
    youArePlaying: "b", userIsPlaying: "w"
  });
  const define = <S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    execute: (input: z.output<S>) => unknown,
    readOnlyHint: boolean
  ): WebMCP.ModelContextTool => ({
    name, description, inputSchema: z.toJSONSchema(schema),
    annotations: { readOnlyHint },
    execute: (input, { signal }) => {
      signal.throwIfAborted();
      return execute(schema.parse(input));
    }
  });
  const empty = z.object({});
  const square = z.enum(SQUARES);
  const move = z.object({
    san: z.string().min(1).optional(),
    from: square.optional(), to: square.optional(),
    promotion: z.enum(["q", "r", "b", "n"]).optional()
  }).refine(input => Boolean(input.san) || Boolean(input.from && input.to), {
    message: "Provide either san or both from and to"
  });
  return [
    define("get_board_state", "Get the current chess board, turn, check and result.",
      empty, () => state(), true),
    define("get_legal_moves", "List legal moves for the side to move; optionally filter by from square.",
      z.object({ from: square.optional() }), ({ from }) => ({
        ...state(),
        moves: game.moves({ verbose: true, square: from })
          .map(({ san, from, to, promotion }) => ({ san, from, to, promotion }))
      }), true),
    define("make_move", "Play a legal chess move using san or from, to and optional promotion.",
      move, ({ san, from, to, promotion }) => {
        if (game.isGameOver()) throw new Error("Game is over");
        if (!san && (!from || !to)) throw new Error("Provide san or from and to");
        const played = san ? game.move(san) : from && to ? game.move({ from, to, promotion: promotion ?? "q" }) : null;
        if (!played) throw new Error("Move is not legal");
        publishState(`view tool make_move ${played.san}`);
        return { ...state(), sanPlayed: played.san };
      }, false),
    define("reset_game", "Reset the board to the starting position with White to move.",
      empty, () => {
        game.reset();
        publishState("view tool reset_game");
        return state();
      }, false)
  ];
}
