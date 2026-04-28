// server.mjs
// =====================================================================
// Express server for Railway deployment.
// Handles auth, Claude streaming, and serves static files.
// =====================================================================
import express from "express";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// ---- JWT helpers (no external library needed) -----------------------
function signToken(payload) {
  const secret = process.env.JWT_SECRET || "changeme";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body   = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig    = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET || "changeme";
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) throw new Error("Invalid signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}

// ---- Email allow-list check ----------------------------------------
function isAllowedEmail(email) {
  const list = (process.env.ALLOWED_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return false;
  return list.includes((email || "").toLowerCase());
}

// ---- Auth middleware ------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized: missing token" });
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: " + err.message });
  }
}

// =====================================================================
// POST /auth  — login with email + password, returns JWT
// =====================================================================
app.post("/auth", (req, res) => {
  const { email, password } = req.body;
  const appPassword = process.env.APP_PASSWORD || "";

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  if (!appPassword) {
    return res.status(500).json({ error: "Server misconfiguration: APP_PASSWORD not set" });
  }
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ error: "This email is not on the access list" });
  }
  if (password !== appPassword) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  const token = signToken({
    email: email.toLowerCase().trim(),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8  // 8 hour session
  });

  res.json({ token, email: email.toLowerCase().trim() });
});

// =====================================================================
// POST /generate  — Claude call with streaming
// =====================================================================

const SYSTEM_PROMPT = `You generate Action Meeting Minutes for the Lynwood City Council in the exact style used by the Lynwood City Clerk's office.

The City Council typically holds several meetings in one evening:
  1. Regular City Council Meeting Closed Session
  2. Regular City Council Meeting (the main meeting)
  3. Lynwood Successor Agency to the Lynwood Redevelopment Agency
  4. Lynwood Housing Authority
  5. Lynwood Public Financing Authority
  6. Lynwood Utility Authority
Most evenings include only some of these.

You will be given two attachments:
  - transcript_with_timestamps.txt — automated transcription of the audio
  - short_agenda.pdf — the agenda packet for the evening
Use the agenda to identify which sub-meetings were held and which numbered
items were considered. Use the transcript to extract precise actions, times,
movers/seconders, and vote tallies.

OUTPUT FORMAT — return a single JSON object (and NOTHING else) matching this schema.

{
  "meeting_date": "Month D, YYYY",
  "meetings": [
    {
      "type": "closed_session | regular_meeting | successor_agency | housing_authority | public_financing_authority | utility_authority",
      "title": "Lynwood City Council Regular Meeting Closed Session",
      "called_to_order": { "time": "5:04 p.m.", "ts": "00:00:00" },
      "presiding": "Mayor Camacho",
      "agenda_certified_by": "City Clerk Quiñonez",
      "agenda_certified_ts": "00:00:07",
      "roll_call": {
        "present": "COUNCIL MEMBERS CUELLAR, SOTO AND MAYOR CAMACHO",
        "absent": "MAYOR PRO TEM AVILA-MOORE AND COUNCIL MEMBER MUNOZ-GUEVARA",
        "ts": "00:00:14",
        "remote_note": "Optional italic note explaining remote participation, or empty string"
      },
      "staff_present": "City Manager Lowenthal, City Attorney Tapia, City Clerk Quiñonez.",
      "pledge": { "text": "led by the Lynwood Sheriff's Explorers", "ts": "00:02:50" },
      "invocation": { "text": "offered by City Clerk Quiñonez", "ts": "00:04:34" },
      "presentations": [
        { "title": "Earth Day Proclamation - Divine Hustles", "summary": "...", "ts": "00:05:25" }
      ],
      "recess_to": [
        { "name": "City of Lynwood as the Successor Agency to the Lynwood Redevelopment Agency",
          "motion": "It was moved by Council Member Cuellar, seconded by Council Member Soto to recess at 7:35 p.m.",
          "ts": "01:34:44",
          "reconvened_at": "7:36 p.m.",
          "reconvened_ts": "01:36:36" }
      ],
      "public_oral_communications_agenda": "NONE",
      "public_oral_communications_non_agenda": "NONE",
      "public_oral_communications_ts": "01:37:03",
      "consent_calendar": {
        "intro": "All matters listed under the Consent Calendar will be...",
        "pulled_items_note": "Staff pulled item 8.3 from the Consent Calendar...",
        "pulled_items_ts": "02:07:26",
        "balance_motion": {
          "text": "It was moved by Mayor Pro Tem Avila-Moore, seconded by Council Member Cuellar to balance the Consent Calendar. Motion carried by the following 5/0 roll call vote:",
          "ts": "02:07:42",
          "ayes": "COUNCIL MEMBERS CUELLAR, MUNOZ-GUEVARA, SOTO, MAYOR PRO TEM AVILA-MOORE AND MAYOR CAMACHO",
          "noes": "NONE", "abstain": "NONE", "absent": "NONE"
        },
        "items": [
          { "number": "08.01",
            "title": "Approval of the Warrant Register",
            "action_left": "Approved and Adopted",
            "action_right": "RESOLUTION NO. 2026.___",
            "entitled": "A RESOLUTION OF THE CITY COUNCIL... (in ALL CAPS)",
            "motion": null
          }
        ]
      },
      "new_old_business": [
        { "number": "09.01",
          "title": "City Council Meeting Schedule for 2026",
          "motion": {
            "text": "It was moved by Mayor Pro Tem Avila-Moore, seconded by Council Member Soto to approve... Motion carried by the following 5/0 roll call vote:",
            "ts": "02:24:31",
            "ayes": "COUNCIL MEMBERS CUELLAR, MUNOZ-GUEVARA, SOTO, MAYOR PRO TEM AVILA-MOORE AND MAYOR CAMACHO",
            "noes": "NONE", "abstain": "NONE", "absent": "NONE"
          },
          "action_left": "Approved and Adopted With Noted Amendments",
          "action_right": "RESOLUTION NO. 2026.___",
          "entitled": "A RESOLUTION..."
        }
      ],
      "council_oral_communication": [
        { "name": "Council Member Cuellar", "report": "...", "ts": "02:28:24" }
      ],
      "staff_oral_comments": [
        { "name": "Recreation Director Mark Flores", "report": "...", "ts": "02:51:32" }
      ],
      "closed_session_items": [
        { "label": "A.",
          "code_section": "Government Code Section 54956.9(d)(1)",
          "type": "CONFERENCE WITH LEGAL COUNSEL - EXISTING LITIGATION",
          "details": "Case Name: Castellanos v. City of Lynwood" }
      ],
      "report_out": {
        "text": "With Council Members ... being present, staff made a presentation, City Council provided direction, and there was no reportable action.",
        "ts": "00:01:43",
        "reconvened_time": "6:01 p.m."
      },
      "adjournment": {
        "text": "the meeting was adjourned in memory of Mr. Jesus Lopez.",
        "time": "8:56 p.m.",
        "ts": "02:56:27",
        "motion": "It was moved by Council Member Soto, seconded by Mayor Pro Tem Avila-Moore..."
      }
    }
  ]
}

CRITICAL RULES
  - Resolution numbers: always use "RESOLUTION NO. {YEAR}.___" (with literal underscores).
  - Roll call name lists must be ALL CAPS. Council uses "COUNCIL MEMBERS"; agencies use "MEMBERS" (and "VICE CHAIR"/"CHAIR" instead of "MAYOR PRO TEM"/"MAYOR").
  - Use standard phrases: "Approved and Adopted" / "Received and Filed" / "Approved and Adopted With Noted Amendments".
  - Always include HH:MM:SS timestamps next to motions, votes, and major actions.
  - When mover/seconder unclear, use best inference AND set "uncertain": true on that motion.
  - Output JSON ONLY. No prose, no markdown, no code fences, no backticks.
  - Your entire response must start with { and end with }.`;

