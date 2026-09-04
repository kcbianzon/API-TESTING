const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT) || 4173;
const publicDir = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000)
        reject(new Error("Request body exceeds 2 MB."));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseHeaders(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  const parsed = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Headers must be a JSON object.");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [key, String(item)]),
  );
}

async function proxyRequest(request, response) {
  let input;
  try {
    input = JSON.parse(await readBody(request));
    if (!input.url || !/^https?:\/\//i.test(input.url)) {
      return sendJson(response, 400, {
        error: "Enter a complete http:// or https:// URL.",
      });
    }
    const target = new URL(input.url);
    const params = typeof input.params === 'string' ? JSON.parse(input.params || '{}') : (input.params || {});
    for (const [key, value] of Object.entries(params)) {
      if (key.trim()) target.searchParams.set(key, String(value));
    }
    const headers = parseHeaders(input.headers);
    delete headers.host;
    delete headers.connection;
    const method = String(input.method || "GET").toUpperCase();
    const body = ["GET", "HEAD"].includes(method)
      ? undefined
      : input.body || undefined;
    const started = Date.now();
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(
        Math.min(Math.max(Number(input.timeout) || 10000, 1000), 30000),
      ),
      redirect: "follow",
    });
    const raw = await upstream.text();
    const responseHeaders = Object.fromEntries(upstream.headers.entries());
    sendJson(response, 200, {
      ok: upstream.ok,
      status: upstream.status,
      statusText: upstream.statusText,
      finalUrl: upstream.url,
      duration: Date.now() - started,
      headers: responseHeaders,
      body: raw.slice(0, 1_000_000),
      truncated: raw.length > 1_000_000,
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error:
        error.name === "TimeoutError"
          ? "Request timed out."
          : error.message || "The request could not be completed.",
    });
  }
}

function serveStatic(request, response) {
  const requestPath = new URL(request.url, `http://${request.headers.host}`)
    .pathname;
  const relative =
    requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(publicDir + path.sep))
    return sendJson(response, 404, { error: "Not found." });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(response, 404, { error: "Not found." });
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/proxy")
    return proxyRequest(request, response);
  if (request.method === "GET" || request.method === "HEAD")
    return serveStatic(request, response);
  sendJson(response, 405, { error: "Method not allowed." });
});

server.listen(PORT, () =>
  console.log(`API Scout running at http://localhost:${PORT}`),
);
