/**
 * Single-file visualizer UI (spec sections 54-74).
 * It renders the XState graph, current state, JEV decisions, evidence,
 * timeline, budget and session controls from the versioned event protocol.
 */
export function renderVisualizerHtml(token: string): string {
  return HTML.replace("__TOKEN__", token)
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Controlled Mode - Decision Visualizer</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --panel:#161b22; --border:#2a313c; --text:#e6edf3; --muted:#8b949e; --accent:#4f9cf9; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --purple:#bc8cff; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--bg); color:var(--text); }
  header { display:flex; align-items:center; gap:16px; padding:10px 16px; border-bottom:1px solid var(--border); background:var(--panel); position:sticky; top:0; z-index:5; flex-wrap:wrap; }
  header h1 { font-size:14px; margin:0; letter-spacing:.4px; }
  .badge { padding:2px 8px; border:1px solid var(--border); border-radius:10px; color:var(--muted); }
  .badge.state { color:var(--accent); border-color:var(--accent); }
  .badge.ok { color:var(--ok); border-color:var(--ok); }
  .badge.bad { color:var(--bad); border-color:var(--bad); }
  main { display:grid; grid-template-columns: 1.2fr 1fr; gap:12px; padding:12px; align-items:start; }
  @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:12px; }
  .panel h2 { font-size:12px; margin:0 0 8px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px 16px; }
  .kv { display:flex; justify-content:space-between; gap:8px; border-bottom:1px dotted var(--border); padding:2px 0; }
  .kv span:first-child { color:var(--muted); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  button, select, input { font:inherit; background:#21262d; color:var(--text); border:1px solid var(--border); border-radius:6px; padding:4px 8px; }
  button { cursor:pointer; }
  button:hover { border-color:var(--accent); }
  button.active { border-color:var(--accent); color:var(--accent); }
  button:disabled { opacity:.4; cursor:not-allowed; }
  .states { display:flex; flex-wrap:wrap; gap:6px; }
  .state { padding:3px 8px; border:1px solid var(--border); border-radius:6px; color:var(--muted); font-size:12px; }
  .state.current { border-color:var(--accent); color:var(--accent); background:#10233d; }
  .state.terminal { border-style:dashed; }
  .state.disabled { opacity:.35; text-decoration:line-through; }
  .timeline { max-height:280px; overflow:auto; }
  .event { display:flex; gap:8px; padding:3px 4px; border-bottom:1px solid #1c222b; cursor:pointer; }
  .event:hover { background:#1c222b; }
  .event .type { color:var(--purple); min-width:170px; }
  .event .seq { color:var(--muted); min-width:44px; }
  .evidence { max-height:260px; overflow:auto; }
  .evidence .item { padding:4px; border-bottom:1px solid #1c222b; }
  .evidence .loc { color:var(--muted); }
  .bar { height:6px; background:#21262d; border-radius:3px; overflow:hidden; }
  .bar > div { height:100%; background:var(--accent); }
  pre { white-space:pre-wrap; word-break:break-word; margin:0; }
  .muted { color:var(--muted); }
  .err { color:var(--bad); }
  .ok { color:var(--ok); }
  .warn { color:var(--warn); }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width: 700px) { .split { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <h1>CONTROLLED MODE</h1>
  <span class="badge state" id="state">-</span>
  <span class="badge" id="status">-</span>
  <span class="badge" id="speed">1x</span>
  <span class="badge" id="budget">-</span>
  <span class="badge" id="mode">OBSERVE</span>
  <span class="badge" id="jevModel">JEV: -</span>
  <span class="row" style="margin-left:auto">
    <select id="sessionSelect" title="Session"></select>
    <button id="modeObserve">OBSERVE</button>
    <button id="modeControl">CONTROL</button>
    <button id="modeModify">MODIFY</button>
  </span>
</header>
<main>
  <section>
    <div class="panel">
      <h2>XState graph</h2>
      <div class="states" id="states"></div>
      <div class="muted" style="margin-top:8px" id="transitions"></div>
    </div>
    <div class="panel">
      <h2>Current state</h2>
      <div class="grid" id="current"></div>
    </div>
    <div class="panel">
      <h2>Execution timeline</h2>
      <div class="timeline" id="timeline"></div>
    </div>
  </section>
  <section>
    <div class="panel">
      <h2>Session controls</h2>
      <div class="row">
        <button id="pause">PAUSE</button>
        <button id="resume">RESUME</button>
        <button id="step">STEP</button>
        <button id="stop">STOP</button>
        <select id="execSpeed">
          <option>0.25</option><option>0.5</option><option selected>1</option><option>2</option><option>5</option><option>10</option>
        </select>
        <span class="muted">execution speed</span>
      </div>
      <div class="row" style="margin-top:8px">
        <span class="muted">replay</span>
        <input type="range" id="replay" min="0" max="0" value="0" style="flex:1" />
        <button id="replayGo">REPLAY</button>
      </div>
    </div>
    <div class="panel">
      <h2>Decision inspector (JEV)</h2>
      <div id="decision" class="muted">No decision yet.</div>
    </div>
    <div class="panel">
      <h2>Evidence inspector</h2>
      <div class="evidence" id="evidence"></div>
    </div>
    <div class="panel">
      <h2>Capability registry</h2>
      <div id="registry" class="muted"></div>
    </div>
    <div class="panel">
      <h2>Live XState modification (MODIFY)</h2>
      <div class="row">
        <input id="newState" placeholder="STATE_ID" />
        <button id="addState">ADD_STATE</button>
        <button id="removeState">REMOVE_STATE</button>
        <button id="disableState">DISABLE_STATE</button>
        <button id="enableState">ENABLE_STATE</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="jevModelInput" placeholder="JEV MODEL (provider/model)" />
        <button id="setJevModel">SET_JEV_MODEL</button>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="fromState" placeholder="FROM" />
        <input id="eventName" placeholder="EVENT" />
        <input id="toState" placeholder="TO" />
        <button id="addTransition">ADD_TRANSITION</button>
      </div>
      <div class="muted" id="changeResult" style="margin-top:8px"></div>
    </div>
  </section>
</main>
<script>
(function () {
  var TOKEN = "__TOKEN__";
  var params = new URLSearchParams(location.search);
  var mode = "OBSERVE";
  var sessionId = params.get("session") || null;
  var snapshot = null;
  var events = [];
  var ws = null;

  function q(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }

  function api(path) { return fetch(path + (path.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(TOKEN)).then(function (r) { return r.json(); }); }

  function command(name, payload) {
    if (!sessionId) return Promise.resolve();
    return fetch("/api/sessions/" + sessionId + "/command?token=" + encodeURIComponent(TOKEN), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: name, payload: payload || {}, mode: mode }),
    }).then(function (r) { return r.json(); }).then(function (result) {
      q("changeResult").textContent = result.message || "";
      q("changeResult").className = result.ok ? "ok" : "err";
      return result;
    });
  }

  function loadSessions() {
    return api("/api/sessions").then(function (data) {
      var select = q("sessionSelect");
      select.innerHTML = "";
      (data.sessions || []).forEach(function (s) {
        var option = document.createElement("option");
        option.value = s.id;
        option.textContent = s.state + " - " + s.question.slice(0, 48);
        if (s.id === sessionId) option.selected = true;
        select.appendChild(option);
      });
      if (!sessionId && data.sessions && data.sessions.length) sessionId = data.sessions[0].id;
    });
  }

  function loadSnapshot() {
    if (!sessionId) return Promise.resolve();
    return api("/api/sessions/" + sessionId).then(function (data) {
      snapshot = data;
      render();
    });
  }

  function connect() {
    if (ws) { ws.close(); ws = null; }
    if (!sessionId) return;
    var proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(proto + "://" + location.host + "/ws?session=" + encodeURIComponent(sessionId) + "&token=" + encodeURIComponent(TOKEN));
    ws.onmessage = function (message) {
      var event = JSON.parse(message.data);
      if (event.type === "CONTROL_RESULT") { q("changeResult").textContent = event.payload.message; return; }
      events.push(event);
      q("timeline").insertAdjacentHTML("afterbegin", eventRow(event));
      loadSnapshot();
    };
  }

  function eventRow(event) {
    return '<div class="event"><span class="seq">#' + event.seq + '</span><span class="type">' + esc(event.type) + '</span><span class="muted">' + esc(JSON.stringify(event.payload).slice(0, 160)) + '</span></div>';
  }

  function render() {
    if (!snapshot) return;
    var machine = snapshot.machine;
    var session = snapshot.session;
    q("state").textContent = machine.state;
    q("status").textContent = session.status;
    q("budget").textContent = session.budget.actions + "/" + session.budget.maxActions + " actions";
    q("mode").textContent = mode;
    q("speed").textContent = snapshot.speed.execution + "x";
    q("jevModel").textContent = "JEV: " + (snapshot.jevModel || "heuristic");

    var states = q("states");
    states.innerHTML = "";
    machine.states.forEach(function (state) {
      var el = document.createElement("span");
      el.className = "state" + (state.id === machine.state ? " current" : "") + (state.category === "TERMINAL" ? " terminal" : "") + (state.disabled ? " disabled" : "");
      el.textContent = state.id;
      el.title = state.description;
      states.appendChild(el);
    });
    var transitions = machine.transitions.filter(function (t) { return t.from === machine.state || t.from === "*"; });
    q("transitions").textContent = "available: " + machine.available.join(", ") + "  |  version " + machine.version;

    q("current").innerHTML =
      kv("State", machine.state) +
      kv("Previous", machine.previous) +
      kv("Question", session.question) +
      kv("Intent", session.intent.join(", ")) +
      kv("Entities", session.entities.join(", ")) +
      kv("Depth", session.depth + " / " + session.budget.maxGraphDepth) +
      kv("Evidence", session.evidence.length) +
      kv("Graph", session.graph.nodes.length + " nodes / " + session.graph.edges.length + " edges") +
      kv("Budget", session.budget.actions + " / " + session.budget.maxActions + " actions, " + session.budget.llmIterations + " / " + session.budget.maxLLMIterations + " LLM iterations") +
      kv("Termination", session.termination || "-");

    var lastDecision = session.decisions[session.decisions.length - 1];
    q("decision").innerHTML = lastDecision
      ? kv("Decision", lastDecision.decision + " (" + lastDecision.verdict + ")") +
        kv("Capability", lastDecision.capability || "-") +
        kv("Score", lastDecision.score == null ? "-" : lastDecision.score) +
        kv("Expected gain", lastDecision.expectedInformationGain == null ? "-" : lastDecision.expectedInformationGain) +
        kv("Cost", lastDecision.cost == null ? "-" : lastDecision.cost) +
        kv("Reason", esc(lastDecision.reason))
      : "No decision yet.";

    var evidence = q("evidence");
    evidence.innerHTML = session.evidence.slice(-80).reverse().map(function (item) {
      return '<div class="item"><span class="loc">' + esc(item.type) + " " + esc(item.file) + (item.lineStart ? ":" + item.lineStart : "") + '</span> <span class="muted">conf ' + item.confidence + "</span><br/>" + esc(item.symbol || "") + (item.snippet ? " <span class=\\"muted\\">" + esc(item.snippet) + "</span>" : "") + "</div>";
    }).join("") || '<span class="muted">No evidence yet.</span>';

    q("registry").innerHTML = (snapshot.registry || []).map(function (cap) {
      return '<div class="kv"><span>' + esc(cap.id) + '</span><span class="muted">cost ' + cap.cost + " - gain " + cap.expectedInformationGain + "</span></div>";
    }).join("");

    var maxSeq = snapshot.events;
    var replay = q("replay");
    replay.max = String(Math.max(0, maxSeq));
    if (Number(replay.value) > maxSeq) replay.value = String(maxSeq);
  }

  function kv(key, value) {
    return '<div class="kv"><span>' + esc(key) + "</span><span>" + esc(value) + "</span></div>";
  }

  function loadTimeline() {
    if (!sessionId) return Promise.resolve();
    return api("/api/sessions/" + sessionId + "/events").then(function (data) {
      events = data.events || [];
      q("timeline").innerHTML = events.slice().reverse().map(eventRow).join("");
    });
  }

  function setMode(next) {
    mode = next;
    q("modeObserve").className = next === "OBSERVE" ? "active" : "";
    q("modeControl").className = next === "CONTROL" ? "active" : "";
    q("modeModify").className = next === "MODIFY" ? "active" : "";
    render();
  }

  q("modeObserve").onclick = function () { setMode("OBSERVE"); };
  q("modeControl").onclick = function () { setMode("CONTROL"); };
  q("modeModify").onclick = function () { setMode("MODIFY"); };
  q("pause").onclick = function () { command("PAUSE"); };
  q("resume").onclick = function () { command("RESUME"); };
  q("step").onclick = function () { command("STEP"); };
  q("stop").onclick = function () { command("STOP"); };
  q("execSpeed").onchange = function (e) { command("SET_SPEED", { value: Number(e.target.value), target: "execution" }); };
  q("replayGo").onclick = function () {
    var at = Number(q("replay").value);
    api("/api/sessions/" + sessionId + "/state?at=" + at).then(function (state) {
      q("changeResult").textContent = "state at #" + at + ": " + JSON.stringify(state);
    });
  };
  q("addState").onclick = function () { command("ADD_STATE", { id: q("newState").value.trim().toUpperCase(), category: "LIFECYCLE", description: "User-defined state" }); };
  q("removeState").onclick = function () { command("REMOVE_STATE", { id: q("newState").value.trim().toUpperCase() }); };
  q("disableState").onclick = function () { command("DISABLE_STATE", { id: q("newState").value.trim().toUpperCase() }); };
  q("enableState").onclick = function () { command("ENABLE_STATE", { id: q("newState").value.trim().toUpperCase() }); };
  q("addTransition").onclick = function () { command("ADD_TRANSITION", { from: q("fromState").value.trim().toUpperCase(), event: q("eventName").value.trim().toUpperCase(), to: q("toState").value.trim().toUpperCase() }); };
  q("setJevModel").onclick = function () { command("SET_JEV_MODEL", { model: q("jevModelInput").value.trim() }); };
  q("sessionSelect").onchange = function (e) { sessionId = e.target.value; loadSnapshot().then(loadTimeline).then(connect); };

  setMode("OBSERVE");
  loadSessions().then(loadSnapshot).then(loadTimeline).then(connect);
  setInterval(loadSnapshot, 3000);
})();
</script>
</body>
</html>`
