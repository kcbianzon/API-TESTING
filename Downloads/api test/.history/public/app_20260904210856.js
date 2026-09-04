const $ = (id) => document.getElementById(id);
const state = { history: [], runs: 0 };

function prettyJson(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value || "(empty response)";
  }
}

function diagnose(result, request) {
  if (result.error)
    return [
      {
        type: "critical",
        title: result.error,
        detail:
          "Check the URL, network access, DNS, TLS certificate, and whether the API is accepting connections.",
      },
    ];
  const status = result.status;
  const items = [];
  if (status === 401)
    items.push({
      type: "warning",
      title: "Authentication is missing or invalid.",
      detail:
        "Add a valid Bearer token, API key, or session credential in Headers.",
    });
  else if (status === 403)
    items.push({
      type: "warning",
      title: "The server understood you, but denied access.",
      detail:
        "Check permissions, scopes, IP allowlists, origin rules, and required roles.",
    });
  else if (status === 404)
    items.push({
      type: "warning",
      title: "That route was not found.",
      detail: "Verify the base URL, path, API version, and trailing slash.",
    });
  else if (status === 405)
    items.push({
      type: "warning",
      title: "This method is not allowed here.",
      detail: `The endpoint rejected ${request.method}. Try the method documented by the API.`,
    });
  else if (status === 408 || status === 504)
    items.push({
      type: "critical",
      title: "The server took too long to respond.",
      detail:
        "Check service health, upstream dependencies, timeout settings, and request complexity.",
    });
  else if (status >= 500)
    items.push({
      type: "critical",
      title: "The failure is on the server side.",
      detail:
        "Inspect server logs, deployment health, database connectivity, and upstream services.",
    });
  else if (status >= 400)
    items.push({
      type: "warning",
      title: "The request was rejected.",
      detail:
        "Read the response body for validation details and compare the payload with the API contract.",
    });
  else
    items.push({
      type: "good",
      title: "The endpoint is reachable and accepted the request.",
      detail:
        result.status === 204
          ? "No content was returned, which is expected for this response."
          : "Review the response body and headers below for contract details.",
    });
  const contentType = result.headers?.["content-type"] || "";
  if (
    result.body &&
    !contentType.includes("json") &&
    result.status >= 200 &&
    result.status < 300
  )
    items.push({
      type: "note",
      title: "Response is not labeled as JSON.",
      detail: `Received ${contentType || "an unspecified content type"}. Confirm that matches your client expectations.`,
    });
  return items;
}

function renderDiagnostics(items) {
  $("diagnostics").innerHTML = items
    .map(
      (item) =>
        `<article class="diagnostic ${item.type}"><span class="diagnostic-icon">${item.type === "good" ? "&#10003;" : item.type === "critical" ? "!" : "?"}</span><div><strong>${item.title}</strong><p>${item.detail}</p></div></article>`,
    )
    .join("");
}

function renderHistory() {
  if (!state.history.length) return;
  $("history").innerHTML = state.history
    .map(
      (item) =>
        `<button class="history-item" data-url="${item.url}"><span class="history-status ${item.ok ? "ok" : "bad"}"></span><span class="history-method">${item.method}</span><span class="history-url">${item.url}</span><span class="history-code">${item.status || "ERR"}</span><span class="history-time">${item.duration ? `${item.duration} ms` : "-"}</span></button>`,
    )
    .join("");
  document.querySelectorAll(".history-item").forEach((button) =>
    button.addEventListener("click", () => {
      $("url").value = button.dataset.url;
      runCheck();
    }),
  );
}

async function runCheck() {
  const request = {
    method: $("method").value,
    url: $("url").value.trim(),
    params: $("params").value,
    headers: $("headers").value,
    body: $("body").value,
    timeout: $("timeout").value,
  };
  if (!request.url)
    return showLocalError("Enter a URL before running a check.");
  $("sendButton").disabled = true;
  $("sendButton").querySelector("span").textContent = "Checking...";
  $("emptyState").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("statusBadge").textContent = "RUNNING";
  $("statusSummary").textContent = "Contacting endpoint...";
  $("statusDot").className = "status-dot loading";
  $("diagnostics").innerHTML = "";
  const started = Date.now();
  try {
    const response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json();
    const duration = result.duration || Date.now() - started;
    $("duration").textContent = `${duration} ms`;
    $("statusDot").className =
      `status-dot ${result.ok ? "success" : "failure"}`;
    $("statusBadge").textContent = result.error
      ? "NETWORK ERROR"
      : `${result.status} ${result.statusText || ""}`;
    $("statusSummary").textContent = result.error
      ? "Could not complete request"
      : result.ok
        ? "Request completed successfully"
        : "Request completed with an error";
    $("responseHeaders").textContent = result.headers
      ? prettyJson(JSON.stringify(result.headers))
      : "(none)";
    $("responseBody").textContent = result.body
      ? prettyJson(result.body)
      : result.error || "(empty response)";
    renderDiagnostics(diagnose(result, request));
    state.history.unshift({
      url: request.url,
      method: request.method,
      status: result.status,
      ok: result.ok,
      duration,
    });
    state.history = state.history.slice(0, 6);
    state.runs++;
    $("runCount").textContent = state.runs;
    renderHistory();
  } catch (error) {
    showLocalError(error.message);
  } finally {
    $("sendButton").disabled = false;
    $("sendButton").querySelector("span").textContent = "Run check";
  }
}

function showLocalError(message) {
  $("emptyState").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("duration").textContent = "Local validation";
  $("statusBadge").textContent = "CHECK INPUT";
  $("statusSummary").textContent = message;
  $("statusDot").className = "status-dot failure";
  $("responseHeaders").textContent = "(none)";
  $("responseBody").textContent = "";
  renderDiagnostics([
    {
      type: "warning",
      title: message,
      detail: "Fix the input and run the check again.",
    },
  ]);
}
$("sendButton").addEventListener("click", runCheck);
$("clearButton").addEventListener("click", () => {
  $("result").classList.add("hidden");
  $("emptyState").classList.remove("hidden");
  $("duration").textContent = "Waiting for a check";
});
$("url").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runCheck();
});
