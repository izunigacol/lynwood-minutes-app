// public/app.js
// =====================================================================
// Front-end controller: auth gate, upload, streaming consumption,
// then docx assembly via the shared docx-builder module.
// =====================================================================

import { buildAllMinutesDocs } from "/docx-builder.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  authPill:   $("#auth-pill"),
  loginPanel: $("#login-panel"),
  runPanel:   $("#run-panel"),
  loginBtn:   $("#login-btn"),
  logoutBtn:  $("#logout-btn"),
  form:       $("#generate-form"),
  runBtn:     $("#run-btn"),
  status:     $("#status"),
  downloads:  $("#downloads"),
};

// ---------------------------------------------------------------------
// Netlify Identity wiring
// ---------------------------------------------------------------------
function onIdentity(user) {
  if (user) {
    els.authPill.textContent = `Signed in: ${user.email}`;
    els.authPill.classList.add("ok");
    els.loginPanel.classList.add("hidden");
    els.runPanel.classList.remove("hidden");
  } else {
    els.authPill.textContent = "Not signed in";
    els.authPill.classList.remove("ok");
    els.loginPanel.classList.remove("hidden");
    els.runPanel.classList.add("hidden");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (!window.netlifyIdentity) {
    setTimeout(() => window.dispatchEvent(new Event("DOMContentLoaded")), 50);
    return;
  }
  netlifyIdentity.on("init",    onIdentity);
  netlifyIdentity.on("login",   (u) => { onIdentity(u); netlifyIdentity.close(); });
  netlifyIdentity.on("logout",  () => onIdentity(null));
  netlifyIdentity.init();

  els.loginBtn.addEventListener("click",  () => netlifyIdentity.open());
  els.logoutBtn.addEventListener("click", () => netlifyIdentity.logout());
});

// ---------------------------------------------------------------------
// Form submit -> streaming function call -> docx download
// ---------------------------------------------------------------------
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = netlifyIdentity?.currentUser?.();
  if (!user) {
    log("ERROR: not signed in");
    return;
  }

  els.runBtn.disabled = true;
  els.status.classList.remove("hidden");
  els.status.textContent = "";
  els.downloads.innerHTML = "";

  try {
    const fd = new FormData(els.form);

    // Get a fresh JWT — Identity refreshes if needed
    const token = await user.jwt(true);

    log("Uploading files and starting Claude stream…");

    const resp = await fetch("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: fd
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    // Stream consumption: NDJSON lines from the function
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let chunkCount = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // last partial line stays in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.t === "delta") {
          fullText += evt.text;
          chunkCount++;
            if (chunkCount % 5 === 0) {
            log(`…${fullText.length.toLocaleString()} chars received`);
          }
          } else if (evt.t === "reset") {
            fullText = "";
            chunkCount = 0;
          } else if (evt.t === "progress") {
            log(`✓ ${evt.label} complete`);
          } else if (evt.t === "meta") {
            // ignore in UI for now; available if you want to surface usage
          } else if (evt.t === "done") {
            log("Stream complete. Parsing JSON…");
          } else if (evt.t === "error") {
            throw new Error("Function reported error: " + evt.message);
          }
      }
    }

    // Strip any accidental code-fence wrapping
     const cleaned = ("{" + fullText.trim())
      .replace(/\n?```\s*$/i, "")
      .trim();

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (err) {
      log("ERROR: Claude's output was not valid JSON. Raw output saved as ALL.txt for review.");
      offerDownload(new Blob([fullText], { type: "text/plain" }), "Claude_raw_output.txt");
      throw err;
    }

    log("Building Word documents…");
    const docs = await buildAllMinutesDocs(data);

    docs.forEach(({ filename, blob }) => offerDownload(blob, filename));
    log(`Done. ${docs.length} document(s) ready.`);
  } catch (err) {
    log("ERROR: " + err.message);
    console.error(err);
  } finally {
    els.runBtn.disabled = false;
  }
});

function log(msg) {
  els.status.textContent += msg + "\n";
  els.status.scrollTop = els.status.scrollHeight;
}

function offerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.textContent = `⬇ ${filename}`;
  els.downloads.appendChild(a);
}
