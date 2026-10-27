import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { createChessViewTools } from "./chess-view-tools.js";
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables
} from "@modelcontextprotocol/ext-apps";
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

// Registration lifetime follows the app's teardown.
const toolLifetime = new AbortController();

app.addEventListener("toolresult", (params) => {
  // The host is the source of truth for game state across tool calls; trust it.
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

app.onteardown = async () => {
  toolLifetime.abort();
  return {};
};

const rootEl = document.querySelector<HTMLDivElement>("#root")!;
createRoot(rootEl).render(<ChessApp />);
renderStatus(getSemanticState());

// Reset to a clean starting position when the app loads.
game.load(INITIAL_FEN);

try {
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  if (document.modelContext) {
    for (const tool of createChessViewTools({
      game, getState: getSemanticState, publishState, identity: IDENTITY_LINE,
      asciiBoard
    })) {
      await document.modelContext.registerTool(tool, { signal: toolLifetime.signal });
    }
  }
  bridgeConnected = true;
  applyHostContext();
  publishState("initial app state");
} catch {
  statusEl.textContent = "Could not connect to an MCP Apps host.";
}
