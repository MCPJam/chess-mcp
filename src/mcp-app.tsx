import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables
} from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import "./global.css";

type Turn = "w" | "b";
type Result = "white" | "black" | "draw" | null;

type BoardState = {
  fen: string;
  turn: Turn;
  inCheck: boolean;
  isGameOver: boolean;
  result: Result;
  moveHistory: string[];
};

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const MODEL_COLOR: Turn = "b";
const USER_COLOR: Turn = "w";
const MODEL_COLOR_NAME = "Black";
const USER_COLOR_NAME = "White";
const IDENTITY_LINE = `You are playing ${MODEL_COLOR_NAME} (lowercase pieces in FEN). The user is ${USER_COLOR_NAME} (uppercase pieces in FEN).`;

function asciiBoard(fen: string): string {
  const placement = fen.split(" ")[0] ?? "";
  const ranks = placement.split("/");
  const lines: string[] = [];
  for (let i = 0; i < ranks.length; i++) {
    const rankNumber = 8 - i;
    let line = `${rankNumber} `;
    for (const ch of ranks[i]) {
      if (/[1-8]/.test(ch)) {
        line += ". ".repeat(Number(ch));
      } else {
        line += `${ch} `;
      }
    }
    lines.push(line.trimEnd());
  }
  lines.push("  a b c d e f g h");
  return lines.join("\n");
}

const app = new App(
  { name: "Chess", version: "0.1.0" },
  {
    tools: { listChanged: true },
    availableDisplayModes: ["inline", "fullscreen"]
  }
);

const game = new Chess();
let bridgeConnected = false;

function computeResult(g: Chess): Result {
  if (!g.isGameOver()) return null;
  if (g.isCheckmate()) {
    // The player to move has been checkmated → the other side wins.
    return g.turn() === "w" ? "black" : "white";
  }
  return "draw";
}

function getSemanticState(): BoardState {
  return {
    fen: game.fen(),
    turn: game.turn() as Turn,
    inCheck: game.inCheck(),
    isGameOver: game.isGameOver(),
    result: computeResult(game),
    moveHistory: game.history()
  };
}

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

function renderStatus(state: BoardState): void {
  if (state.isGameOver) {
    if (state.result === "draw") statusEl.textContent = "Draw.";
    else if (state.result === "white") statusEl.textContent = "White wins!";
    else if (state.result === "black") statusEl.textContent = "Black wins!";
    else statusEl.textContent = "Game over.";
    return;
  }
  const turnLabel = state.turn === "w" ? "White" : "Black";
  statusEl.textContent = state.inCheck
    ? `Turn: ${turnLabel} (check)`
    : `Turn: ${turnLabel}`;
}

// React subscription store — the board re-renders whenever the FEN changes.
type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  for (const l of listeners) l();
}

