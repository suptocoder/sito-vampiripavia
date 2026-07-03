// Legacy room page logic. Engine = Matrix (browser talks to Synapse directly for
// messages); RPG roster / Obfuscate / Auspex / room graph come from the sidecar.
(function () {
  // Credentials come from sessionStorage (standalone /chat.html) OR from URL params
  // (?token=&user=&hs=) when embedded inside Element Web's overlay.
  var _p = new URLSearchParams(location.search);
  var SYNAPSE = _p.get("hs") || window.VP_SYNAPSE_URL || "http://localhost:8008";
  if (_p.get("token")) sessionStorage.setItem("vp_token", _p.get("token"));
  if (_p.get("user")) sessionStorage.setItem("vp_user", _p.get("user"));
  var session = {
    token: _p.get("token") || sessionStorage.getItem("vp_token"),
    userId: _p.get("user") || sessionStorage.getItem("vp_user"),
    obf: sessionStorage.getItem("vp_obf") === "1",
  };
  if (!session.token || !session.userId) {
    location.href = "/";
    return;
  }

  var STAFF_MXID = "@staff:local";
  var room = null;             // current game room id (string)
  var roomName = {};           // id -> name
  var roomAdjacent = {};       // id -> [adjacent ids]
  var matrixRoomById = {};     // id -> matrix room id
  var seenSelfObfuscate = false;

  var me = null;            // cached /me
  var charsByMxid = {};     // mxid -> roster character (for scheda/whisper)
  var rcptTarget = null;    // null = public; else recipient mxid

  var $ = function (id) { return document.getElementById(id); };
  var ucfirst = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  var nameFromMxid = function (mxid) { return ucfirst(String(mxid).replace(/^@/, "").replace(/:.*/, "")); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var hasAus2 = function () { return !!(me && me.powers && me.powers.indexOf("aus2") !== -1); };

  function setStatus(text) { $("status").textContent = text || ""; }

  // ---- Matrix (direct to Synapse) ----
  function matrix(method, path, body) {
    return fetch(SYNAPSE + "/_matrix/client/v3" + path, {
      method: method,
      headers: Object.assign(
        { authorization: "Bearer " + session.token },
        body ? { "content-type": "application/json" } : {}
      ),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  // Legacy chat_main.php formatting, ported to Matrix events. Whisper recipient is
  // carried in content.vp_rcpt. aus2 reveals whisper content (legacy $_SESSION['auspex']>=2);
  // everyone else sees "X parla con Y".
  function renderMessage(e) {
    var sender = e.sender;
    var rcpt = e.content && e.content.vp_rcpt;
    var bodyText = esc((e.content && e.content.body) || "");
    var sName = esc(nameFromMxid(sender));
    if (e.content && e.content.vp_system) { // combat/system narration (no author)
      var scls = e.content.vp_color === "red" ? "medium_over" : "medium_oro";
      return '<span class="' + scls + '"><i>' + bodyText + "</i></span><br>";
    }
    if (!rcpt) {
      return '<span class="medium_oro"><i>' + sName + '</i>&nbsp;-</span>&nbsp;<span class="medium">' + bodyText + "</span><br>";
    }
    var rName = esc(nameFromMxid(rcpt));
    if (sender === session.userId) {
      return '<span class="wisperto"><i>Sussurri a&nbsp;' + rName + "</i>&nbsp;-&nbsp;" + bodyText + "</span><br>";
    }
    if (rcpt === session.userId) {
      return '<span class="medium_over"><i>' + sName + '&nbsp;ti sussurra</i></span>&nbsp;<span class="medium">-&nbsp;' + bodyText + "</span><br>";
    }
    if (hasAus2()) {
      return '<span class="wisper_auspex"><i>' + sName + "&nbsp;sussurra a&nbsp;" + rName + "&nbsp;-&nbsp;" + bodyText + "</i></span><br>";
    }
    return '<span class="wisper_auspex"><i>' + sName + "&nbsp;parla con&nbsp;" + rName + "</i></span><br>";
  }

  function pollMessages() {
    var mxRoom = matrixRoomById[room];
    if (!mxRoom) { $("messages").innerHTML = ""; return; } // unprovisioned room: navigable, no chat
    matrix("GET", "/rooms/" + encodeURIComponent(mxRoom) + "/messages?dir=b&limit=20")
      .then(function (res) {
        if (!res.ok) return;
        var chunk = (res.body.chunk || []).filter(function (e) { return e.type === "m.room.message"; });
        chunk.reverse(); // dir=b is newest-first; show chronological
        $("messages").innerHTML = chunk.map(renderMessage).join("");
        var main = $("vp-main") || document.body;
        main.scrollTop = main.scrollHeight;
      })
      .catch(function () {});
  }

  function sendMessage(text) {
    var mxRoom = matrixRoomById[room];
    if (!mxRoom || !text) return Promise.resolve();
    var content = { msgtype: "m.text", body: text };
    if (rcptTarget) content.vp_rcpt = rcptTarget;
    var txn = "vp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return matrix("PUT", "/rooms/" + encodeURIComponent(mxRoom) + "/send/m.room.message/" + txn, content)
      .then(function () { setTimeout(pollMessages, 250); });
  }

  // ---- Sidecar (RPG roster / powers / rooms) ----
  // Authed by the real Matrix access token (verified server-side via whoami); the
  // matrix_user_id param remains only as the dev-mode fallback.
  function sidecar(method, path) {
    var sep = path.indexOf("?") === -1 ? "?" : "&";
    return fetch(path + sep + "matrix_user_id=" + encodeURIComponent(session.userId), {
      method: method,
      headers: { "x-vp-token": session.token || "" },
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function renderRoster(characters) {
    charsByMxid = {};
    characters.forEach(function (c) { if (c.matrix_user_id) charsByMxid[c.matrix_user_id] = c; });
    // legacy lista_utenti: "N UTENTI IN ELYSIUM" (ELYSIUM = realm name, not the room)
    $("rosterTitle").textContent = characters.length + " UTENTI IN ELYSIUM";
    $("roster").innerHTML = characters.map(function (c) {
      var hidden = c.visible === false || c.revealed_by_auspex;
      var cls = hidden ? "utente_oscurato" : "utente";
      var name = esc(ucfirst(c.display_name || ""));
      var mx = esc(c.matrix_user_id || "");
      var tasti = '<a class="utente_tasto" title="Identita" data-sch="' + mx + '">I</a>' +
        (c.self ? "" : ' <a class="utente_tasto" title="Sfida" data-sfida="' + mx + '">S</a>');
      var nameEl = c.self
        ? '<span class="' + cls + '">' + name + "</span>"
        : '<a class="' + cls + '" data-wisper="' + mx + '" data-name="' + name + '">' + name + "</a>";
      return "<li>" + tasti + " " + nameEl + "</li>";
    }).join("");
  }

  function renderAdjacency() {
    $("roomName").textContent = (roomName[room] || room || "").toUpperCase();
    $("luoghi").innerHTML = (roomAdjacent[room] || []).map(function (id) {
      return '<li><a class="luogo" data-room="' + esc(id) + '">' + esc(roomName[id] || id) + "</a></li>";
    }).join("");
    Array.prototype.forEach.call($("luoghi").querySelectorAll(".luogo"), function (a) {
      a.addEventListener("click", function () { setRoom(a.getAttribute("data-room")); });
    });
  }

  // Scheda opens as a separate popup window (legacy window.open -> scheda.php).
  function openSchedaPopup(charId) {
    var url = "/scheda.html?me=" + encodeURIComponent(session.userId) + (charId ? "&id=" + encodeURIComponent(charId) : "");
    window.open(url, "SchedaVP", "width=580,height=680,scrollbars=yes,resizable=yes");
  }

  // Challenge popup (legacy challenge.php, "S" button), 460x560.
  function openChallengePopup(charId, name) {
    var url = "/challenge.html?me=" + encodeURIComponent(session.userId) +
      "&target=" + encodeURIComponent(charId) + "&name=" + encodeURIComponent(name || charId);
    window.open(url, "ChallengeVP", "width=460,height=560,scrollbars=yes,resizable=yes");
  }

  // ---- whisper target ----
  function setWhisper(mxid, name) {
    rcptTarget = mxid;
    $("rcpt").value = "Messaggio privato per " + name;
    $("msg").focus();
  }
  function clearWhisper() { rcptTarget = null; $("rcpt").value = ""; }

  function refresh() {
    sidecar("GET", "/me").then(function (res) { if (res.ok) me = res.body; });
    sidecar("GET", "/rooms/" + room + "/visible-characters").then(function (res) {
      if (res.ok) renderRoster(res.body.characters || []);
    });
    pollMessages();
  }

  function enterRoom() {
    return sidecar("POST", "/rooms/" + room + "/presence").then(function () {
      if (session.obf && !seenSelfObfuscate) {
        seenSelfObfuscate = true;
        return sidecar("POST", "/obfuscate").then(function (res) { setStatus(res.body.message || res.body.error || ""); });
      }
    }).then(refresh);
  }

  function setRoom(id) {
    if (!roomName[id] || id === room) return;
    room = id;
    clearWhisper();
    var url = new URL(location.href);
    url.searchParams.set("room", id);
    history.replaceState(null, "", url);
    renderAdjacency();
    enterRoom();
  }

  // ---- XP ankh (legacy gainXP) ----
  var ankhTimer = null;
  function ankhImg() { var a = $("vp-ankh"); return a ? a.querySelector("img") : null; }
  function effectiveDelaySec() {
    var base = (me && me.tempo_px) || 60;
    var hidden = me && me.presence && me.presence.obfuscate_level > 0;
    return hidden ? base * 2 : base;
  }
  function hideAnkh() { var a = ankhImg(); if (a) a.style.display = "none"; }
  function showAnkh() { var a = ankhImg(); if (a) { a.style.display = ""; a.style.cursor = "pointer"; } }
  function scheduleAnkh(sec) {
    if (ankhTimer) clearTimeout(ankhTimer);
    hideAnkh();
    ankhTimer = setTimeout(showAnkh, (sec || effectiveDelaySec()) * 1000);
  }
  function clickAnkh() {
    hideAnkh();
    sidecar("POST", "/gainxp").then(function (res) {
      if (res.ok && res.body.ok) {
        setStatus("Hai guadagnato 1 PX (totale " + res.body.px_banca + ")");
        scheduleAnkh();
      } else if (res.body && res.body.next_in) {
        scheduleAnkh(res.body.next_in);
      } else {
        setStatus((res.body && res.body.error) || "");
        scheduleAnkh();
      }
    }).catch(function () { scheduleAnkh(); });
  }

  // ---- wire up ----
  // pannello buttons -> legacy popups (same targets/sizes as lib2.js)
  function popup(p, name, w, h) {
    window.open("/popup.html?p=" + p, name, "width=" + w + ",height=" + h + ",scrollbars=yes,resizable=yes");
  }
  var BTN = {
    scheda: function () { openSchedaPopup(me && me.id); },
    mappa: function () { popup("mappa", "Mappa", 950, 700); },
    stanza: function () { popup("stanza&room=" + room, "Stanze", 470, 390); },
    bacheca: function () { popup("bacheca", "Bacheca", 700, 500); },
    help: function () { popup("help", "Help", 700, 500); },
    giornali: function () { popup("news", "Giornali", 700, 500); },
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-btn]"), function (b) {
    b.addEventListener("click", function () { (BTN[b.getAttribute("data-btn")] || function () {})(); });
  });

  // roster clicks (delegated; innerHTML is replaced each refresh)
  $("roster").addEventListener("click", function (e) {
    var t = e.target;
    if (t.dataset.sch !== undefined) { var ch = charsByMxid[t.dataset.sch]; openSchedaPopup(ch && ch.id); return; }
    if (t.dataset.sfida !== undefined) { var sc = charsByMxid[t.dataset.sfida]; if (sc) openChallengePopup(sc.id, sc.display_name); return; }
    if (t.dataset.wisper !== undefined) { setWhisper(t.dataset.wisper, t.dataset.name); return; }
  });

  $("msgForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("msg");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendMessage(text);
  });

  // legacy "Sussurra ai Master" -> whisper to the staff character
  $("whisper").addEventListener("click", function () { setWhisper(STAFF_MXID, "Master"); });
  $("rcpt").addEventListener("click", clearWhisper); // click recipient field to go public again
  $("logout").addEventListener("click", function () {
    sessionStorage.clear();
    location.href = "/";
  });

  var ankhNode = ankhImg();
  if (ankhNode) ankhNode.addEventListener("click", clickAnkh);
  hideAnkh();

  // load the room graph + the player's current room, then go
  Promise.all([
    fetch("/rooms").then(function (r) { return r.json(); }).catch(function () { return { rooms: [] }; }),
    sidecar("GET", "/me"),
  ]).then(function (results) {
    (results[0].rooms || []).forEach(function (rm) {
      roomName[rm.id] = rm.name;
      roomAdjacent[rm.id] = (rm.adjacent || []).map(String);
      matrixRoomById[rm.id] = rm.matrix_room_id || "";
    });
    if (results[1].ok) me = results[1].body;
    var param = new URLSearchParams(location.search).get("room");
    room = param || (me && me.presence && me.presence.room_id) || "1";
    renderAdjacency();
    enterRoom();
    scheduleAnkh();
    setInterval(refresh, 4000);
  }).catch(function () { setStatus("Sidecar non disponibile"); });
})();
