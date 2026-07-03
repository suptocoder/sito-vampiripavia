(function () {
  // Vampiric re-skin of Element Web. Element Web is the host shell; the full legacy
  // "sito Vampiripavia" experience (login -> chat) is rendered by the sidecar pages at
  // :8787 inside a full-screen iframe, running on the Matrix engine (Synapse). This keeps
  // every legacy text/image/asset/design exactly and is immune to Element DOM changes.
  var SIDE = "http://localhost:8787";

  function ensureFrame() {
    if (!document.body) return;
    if (document.getElementById("vp-frame")) return;
    document.body.classList.add("vp-app");
    var f = document.createElement("iframe");
    f.id = "vp-frame";
    f.setAttribute("allow", "clipboard-write");
    f.src = SIDE + "/"; // legacy login page; it routes on to the room after sign-in
    document.body.appendChild(f);
  }

  ensureFrame();
  window.setInterval(ensureFrame, 1000); // re-assert if Element re-renders the page
})();
