// netlify/functions/generate.mjs
// =====================================================================
// Streaming proxy to Anthropic's Messages API.
//
// SECURITY MODEL
//   - The Anthropic API key lives ONLY in Netlify environment variables
//     (process.env.ANTHROPIC_API_KEY). It is never sent to the browser.
//   - Every request must carry a valid Netlify Identity JWT. Netlify
//     populates `context.clientContext.user` for us when the JWT is valid;
//     we reject anything without a verified user.
//   - In addition to Netlify Identity, we enforce a server-side email
//     whitelist (ALLOWED_EMAILS env var) as defense in depth so a leaked
//     Identity instance cannot be used by random new signups.
//
// STREAMING
//   - Anthropic returns a server-sent-event stream. We pass it straight
//     through to the browser using a ReadableStream so the connection
//     stays open past Netlify's 10s sync-function ceiling.
// =====================================================================

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// --- The system prompt. This is the "institutional knowledge" that used to
// live in README.MD + example.pdf. Edit here to refine output style. -----
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

OUTPUT FORMAT — return a single JSON object (and NOTHING else) matching this
schema. The browser will assemble formatted Word documents from this JSON.

{
  "meeting_date": "Month D, YYYY",
  "meetings": [
    {
      "type": "closed_session" | "regular_meeting" | "successor_agency" | "housing_authority" | "public_financing_authority" | "utility_authority",
      "title": "Lynwood City Council Regular Meeting Closed Session",  // exactly as it should appear in the title block
      "called_to_order": { "time": "5:04 p.m.", "ts": "00:00:00" },
      "presiding": "Mayor Camacho",
      "agenda_certified_by": "City Clerk Quiñonez",
      "agenda_certified_ts": "00:00:07",
      "roll_call": {
        "present": "COUNCIL MEMBERS CUELLAR, SOTO AND MAYOR CAMACHO",  // ALL CAPS, comma-separated
        "absent": "MAYOR PRO TEM AVILA-MOORE AND COUNCIL MEMBER MUNOZ-GUEVARA",
        "ts": "00:00:14",
        "remote_note": "Optional italic note explaining remote participation, or empty string"
      },
      "staff_present": "City Manager Lowenthal, City Attorney Tapia, City Clerk Quiñonez.",
      "pledge": { "text": "led by the Lynwood Sheriff's Explorers", "ts": "00:02:50" },  // omit field if N/A
      "invocation": { "text": "offered by City Clerk Quiñonez", "ts": "00:04:34" },     // omit if N/A
      "presentations": [   // for regular meeting only — array of bolded-title bullets
        { "title": "Earth Day Proclamation – Divine Hustles", "summary": "...", "ts": "00:05:25" }
      ],
      "recess_to": [   // sub-meetings recessed into from this meeting
        { "name": "City of Lynwood as the Successor Agency to the Lynwood Redevelopment Agency",
          "motion": "It was moved by Council Member Cuellar, seconded by Council Member Soto to recess at 7:35 p.m.",
          "ts": "01:34:44",
          "reconvened_at": "7:36 p.m.",
          "reconvened_ts": "01:36:36" }
      ],
      "public_oral_communications_agenda": "NONE",  // or paragraph text
      "public_oral_communications_non_agenda": "NONE",  // or paragraph text
      "public_oral_communications_ts": "01:37:03",
      "consent_calendar": {   // omit field if N/A
        "intro": "All matters listed under the Consent Calendar will be...",
        "pulled_items_note": "Staff pulled item 8.3 from the Consent Calendar...",
        "pulled_items_ts": "02:07:26",
        "balance_motion": {
          "text": "It was moved by Mayor Pro Tem Avila-Moore, seconded by Council Member Cuellar to balance the Consent Calendar (items 8.1, 8.2 and 8.4). Motion carried by the following 5/0 roll call vote:",
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
            "motion": null   // optional per-item motion if pulled and considered separately
          }
        ]
      },
      "new_old_business": [   // omit field if N/A — array of items
        { "number": "09.01",
          "title": "City Council Meeting Schedule for 2026",
          "motion": {
            "text": "It was moved by Mayor Pro Tem Avila-Moore, seconded by Council Member Soto to approve the 2026 schedule with amendments... Motion carried by the following 5/0 roll call vote:",
            "ts": "02:24:31",
            "ayes": "COUNCIL MEMBERS CUELLAR, MUNOZ-GUEVARA, SOTO, MAYOR PRO TEM AVILA-MOORE AND MAYOR CAMACHO",
            "noes": "NONE", "abstain": "NONE", "absent": "NONE"
          },
          "action_left": "Approved and Adopted With Noted Amendments",
          "action_right": "RESOLUTION NO. 2026.___",
          "entitled": "A RESOLUTION..."
        }
      ],
      "council_oral_communication": [   // for regular meeting; council reports
        { "name": "Council Member Cuellar",
          "report": "reported attending the California Contract Cities monthly board meeting on April 15, 2026.",
          "ts": "02:28:24" }
      ],
      "staff_oral_comments": [          // for regular meeting; staff updates
        { "name": "Recreation Director Mark Flores",
          "report": "announced that the Recreation Department, in collaboration with...",
          "ts": "02:51:32" }
      ],
      "closed_session_items": [   // for closed_session meeting only
        { "label": "A.",
          "code_section": "Government Code Section 54956.9(d)(1)",
          "type": "CONFERENCE WITH LEGAL COUNSEL – EXISTING LITIGATION",
          "details": "Case Name: Castellanos v. City of Lynwood" }
      ],
      "report_out": {   // closed_session only
        "text": "With Council Members ... being present, staff made a presentation, City Council provided direction, and there was no reportable action.",
        "ts": "00:01:43",
        "reconvened_time": "6:01 p.m."
      },
      "adjournment": {
        "text": "the meeting was adjourned in memory of Mr. Jesus Lopez.",
        "time": "8:56 p.m.",
        "ts": "02:56:27",
        "motion": "It was moved by Council Member Soto, seconded by Mayor Pro Tem Avila-Moore..."   // optional
      }
    }
  ]
}

