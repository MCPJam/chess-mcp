import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { createChessViewTools } from "../chess-view-tools.js";

function fixture() {
  const game = new Chess();
  const changes: string[] = [];
  const tools = createChessViewTools({
    game,
    getState: () => ({
      fen: game.fen(), turn: game.turn(), inCheck: game.inCheck(),
      isGameOver: game.isGameOver(), result: null, moveHistory: game.history()
    }),
    publishState: reason => changes.push(reason),
    identity: "You are playing Black.",
    asciiBoard: () => game.ascii()
  });
  const run = (name: string, input: Record<string, unknown> = {}, signal = new AbortController().signal) => {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool);
    return tool.execute(input, { signal });
  };
  return { game, changes, tools, run };
}

test("all four WebMCP tools carry object schemas and return plain board data", async () => {
  const { tools, run } = fixture();
  assert.equal(tools.length, 4);
  for (const tool of tools) {
    assert.ok(tool.inputSchema);
    assert.equal(Reflect.get(tool.inputSchema, "type"), "object");
  }
  const result = await run("get_board_state");
  assert.ok(result && typeof result === "object");
  assert.equal(Reflect.get(result, "identity"), "You are playing Black.");
  assert.equal(typeof Reflect.get(result, "board"), "string");
  assert.equal(Reflect.has(result, "content"), false);
});

test("move, legal moves and reset share the live game state", async () => {
  const { game, changes, run } = fixture();
  await run("make_move", { san: "e4" });
  assert.deepEqual(game.history(), ["e4"]);
  const legal = await run("get_legal_moves", { from: "e7" });
  assert.ok(legal && typeof legal === "object");
  assert.equal(Reflect.get(legal, "turn"), "b");
  await run("make_move", { from: "e7", to: "e5" });
  await run("reset_game");
  assert.deepEqual(game.history(), []);
  assert.equal(changes.length, 3);
});

test("invalid inputs, illegal moves and cancellation never mutate the board", async () => {
  const { game, changes, run } = fixture();
  for (const input of [{}, { from: "bad", to: "e4" }, { san: "e5" }]) {
    await assert.rejects(async () => run("make_move", input));
  }
  await assert.rejects(async () => run("make_move", { san: "e4" }, AbortSignal.abort()));
  assert.deepEqual(game.history(), []);
  assert.deepEqual(changes, []);
});
