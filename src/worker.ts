// Cloudflare Workers entry for the chess MCP App.
//
// Stateless: a fresh McpServer is constructed per request and the
// WebStandardStreamableHTTPServerTransport (Web Standard Request/Response,
// JSON-response mode) handles the JSON-RPC plumbing. No sessions, no DO.
//
// The app HTML is bundled via Wrangler's Text loader (see wrangler.jsonc
// `rules`), so we always ship whatever vite emitted into dist/.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "../server.js";
import APP_HTML from "../dist/mcp-app.html";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers":
    "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id"
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

async function handleMcp(request: Request): Promise<Response> {
  const server = createServer(APP_HTML);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
    <main style="text-align:center;max-width:560px">
      <h1>chess-mcp-app</h1>
      <p>MCP App server. POST JSON-RPC to <code>/mcp</code>.</p>
      <p>Try <code>tools/list</code> or <code>resources/list</code>.</p>
    </main>
  </body>
</html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withCors(Response.json({ status: "ok" }));
    }

    if (url.pathname === "/mcp") {
      try {
        const response = await handleMcp(request);
        return withCors(response);
      } catch (err) {
        console.error("Worker MCP error", err);
        return withCors(
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      }
    }

    return withCors(
      new Response(landingHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    );
  }
};