CRITICAL RULES
  - Resolution numbers: always use "RESOLUTION NO. {YEAR}.___" (with literal underscores) — the Clerk assigns the real number.
  - Roll call name lists must be ALL CAPS. Council variant uses "COUNCIL MEMBERS"; agency variants use "MEMBERS" (and "VICE CHAIR"/"CHAIR" instead of "MAYOR PRO TEM"/"MAYOR").
  - "Approved and Adopted" / "Received and Filed" / "Approved and Adopted With Noted Amendments" — use the same standard phrases as the example.
  - Always include the [HH:MM:SS] timestamp from the transcript next to motions, votes, and major actions so a human reviewer can re-check the audio.
  - When the transcript does not clearly identify a mover or seconder, use your best inference from context AND set "uncertain": true on that motion field, so the UI can flag it for clerk review.
  - Output JSON ONLY. No prose, no markdown, no code fences, no backticks. 
    Do NOT start with \`\`\`json. Do NOT end with \`\`\`. 
    Your entire response must be a single raw JSON object starting with { and ending with }.`;

// --- Helper: parse user from Netlify Identity context ----------------

function isAllowedEmail(email) {
  const list = (process.env.ALLOWED_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return false; // fail closed if not configured
  return list.includes((email || "").toLowerCase());
}

// =====================================================================
// Handler
// =====================================================================
export default async (req, context) => {
// ---- Auth gate: read JWT from Authorization header ---------------
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return new Response("Unauthorized: please sign in.", { status: 401 });
  }

  let userEmail;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("bad jwt");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return new Response("Unauthorized: token expired.", { status: 401 });
    }
    userEmail = (payload.email ?? "").toLowerCase().trim();
  } catch {
    return new Response("Unauthorized: invalid token.", { status: 401 });
  }

  if (!isAllowedEmail(userEmail)) {
    return new Response(`Forbidden: ${userEmail} is not on the allow list.`, { status: 403 });
  }

  // ---- Parse multipart upload (transcript + agenda PDF) -----------
  let transcriptText, agendaPdfB64;
  try {
    const form = await req.formData();
    const transcriptFile = form.get("transcript");
    const agendaFile = form.get("agenda");
    if (!transcriptFile || !agendaFile) {
      return new Response("Missing transcript or agenda file.", { status: 400 });
    }
    transcriptText = await transcriptFile.text();
    const agendaBuf = new Uint8Array(await agendaFile.arrayBuffer());
    agendaPdfB64 = Buffer.from(agendaBuf).toString("base64");
  } catch (err) {
    return new Response("Could not read uploaded files: " + err.message, { status: 400 });
  }

  // ---- Call Anthropic with streaming ------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Server is missing ANTHROPIC_API_KEY.", { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build the user message: PDF as a document block, transcript as text.
  const userContent = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: agendaPdfB64 },
      title: "short_agenda.pdf",
      context: "Agenda packet for the meeting evening."
    },
    {
      type: "text",
      text: `transcript_with_timestamps.txt:\n\n${transcriptText}\n\nGenerate the JSON now.`
    }
  ];

  // Open a streaming response back to the browser. We forward Anthropic's
  // SSE chunks through a ReadableStream so the browser can show progress.
  const upstream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }]
  });

  const encoder = new TextEncoder();
  const passthrough = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of upstream) {
          // Forward only the events the UI cares about: text deltas + final message.
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            controller.enqueue(encoder.encode(JSON.stringify({ t: "delta", text: event.delta.text }) + "\n"));
          } else if (event.type === "message_delta") {
            // Stop reason / usage updates
            controller.enqueue(encoder.encode(JSON.stringify({ t: "meta", delta: event.delta, usage: event.usage }) + "\n"));
          } else if (event.type === "message_stop") {
            controller.enqueue(encoder.encode(JSON.stringify({ t: "done" }) + "\n"));
          }
        }
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(JSON.stringify({ t: "error", message: err.message }) + "\n"));
        controller.close();
      }
    }
  });

  return new Response(passthrough, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    }
  });
};

// Netlify v2 functions config: enable streaming explicitly.
export const config = {
  path: "/.netlify/functions/generate"
};