function useGameSnapshot(): BoardState {
  const [snapshot, setSnapshot] = useState<BoardState>(() => getSemanticState());
  useEffect(() => {
    const listener: Listener = () => setSnapshot(getSemanticState());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}

async function pushModelContext(reason: string): Promise<void> {
  if (!bridgeConnected) return;
  const semanticState = getSemanticState();
  const toMove = semanticState.turn === MODEL_COLOR ? "you" : "the user";
  try {
    await app.updateModelContext({
      content: [
        {
          type: "text",
          text:
            `${IDENTITY_LINE}\n` +
            `Chess state (${reason}): fen=${semanticState.fen}; turn=${semanticState.turn} (${toMove} to move);` +
            ` inCheck=${semanticState.inCheck}; gameOver=${semanticState.isGameOver};` +
            ` result=${semanticState.result ?? "none"};` +
            ` history=${semanticState.moveHistory.join(" ")}\n` +
            `Board (uppercase=${USER_COLOR_NAME}/user, lowercase=${MODEL_COLOR_NAME}/you):\n${asciiBoard(semanticState.fen)}`
        }
      ],
      structuredContent: {
        ...semanticState,
        youArePlaying: MODEL_COLOR,
        userIsPlaying: USER_COLOR
      }
    });
  } catch {
    // ignore
  }
}

function publishState(reason: string): void {
  const snapshot = getSemanticState();
  renderStatus(snapshot);
  notify();
  void pushModelContext(reason);
}

async function promptModelToMove(playedSan: string): Promise<void> {
  if (!bridgeConnected) return;
  if (game.isGameOver()) return;
  try {
    await app.sendMessage({
      role: "user",
      content: {
        type: "text",
        text:
          `${IDENTITY_LINE}\n` +
          `I (${USER_COLOR_NAME}) just played ${playedSan}. It is now your turn as ${MODEL_COLOR_NAME}.` +
          ` Call make_move with a legal SAN (e.g. "e5", "Nf6") or { from, to, promotion? }.`
      }
    });
  } catch {
    // ignore
  }
}

function tryLocalMove(from: string, to: string, promotion?: string): string | null {
  try {
    const move = game.move({ from, to, promotion: promotion ?? "q" });
    return move ? move.san : null;
  } catch {
    return null;
  }
}

function ChessApp(): JSX.Element {
  const snapshot = useGameSnapshot();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(360);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const boardOrientation = useMemo<"white" | "black">(() => "white", []);

  function onPieceDrop(source: string, target: string): boolean {
    const san = tryLocalMove(source, target);
    if (!san) return false;
    publishState(`local move ${san}`);
    void promptModelToMove(san);
    return true;
  }

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%" }}>
      <Chessboard
        position={snapshot.fen}
        onPieceDrop={onPieceDrop}
        boardWidth={width}
        arePiecesDraggable={!snapshot.isGameOver}
        boardOrientation={boardOrientation}
        customNotationStyle={{
          fontSize: "18px",
          fontWeight: 800,
          color: "#2a1a0a",
          opacity: 1
        }}
      />
    </div>
  );
}

function applyHostContext(): void {
  const context = app.getHostContext();
  console.log("[chess-mcp] hostContext", context);
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }
  // Hosts may omit `theme`. Without a value the SDK leaves `color-scheme`
  // unset, so `light-dark()` in global.css follows the user's OS preference
  // and looks dark even when the host chrome is light. Default to light.
  applyDocumentTheme(context?.theme ?? "light");
}

// App tools — semantic surface the model can call to introspect / drive the game.

app.registerTool(
  "get_board_state",
  {
    description:
      "Get the current chess board (FEN), whose turn it is, whether the side to move is in check, and the result if the game is over.",
    outputSchema: z.object({
      fen: z.string(),
      turn: z.enum(["w", "b"]),
      inCheck: z.boolean(),
      isGameOver: z.boolean(),
      result: z.union([z.enum(["white", "black", "draw"]), z.null()]),
      moveHistory: z.array(z.string())
    }),
    annotations: { readOnlyHint: true }
  },
  async () => {
    const state = getSemanticState();
    const toMove = state.turn === MODEL_COLOR ? "you" : "the user";
    return {
      content: [
        {
          type: "text",
          text:
            `${IDENTITY_LINE}\n` +
            `FEN: ${state.fen} | turn: ${state.turn} (${toMove} to move) | check: ${state.inCheck} | result: ${state.result ?? "ongoing"}\n` +
            `Board (uppercase=${USER_COLOR_NAME}/user, lowercase=${MODEL_COLOR_NAME}/you):\n${asciiBoard(state.fen)}`
        }
      ],
      structuredContent: {
        ...state,
        youArePlaying: MODEL_COLOR,
        userIsPlaying: USER_COLOR
      }
    };
  }
);

app.registerTool(
  "get_legal_moves",
  {
    description:
      "List all legal moves for the side to move (in SAN). Optionally filter by `from` square (e.g. 'e2').",
    inputSchema: z.object({
      from: z.string().min(2).max(2).optional()
    }),
    outputSchema: z.object({
      turn: z.enum(["w", "b"]),
      moves: z.array(
        z.object({
          san: z.string(),
          from: z.string(),
          to: z.string(),
          promotion: z.string().optional()
        })
      )
    }),
    annotations: { readOnlyHint: true }
  },
  async ({ from }) => {
    const verbose = game.moves({ verbose: true, square: from as Square | undefined }) as Array<{
      san: string;
      from: string;
      to: string;
      promotion?: string;
    }>;
    const moves = verbose.map((m) => ({
      san: m.san,
      from: m.from,
      to: m.to,
      promotion: m.promotion
    }));
    return {
      content: [
        {
          type: "text",
          text: `Legal moves (${moves.length}): ${moves.map((m) => m.san).join(", ") || "none"}`
        }
      ],
      structuredContent: {
        turn: game.turn() as Turn,
        moves
      }
    };
  }
);

