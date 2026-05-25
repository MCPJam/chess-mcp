import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3001);
const transportMode = process.env.MCP_TRANSPORT ?? "http";

async function loadAppHtml(): Promise<string | undefined> {
  try {
    return await readFile(path.join(__dirname, "dist", "mcp-app.html"), "utf8");
  } catch {
    return undefined;
  }
}

async function runStdio(): Promise<void> {
  const appHtml = await loadAppHtml();
  const server = createServer(appHtml);
  await server.connect(new StdioServerTransport());
}

async function runHttp(): Promise<void> {
  const appHtml = await loadAppHtml();
  const app = createMcpExpressApp();

  app.use(
    cors({
      origin: "*",
      exposedHeaders: ["Mcp-Session-Id"]
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/mcp", async (req, res) => {
    const server = createServer(appHtml);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.all("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed"
      },
      id: null
    });
  });

  app.listen(port, (error?: Error) => {
    if (error) {
      console.error("Failed to start MCP server:", error);
      process.exit(1);
    }

    console.log(`Chess MCP App listening on http://localhost:${port}/mcp`);
  });
}

if (transportMode === "stdio") {
  await runStdio();
} else {
  await runHttp();
}
