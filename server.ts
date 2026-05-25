import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const APP_RESOURCE_URI = "ui://chess/board.html";

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
  <body>
    <h1>Chess MCP App</h1>
    <p>Run <code>npm run build</code> or <code>npm run dev</code> so the UI bundle exists.</p>
  </body>
</html>`;

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function freshBoardState() {
  return {
    fen: INITIAL_FEN,
    turn: "w" as "w" | "b",
    inCheck: false,
    isGameOver: false,
    result: null as "white" | "black" | "draw" | null,
    moveHistory: [] as string[]
  };
}

export function createServer(appHtml: string = FALLBACK_HTML): McpServer {
  const server = new McpServer({
    name: "chess-mcp-app",
    version: "0.1.0"
  });

  registerAppResource(
    server,
    "Chess Board",
    APP_RESOURCE_URI,
    {
      description: "Interactive chess board rendered inside an MCP App iframe.",
      _meta: {
        ui: {
          csp: {},
          prefersBorder: false
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: appHtml,
          _meta: {
            ui: {
              csp: {},
              prefersBorder: false
            }
          }
        }
      ]
    })
  );

  registerAppTool(
    server,
    "start_game",
    {
      title: "Start Chess Game",
      description:
        "Open a fresh chess board and start a game where the user plays White and you (the model) play Black. After the user plays a move you will receive a user message describing the move; respond immediately by calling the `make_move` app tool with a strong, legal Black move. Use `get_board_state` to inspect the current FEN and `get_legal_moves` to enumerate options. Do not ask the user where to move — just play.",
      inputSchema: {},
      _meta: {
        ui: {
          resourceUri: APP_RESOURCE_URI,
          visibility: ["model", "app"]
        }
      }
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Chess board opened. The user plays White and moves first; you play Black. After each user move you will be told the move via a user message — respond by immediately calling the `make_move` app tool with a strong, legal Black move (use SAN like 'e5' or 'Nf6', or {from,to,promotion}). Do not narrate or ask for permission; just play."
        }
      ],
      structuredContent: freshBoardState()
    })
  );

  return server;
}
