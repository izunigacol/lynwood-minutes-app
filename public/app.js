// public/app.js
import { buildAllMinutesDocs } from "/docx-builder.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  authPill:    $("#auth-pill"),
  loginPanel:  $("#login-panel"),
  runPanel:    $("#run-panel"),
  loginEmail:  $("#login-email"),
  loginPass:   $("#login-password"),
  loginBtn:    $("#login-btn"),
  loginError:  $("#login-error"),
  logoutBtn:   $("#logout-btn"),
  form:        $("#generate-form"),
  runBtn:      $("#run-btn"),
  status:      $("#status"),
  downloads:   $("#downloads"),
};

// Token stored in memory only (cleared on page refresh — intentional)
let authToken = null;

// -----------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------
async function login() {
  const email    = els.loginEmail.value.trim();
  const password = els.loginPass.value;
  els.loginError.textContent = "";

  if (!email || !password) {
    els.loginError.textContent = "Enter your email and password.";
    return;
  }

  try {
    els.loginBtn.disabled = true;
    els.loginBtn.textContent = "Signing in…";

    const resp = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await resp.json();

    if (!resp.ok) {
      els.loginError.textContent = data.error || "Login failed.";
      return;
    }

    authToken = data.token;
    showSignedIn(data.email);

  } catch (err) {
    els.loginError.textContent = "Network error. Please try again.";
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Sign in";
  }
}

function logout() {
  authToken = null;
  els.loginPass.value = "";
  els.loginError.textContent = "";
  showSignedOut();
}

function showSignedIn(email) {
  els.authPill.textContent = `Signed in: ${email}`;
  els.authPill.classList.add("ok");
  els.loginPanel.classList.add("hidden");
  els.runPanel.classList.remove("hidden");
}

function showSignedOut() {
  els.authPill.textContent = "Not signed in";
  els.authPill.classList.remove("ok");
  els.loginPanel.classList.remove("hidden");
  els.runPanel.classList.add("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
  showSignedOut();
  els.loginBtn.addEventListener("click", login);
  els.loginPass.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  els.logoutBtn.addEventListener("click", logout);
});

// -----------------------------------------------------------------------
// Generate
// -----------------------------------------------------------------------
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!authToken) { log("ERROR: not signed in"); return; }

  els.runBtn.disabled = true;
  els.status.classList.remove("hidden");
  els.status.textContent = "";
  els.downloads.innerHTML = "";

  try {
    const fd = new FormData(els.form);

    log("Uploading files…");

    const resp = await fetch("/generate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${authToken}` },
      body: fd
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    // Read NDJSON stream
    // We accumulate delta text as a fallback in case the final event
    // is lost (e.g. network hiccup at the very end of the stream).
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let finalJson = null;
    let charsReceived = 0;
    let lastLoggedChars = 0;

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
          const text = evt.text || "";
          accumulatedText += text;
          charsReceived += text.length;
          if (charsReceived - lastLoggedChars >= 500) {
            logProgress(`Receiving… ${charsReceived.toLocaleString()} characters`);
            lastLoggedChars = charsReceived;
          }

        } else if (evt.t === "final") {
          finalJson = evt.json;
          logProgress(`Complete — ${charsReceived.toLocaleString()} characters received.`);

        } else if (evt.t === "error") {
          throw new Error(evt.message);
        }
      }
    }

    // Resolve JSON source: prefer explicit final event, fall back to accumulated text
    let rawJson;
    if (finalJson && finalJson.length > 10) {
      rawJson = finalJson;
      if (charsReceived > lastLoggedChars) {
        logProgress(`Complete — ${charsReceived.toLocaleString()} characters received.`);
      }
    } else if (accumulatedText.length > 10) {
      log("Using streamed text directly…");
      rawJson = accumulatedText;
    } else {
      throw new Error("No content received from server. Please try again.");
    }

    // Strip any accidental code fences
    const cleaned = rawJson.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    log("Building Word documents…");

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (parseErr) {
      offerDownload(new Blob([cleaned], { type: "text/plain" }), "raw_output.txt");
      throw new Error(`JSON parse failed — raw output saved for review.`);
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

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function log(msg) {
  els.status.textContent += msg + "\n";
  els.status.scrollTop = els.status.scrollHeight;
}

function logProgress(msg) {
  const lines = els.status.textContent.split("\n").filter(Boolean);
  const last = lines[lines.length - 1] || "";
  if (last.startsWith("Receiving…") || last.startsWith("Complete")) {
    lines[lines.length - 1] = msg;
  } else {
    lines.push(msg);
  }
  els.status.textContent = lines.join("\n") + "\n";
  els.status.scrollTop = els.status.scrollHeight;
}

function offerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.textContent = `⬇ ${filename}`;
  els.downloads.appendChild(a);
}
