// public/app.js
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
// Form submit -> stream -> build docs
// ---------------------------------------------------------------------
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = netlifyIdentity?.currentUser?.();
  if (!user) { log("ERROR: not signed in"); return; }

  els.runBtn.disabled = true;
  els.status.classList.remove("hidden");
  els.status.textContent = "";
  els.downloads.innerHTML = "";

  try {
    const fd = new FormData(els.form);
    const token = await user.jwt(true);

    log("Uploading files…");

    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: fd
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    // Read NDJSON stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalJson = null;
    let charsReceived = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }

        if (evt.t === "ping") {
          log(evt.message);
        } else if (evt.t === "delta") {
          charsReceived += (evt.text || "").length;
          // Update progress every ~500 chars
          if (charsReceived % 500 < 50) {
            log(`Receiving… ${charsReceived.toLocaleString()} characters`);
          }
        } else if (evt.t === "final") {
          finalJson = evt.json;
          log(`Complete. ${charsReceived.toLocaleString()} characters received.`);
        } else if (evt.t === "error") {
          throw new Error(evt.message);
        }
      }
    }

    if (!finalJson) {
      throw new Error("No output received from server. Please try again.");
    }

    log("Building Word documents…");

    let data;
    try {
      data = JSON.parse(finalJson);
    } catch (err) {
      offerDownload(new Blob([finalJson], { type: "text/plain" }), "raw_output.txt");
      throw new Error("Could not parse response as JSON — raw output saved for review.");
    }

    const docs = await buildAllMinutesDocs(data);
    docs.forEach(({ filename, blob }) => offerDownload(blob, filename));
    log(`Done! ${docs.length} document(s) ready to download.`);

  } catch (err) {
    log("ERROR: " + err.message);
    console.error(err);
  } finally {
    els.runBtn.disabled = false;
  }
});

function log(msg) {
  // Overwrite progress lines, append status lines
  const lines = els.status.textContent.split("\n").filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  if (lastLine.startsWith("Receiving…") && msg.startsWith("Receiving…")) {
    lines[lines.length - 1] = msg; // update in place
  } else {
    lines.push(msg);
  }
  els.status.textContent = lines.join("\n") + "\n";
  els.status.scrollTop = els.status.scrollHeight;
}

function offerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.textContent = `⬇ ${filename}`;
  els.downloads.appendChild(a);
}