app.post("/generate", requireAuth, async (req, res) => {
  // Parse multipart form data manually using raw body
  // We use busboy for multipart parsing
  const busboy = (await import("busboy")).default;

  const bb = busboy({ headers: req.headers });
  let transcriptText = "";
  let agendaPdfB64 = "";
  const fields = {};

  await new Promise((resolve, reject) => {
    bb.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (name === "transcript") {
          transcriptText = buf.toString("utf8");
        } else if (name === "agenda") {
          agendaPdfB64 = buf.toString("base64");
        }
      });
    });
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("close", resolve);
    bb.on("error", reject);
    req.pipe(bb);
  });

  if (!transcriptText || !agendaPdfB64) {
    return res.status(400).json({ error: "Missing transcript or agenda file" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Set up streaming response headers
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "Transfer-Encoding": "chunked"
  });

  const send = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    send({ t: "ping", message: "Connected. Sending to Claude…" });

    let fullText = "";

    const claudeStream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: agendaPdfB64
            },
            title: "short_agenda.pdf",
            context: "Agenda packet for the meeting evening."
          },
          {
            type: "text",
            text: `transcript_with_timestamps.txt:\n\n${transcriptText}\n\nGenerate the JSON now.`
          }
        ]
      }]
    });

    for await (const event of claudeStream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        fullText += event.delta.text;
        send({ t: "delta", text: event.delta.text });
      }
    }

    // Clean and send final
    const cleaned = fullText.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    send({ t: "final", json: cleaned });
    res.end();

  } catch (err) {
    console.error("Generate error:", err);
    send({ t: "error", message: err.message });
    res.end();
  }
});

// =====================================================================
// Serve static files from /public
// =====================================================================
app.use(express.static(join(__dirname, "public")));

// Fallback: serve index.html for any unmatched route
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// =====================================================================
// Start server
// =====================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lynwood Minutes server running on port ${PORT}`);
});