app.registerTool(
  "make_move",
  {
    description:
      "Play a chess move. Provide either `san` (e.g. 'e4', 'Nf3', 'O-O', 'exd5') or { from, to, promotion? }. The move must be legal for the side to move.",
    inputSchema: z
      .object({
        san: z.string().optional(),
        from: z.string().min(2).max(2).optional(),
        to: z.string().min(2).max(2).optional(),
        promotion: z.enum(["q", "r", "b", "n"]).optional()
      })
      .refine(
        (v) => Boolean(v.san) || (Boolean(v.from) && Boolean(v.to)),
        { message: "provide either `san` or both `from` and `to`" }
      ),
    outputSchema: z.object({
      fen: z.string(),
      turn: z.enum(["w", "b"]),
      inCheck: z.boolean(),
      isGameOver: z.boolean(),
      result: z.union([z.enum(["white", "black", "draw"]), z.null()]),
      moveHistory: z.array(z.string()),
      sanPlayed: z.string()
    }),
    annotations: { readOnlyHint: false }
  },
  async ({ san, from, to, promotion }) => {
    if (game.isGameOver()) {
      return {
        content: [{ type: "text", text: "move failed: game is over" }],
        isError: true
      };
    }
    let played: { san: string } | null = null;
    try {
      if (san) {
        const m = game.move(san);
        played = m ? { san: m.san } : null;
      } else if (from && to) {
        const m = game.move({ from, to, promotion: promotion ?? "q" });
        played = m ? { san: m.san } : null;
      }
    } catch {
      played = null;
    }
    if (!played) {
      return {
        content: [
          {
            type: "text",
            text: `move failed: not a legal move (${san ?? `${from}->${to}`})`
          }
        ],
        isError: true
      };
    }
    publishState(`app tool make_move ${played.san}`);
    const state = getSemanticState();
    const toMove = state.turn === MODEL_COLOR ? "you" : "the user";
    return {
      content: [
        {
          type: "text",
          text:
            `${IDENTITY_LINE}\n` +
            (state.isGameOver
              ? `Played ${played.san}. ${state.result === "draw" ? "Draw." : `${state.result} wins!`}`
              : `Played ${played.san}. Turn: ${state.turn === "w" ? "White" : "Black"} (${toMove} to move)${state.inCheck ? " (check)" : ""}.`) +
            `\nBoard (uppercase=${USER_COLOR_NAME}/user, lowercase=${MODEL_COLOR_NAME}/you):\n${asciiBoard(state.fen)}`
        }
      ],
      structuredContent: {
        ...state,
        sanPlayed: played.san,
        youArePlaying: MODEL_COLOR,
        userIsPlaying: USER_COLOR
      }
    };
  }
);

app.registerTool(
  "reset_game",
  {
    description: "Reset the chess board to the standard starting position with White to move.",
    outputSchema: z.object({
      fen: z.string(),
      turn: z.enum(["w", "b"]),
      inCheck: z.boolean(),
      isGameOver: z.boolean(),
      result: z.union([z.enum(["white", "black", "draw"]), z.null()]),
      moveHistory: z.array(z.string())
    }),
    annotations: { readOnlyHint: false }
  },
  async () => {
    game.reset();
    publishState("app tool reset_game");
    return {
      content: [{ type: "text", text: "Game reset. White moves first." }],
      structuredContent: getSemanticState()
    };
  }
);

app.addEventListener("toolresult", (params) => {
  // If a server tool produced a fresh state (e.g. start_game), align local state.
  const sc = params.structuredContent as Partial<BoardState> | undefined;
  if (!sc || typeof sc.fen !== "string") return;
  try {
    game.load(sc.fen);
    publishState("server tool result");
  } catch {
    // ignore bad FEN from server tool
  }
});

app.addEventListener("hostcontextchanged", () => {
  applyHostContext();
});

app.onteardown = async () => ({});

const rootEl = document.querySelector<HTMLDivElement>("#root")!;
createRoot(rootEl).render(<ChessApp />);
renderStatus(getSemanticState());

// Reset to a clean starting position when the app loads.
game.load(INITIAL_FEN);

try {
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  bridgeConnected = true;
  applyHostContext();
  void pushModelContext("initial app state");
} catch {
  statusEl.textContent = "Could not connect to an MCP Apps host.";
}
