import "dotenv/config";
import http from "http";
import { InMemorySessionStore } from "./sessionStore.js";
import { serializeWorkingMemory, serializeTranscript } from "./serialize.js";
import { PORT, CORS_ORIGIN } from "../config.js";

const store = new InMemorySessionStore();

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as unknown) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Extract :id from paths like /sessions/abc123 or /sessions/abc123/messages
function parseSessionPath(url: string): { id: string; sub?: "messages" } | null {
  const m = url.match(/^\/sessions\/([^/]+)(\/messages)?$/);
  if (!m) return null;
  return { id: m[1], sub: m[2] ? "messages" : undefined };
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // OPTIONS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // GET /healthz
  if (method === "GET" && url === "/healthz") {
    return json(res, 200, { ok: true });
  }

  // POST /sessions
  if (method === "POST" && url === "/sessions") {
    try {
      const body = (await readBody(req)) as { userId?: string };
      const session = store.create(body.userId);
      return json(res, 201, {
        conversationId: session.id,
        userId: session.userId,
        workingMemory: serializeWorkingMemory(session.wm),
      });
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const parsed = parseSessionPath(url);
  if (!parsed) {
    return json(res, 404, { error: "Not found" });
  }

  const { id, sub } = parsed;

  // GET /sessions/:id
  if (method === "GET" && !sub) {
    const session = store.get(id);
    if (!session) return json(res, 404, { error: "Session not found" });
    return json(res, 200, {
      conversationId: id,
      userId: session.userId,
      workingMemory: serializeWorkingMemory(session.wm),
      transcript: serializeTranscript(session.history),
      spans: session.tracer.getSpans(),
      audit: session.auditLog.getRecords(),
    });
  }

  // DELETE /sessions/:id
  if (method === "DELETE" && !sub) {
    const session = store.get(id);
    if (!session) return json(res, 404, { error: "Session not found" });
    store.delete(id);
    return json(res, 200, { ok: true });
  }

  // POST /sessions/:id/messages
  if (method === "POST" && sub === "messages") {
    const session = store.get(id);
    if (!session) return json(res, 404, { error: "Session not found" });

    let body: { message?: string };
    try {
      body = (await readBody(req)) as { message?: string };
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }

    if (!body.message || typeof body.message !== "string") {
      return json(res, 400, { error: "message is required" });
    }

    const message = body.message;

    try {
      const response = await session.runExclusive(async () => {
        // Snapshot lengths inside the exclusive lock so deltas are always consistent.
        const spansBefore = session.tracer.getSpans().length;
        const auditBefore = session.auditLog.getRecords().length;

        const result = await session.loop.chat(session.history, message);
        const allSpans = session.tracer.getSpans();
        const allAudit = session.auditLog.getRecords();

        return {
          reply: result.reply,
          toolLogs: result.toolLogs,
          spans: allSpans.slice(spansBefore),
          audit: allAudit.slice(auditBefore),
          workingMemory: serializeWorkingMemory(session.wm),
        };
      });
      return json(res, 200, response);
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Agent service listening on http://localhost:${PORT}`);
  console.log(`  POST /sessions          — create session`);
  console.log(`  POST /sessions/:id/messages — chat turn`);
  console.log(`  GET  /sessions/:id      — session snapshot`);
  console.log(`  DELETE /sessions/:id    — end session`);
});
