// netlify/functions/generate.mjs
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

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
        { "title": "Earth Day Proclamation – Divine Hustles", "summary": "...", "ts": "00:05:25" }
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
            "motion": null
          }
        ]
      },
      "new_old_business": [
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
      "council_oral_communication": [
        { "name": "Council Member Cuellar",
          "report": "reported attending the California Contract Cities monthly board meeting on April 15, 2026.",
          "ts": "02:28:24" }
      ],
      "staff_oral_comments": [
        { "name": "Recreation Director Mark Flores",
          "report": "announced that the Recreation Department, in collaboration with...",
          "ts": "02:51:32" }
      ],
      "closed_session_items": [
        { "label": "A.",
          "code_section": "Government Code Section 54956.9(d)(1)",
          "type": "CONFERENCE WITH LEGAL COUNSEL – EXISTING LITIGATION",
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
  - Roll call name lists must be ALL CAPS. Council variant uses "COUNCIL MEMBERS"; agency variants use "MEMBERS" (and "VICE CHAIR"/"CHAIR" instead of "MAYOR PRO TEM"/"MAYOR").
  - "Approved and Adopted" / "Received and Filed" / "Approved and Adopted With Noted Amendments" — use the same standard phrases as the example.
  - Always include the [HH:MM:SS] timestamp from the transcript next to motions, votes, and major actions.
  - When the transcript does not clearly identify a mover or seconder, use your best inference from context AND set "uncertain": true on that motion field.
  - Output JSON ONLY. No prose, no markdown, no code fences, no backticks.
  - Do NOT start with \`\`\`json. Do NOT end with \`\`\`.
  - Your entire response must be a single raw JSON array starting with [ and ending with ].`;

function isAllowedEmail(email) {
  const list = (process.env.ALLOWED_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return false;
  return list.includes((email || "").toLowerCase());
}

// =====================================================================
// Handler
// =====================================================================
export default async (req, context) => {

  // ---- Auth gate ---------------------------------------------------
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

  if (req.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  // ---- Parse multipart upload -------------------------------------
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

  // ---- API key check ----------------------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Server is missing ANTHROPIC_API_KEY.", { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ---- Three chunked calls to avoid token limits ------------------
  const meetingChunks = [
    {
      label: "Closed Session",
      instruction: `Generate ONLY the closed_session meeting object.
Return a JSON array with exactly one object: [{...}].
No prose, no fences, no backticks. Start with [ and end with ].`
    },
    {
      label: "Regular Meeting",
      instruction: `Generate ONLY the regular_meeting object.
Return a JSON array with exactly one object: [{...}].
No prose, no fences, no backticks. Start with [ and end with ].`
    },
    {
      label: "Successor Agency and other agencies",
      instruction: `Generate ONLY the successor_agency, housing_authority, public_financing_authority,
and utility_authority meeting objects (whichever actually occurred tonight).
Return a JSON array of those objects: [{...},{...}].
If none occurred, return an empty array: [].
No prose, no fences, no backticks. Start with [ and end with ].`
    }
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const allMeetings = [];
        let meetingDate = "";

        for (const chunk of meetingChunks) {
          // Send a heartbeat so the connection stays alive
          send({ t: "delta", text: "" });

          const chunkContent = [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: agendaPdfB64 },
              title: "short_agenda.pdf",
              context: "Agenda packet for the meeting evening."
            },
            {
              type: "text",
              text: `transcript_with_timestamps.txt:\n\n${transcriptText}\n\n${chunk.instruction}`
            }
          ];

          const result = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            messages: [
              { role: "user", content: chunkContent }
            ]
          });

          // Prepend the [ we used as prefill
          const raw = (result.content[0]?.text ?? "").trim()
            .replace(/^```(?:json)?\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();

          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (parseErr) {
            send({ t: "error", message: `Failed to parse ${chunk.label} JSON: ${raw.slice(0, 300)}` });
            controller.close();
            return;
          }

          // Extract meeting_date from first object if present
          if (!meetingDate && parsed[0]?.meeting_date) {
            meetingDate = parsed[0].meeting_date;
          }

          // Each item may or may not have meeting_date; just grab the meeting data
          for (const item of parsed) {
            const { meeting_date, ...meetingData } = item;
            allMeetings.push(meetingData);
          }

          send({ t: "progress", label: chunk.label });
        }

        // Assemble final JSON and send to browser
        const finalJson = JSON.stringify({
          meeting_date: meetingDate,
          meetings: allMeetings
        });

        send({ t: "reset" });
        send({ t: "delta", text: finalJson });
        send({ t: "done" });
        controller.close();

      } catch (err) {
        send({ t: "error", message: err.message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    }
  });
};

// ---- Netlify v2 config (MUST be outside the handler) ----------------
export const config = {
  path: "/.netlify/functions/generate"
};
