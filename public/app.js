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
// Form submit -> three Claude calls -> docx download
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
    log("Generating Closed Session minutes… (this takes ~20 seconds)");

    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: fd
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    const data = await resp.json();

    if (data.error) {
      throw new Error("Server error: " + data.error);
    }

    log("All sections received. Building Word documents…");

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
