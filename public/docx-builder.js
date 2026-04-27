// public/docx-builder.js
// =====================================================================
// Browser-side Word generator. Consumes the JSON returned by Claude
// (see schema in netlify/functions/generate.mjs) and produces one
// Blob per meeting using docx-js (loaded from the UMD bundle in index.html
// — the global `docx` is available).
//
// Style mirrors example.pdf:
//   - Arial body, 11pt, justified
//   - Section numbers (01., 02., ...) BOLD with hanging indent
//   - Centered subheaders (PUBLIC ORAL COMMUNICATIONS, Closed Session,
//     Consent Calendar, New/Old Business, ADJOURNMENT) BOLD + UNDERLINED
//   - Numbered consent / business items (08.01., 09.01., ...) BOLD
//   - Two-column "Approved and Adopted | RESOLUTION NO. ..." layout
//   - "ENTITLED:" body justified, ALL CAPS
//   - Italic [HH:MM:SS] timestamp markers
// =====================================================================

const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  TabStopType, TabStopPosition, PageNumber, Footer, UnderlineType
} = window.docx;

const FONT = "Arial";
const SIZE = 22; // 11pt in half-points
const INDENT_NUM   =  720; // 0.5"
const INDENT_TITLE = 1440; // 1.0"
const INDENT_NAMES = 2880; // 2.0"
const INDENT_RIGHT = 5040; // 3.5"

const run = (t, o={}) => new TextRun({
  text: t, bold: o.bold, italics: o.italics,
  underline: o.underline ? { type: UnderlineType.SINGLE } : undefined,
  font: FONT, size: o.size || SIZE
});

const Body = (t, o={}) => new Paragraph({
  spacing: { after: 200, line: 276 },
  alignment: o.align || AlignmentType.JUSTIFIED,
  indent: { left: o.indent !== undefined ? o.indent : INDENT_TITLE },
  children: [run(t, o)]
});

const BodyM = (parts, o={}) => new Paragraph({
  spacing: { after: 200, line: 276 },
  alignment: o.align || AlignmentType.JUSTIFIED,
  indent: { left: o.indent !== undefined ? o.indent : INDENT_TITLE },
  children: parts.map(p => typeof p === "string"
    ? run(p)
    : run(p.t, { bold: p.b, italics: p.i, underline: p.u, size: p.s }))
});

const Section = (num, title) => new Paragraph({
  spacing: { before: 240, after: 200, line: 276 },
  indent: { left: INDENT_TITLE, hanging: INDENT_TITLE - INDENT_NUM },
  tabStops: [{ type: TabStopType.LEFT, position: INDENT_TITLE }],
  children: [run(`${num}.\t`, { bold: true }), run(title, { bold: true })]
});

const ItemHeader = (num, title) => new Paragraph({
  spacing: { before: 240, after: 160, line: 276 },
  indent: { left: INDENT_TITLE, hanging: INDENT_TITLE - INDENT_NUM },
  tabStops: [{ type: TabStopType.LEFT, position: INDENT_TITLE }],
  children: [run(`${num}.\t`, { bold: true }), run((title || "").toUpperCase(), { bold: true })]
});

const CenterHead = (t) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 240, after: 200, line: 276 },
  children: [run(t, { bold: true, underline: true })]
});

const Center = (t, o={}) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 120, line: 276 },
  children: [run(t, o)]
});

const TitleBlock = (a, b, c) => [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 276 }, children: [run(a, { bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 276 }, children: [run(b, { bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320, line: 276 }, children: [run(c, { bold: true })] })
];

function tsRun(ts) { return ts ? run(`  [${ts}]`, { italics: true, size: 18 }) : null; }

const PresentLine = (names, ts) => new Paragraph({
  spacing: { after: 80, line: 276 },
  indent: { left: INDENT_TITLE },
  tabStops: [{ type: TabStopType.LEFT, position: INDENT_NAMES }],
  children: [run("PRESENT:\t"), run(names || ""), tsRun(ts)].filter(Boolean)
});

const AbsentLine = (names) => new Paragraph({
  spacing: { after: 200, line: 276 },
  indent: { left: INDENT_TITLE },
  tabStops: [{ type: TabStopType.LEFT, position: INDENT_NAMES }],
  children: [run("ABSENT:\t"), run(names || "NONE")]
});

const RollCall = (vote) => {
  const rows = [];
  rows.push(new Paragraph({
    spacing: { after: 120, line: 276 }, indent: { left: INDENT_TITLE },
    children: [run("ROLL CALL:")]
  }));
  // AYES — break long lists into two lines
  const ayes = vote.ayes || "";
  const ayesParts = ayes.split(/,\s+(?=MAYOR|VICE)/i); // best-effort wrap before MAYOR/VICE
  rows.push(new Paragraph({
    spacing: { after: 120, line: 276 }, indent: { left: INDENT_TITLE },
    tabStops: [{ type: TabStopType.LEFT, position: INDENT_NAMES }],
    children: [run("AYES:\t"), run(ayesParts[0] + (ayesParts.length > 1 ? "," : ""))]
  }));
  if (ayesParts.length > 1) {
    rows.push(new Paragraph({
      spacing: { after: 120, line: 276 }, indent: { left: INDENT_NAMES },
      children: [run(ayesParts.slice(1).join(", "))]
    }));
  }
  for (const [label, val] of [["NOES", vote.noes], ["ABSTAIN", vote.abstain], ["ABSENT", vote.absent]]) {
    rows.push(new Paragraph({
      spacing: { after: 80, line: 276 }, indent: { left: INDENT_TITLE },
      tabStops: [{ type: TabStopType.LEFT, position: INDENT_NAMES }],
      children: [run(`${label}:\t${val || "NONE"}`)]
    }));
  }
  return rows;
};

const ApprovedRes = (left, right) => new Paragraph({
  spacing: { before: 200, after: 80, line: 276 }, indent: { left: INDENT_TITLE },
  tabStops: [{ type: TabStopType.LEFT, position: INDENT_RIGHT }],
  children: [run(left || ""), run("\t"), run(right || "")]
});

const Entitled = (t) => new Paragraph({
  spacing: { after: 200, line: 276 }, alignment: AlignmentType.JUSTIFIED, indent: { left: INDENT_TITLE },
  children: [run("ENTITLED: "), run(t || "")]
});

const SigBlock = (clerkLabel, mayorLabel) => [
  new Paragraph({ spacing: { before: 480 }, children: [run("")] }),
  new Paragraph({ spacing: { before: 480 }, children: [run("")] }),
  new Paragraph({
    indent: { left: INDENT_TITLE },
    tabStops: [{ type: TabStopType.LEFT, position: 6480 }],
    children: [run("_____________________________"), run("\t"), run("_____________________________")]
  }),
  new Paragraph({
    indent: { left: INDENT_TITLE },
    tabStops: [{ type: TabStopType.LEFT, position: 6480 }],
    children: [
      run(`Maria Quiñonez, ${clerkLabel}`),
      run("\t"),
      run(`Gabriela Camacho, ${mayorLabel}`)
    ]
  })
];

const DraftBanner = () => [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [run("DRAFT — FOR REVIEW", { bold: true, size: 20 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [run("Bracketed timestamps [HH:MM:SS] reference the meeting audio for human verification. Resolution numbers shown as YEAR.___ pending City Clerk assignment.", { italics: true, size: 16 })] })
];

// =====================================================================
// Meeting renderer
// =====================================================================
function renderMeeting(m, dateStr) {
  const out = [];
  out.push(...DraftBanner());
  out.push(...TitleBlock(m.title || "", dateStr || m.meeting_date || "", "Action Meeting Minutes"));

  // 01. CALL TO ORDER
  out.push(Section("01", "CALL TO ORDER"));
  out.push(Body(`The ${m.title || "meeting"} of the City of Lynwood met in the Council Chambers, 11350 Bullis Road Lynwood, CA 90262 on the above date. An audio recording of this meeting is available on the City's Web Portal: Audio (laserfiche.com).`));
  if (m.called_to_order) {
    out.push(BodyM([
      { t: `Meeting called to order at ${m.called_to_order.time || ""}.` },
      m.called_to_order.ts ? { t: `  [${m.called_to_order.ts}]`, i: true, s: 18 } : null
    ].filter(Boolean)));
  }
  if (m.presiding) out.push(Body(`${m.presiding} presiding.`));

  // 02. CERTIFICATION
  out.push(Section("02", m.type === "successor_agency" ? "CERTIFICATION OF AGENDA POSTING BY SECRETARY" : "CERTIFICATION OF AGENDA POSTING BY CITY CLERK"));
  if (m.agenda_certified_by) {
    out.push(BodyM([
      { t: `${m.agenda_certified_by} announced the Agenda had been duly posted in accordance with the Brown Act.` },
      m.agenda_certified_ts ? { t: `  [${m.agenda_certified_ts}]`, i: true, s: 18 } : null
    ].filter(Boolean)));
  }

  // 03. ROLL CALL
  out.push(Section("03", m.type === "successor_agency" ? "ROLL CALL OF MEMBERS" : "ROLL CALL OF COUNCIL MEMBERS"));
  if (m.roll_call) {
    out.push(PresentLine(m.roll_call.present, m.roll_call.ts));
    out.push(AbsentLine(m.roll_call.absent));
    if (m.roll_call.remote_note) out.push(BodyM([{ t: `(${m.roll_call.remote_note})`, i: true }]));
  }
  if (m.staff_present) {
    out.push(new Paragraph({
      spacing: { before: 120, after: 80, line: 276 }, indent: { left: INDENT_TITLE },
      children: [run("STAFF PRESENT:")]
    }));
    out.push(Body(m.staff_present));
  }

  let sectionNum = 4;
  const nextSection = () => String(sectionNum++).padStart(2, "0");

  // PLEDGE / INVOCATION (regular meeting)
  if (m.pledge) {
    out.push(Section(nextSection(), "PLEDGE OF ALLEGIANCE"));
    out.push(BodyM([
      { t: `The Pledge of Allegiance was ${m.pledge.text}.` },
      m.pledge.ts ? { t: `  [${m.pledge.ts}]`, i: true, s: 18 } : null
    ].filter(Boolean)));
  }
  if (m.invocation) {
    out.push(Section(nextSection(), "INVOCATION"));
    out.push(BodyM([
      { t: `The invocation was ${m.invocation.text}.` },
      m.invocation.ts ? { t: `  [${m.invocation.ts}]`, i: true, s: 18 } : null
    ].filter(Boolean)));
  }

  // PRESENTATIONS
  if (m.presentations?.length) {
    out.push(Section(nextSection(), "PRESENTATIONS/PROCLAMATIONS"));
    for (const p of m.presentations) {
      out.push(BodyM([
        { t: `${p.title}. `, b: true },
        { t: p.summary || "" },
        p.ts ? { t: `  [${p.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
    }
  }

  // RECESS TO sub-meetings
  if (m.recess_to?.length) {
    out.push(Section(nextSection(), "COUNCIL RECESS TO:"));
    for (const r of m.recess_to) {
      out.push(BodyM([{ t: r.name, u: true }]));
      out.push(BodyM([
        { t: "MOTION: " }, { t: r.motion || "" },
        r.ts ? { t: `  [${r.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
      if (r.reconvened_at) {
        out.push(BodyM([
          { t: `The City Council reconvened at ${r.reconvened_at}.` },
          r.reconvened_ts ? { t: `  [${r.reconvened_ts}]`, i: true, s: 18 } : null
        ].filter(Boolean)));
      }
    }
  }

  // PUBLIC ORAL COMMUNICATIONS (always present)
  out.push(CenterHead("PUBLIC ORAL COMMUNICATIONS"));
  out.push(Center("(Regarding Agenda Items Only)"));
  if (m.public_oral_communications_agenda && m.public_oral_communications_agenda !== "NONE") {
    out.push(Body(m.public_oral_communications_agenda));
  } else {
    out.push(Center("NONE"));
  }

  out.push(CenterHead("NON-AGENDA PUBLIC ORAL COMMUNICATIONS"));
  if (m.public_oral_communications_non_agenda && m.public_oral_communications_non_agenda !== "NONE") {
    out.push(BodyM([
      { t: m.public_oral_communications_non_agenda },
      m.public_oral_communications_ts ? { t: `  [${m.public_oral_communications_ts}]`, i: true, s: 18 } : null
    ].filter(Boolean)));
  } else {
    out.push(Center("NONE"));
  }

  // CLOSED SESSION items (closed_session meeting)
  if (m.closed_session_items?.length) {
    out.push(CenterHead("Closed Session"));
    out.push(Section(nextSection(), "CLOSED SESSION"));
    for (const it of m.closed_session_items) {
      out.push(new Paragraph({
        spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, indent: { left: INDENT_TITLE },
        children: [
          run(`${it.label || ""}\t`),
          run(`With respect to every item of business to be discussed in closed session pursuant to ${it.code_section}: `),
          run(it.type, { bold: false })
        ]
      }));
      if (it.details) out.push(Body(it.details, { indent: INDENT_NAMES }));
    }
    if (m.report_out) {
      out.push(BodyM([
        { t: "The City Attorney reported on the following item out of closed session:" },
        m.report_out.ts ? { t: `  [${m.report_out.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
      out.push(Body(m.report_out.text || ""));
      if (m.report_out.reconvened_time) out.push(Body(`The City Council reconvened into open session at ${m.report_out.reconvened_time}.`));
    }
  }

  // CONSENT CALENDAR
  if (m.consent_calendar) {
    out.push(CenterHead("Consent Calendar"));
    if (m.consent_calendar.intro) out.push(Body(m.consent_calendar.intro));
    if (m.consent_calendar.pulled_items_note) {
      out.push(BodyM([
        { t: m.consent_calendar.pulled_items_note },
        m.consent_calendar.pulled_items_ts ? { t: `  [${m.consent_calendar.pulled_items_ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
    }
    const bm = m.consent_calendar.balance_motion;
    if (bm) {
      out.push(BodyM([
        { t: "MOTION: " }, { t: bm.text || "" },
        bm.ts ? { t: `  [${bm.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
      out.push(...RollCall(bm));
    }
    for (const it of m.consent_calendar.items || []) {
      out.push(ItemHeader(it.number, it.title));
      if (it.motion) {
        out.push(BodyM([
          { t: "MOTION: " }, { t: it.motion.text || "" },
          it.motion.ts ? { t: `  [${it.motion.ts}]`, i: true, s: 18 } : null
        ].filter(Boolean)));
        out.push(...RollCall(it.motion));
      }
      if (it.action_left || it.action_right) out.push(ApprovedRes(it.action_left, it.action_right));
      if (it.entitled) out.push(Entitled(it.entitled));
    }
  }

  // NEW / OLD BUSINESS
  if (m.new_old_business?.length) {
    out.push(CenterHead("New/Old Business"));
    for (const it of m.new_old_business) {
      out.push(ItemHeader(it.number, it.title));
      if (it.motion) {
        out.push(BodyM([
          { t: "MOTION: " }, { t: it.motion.text || "" },
          it.motion.ts ? { t: `  [${it.motion.ts}]`, i: true, s: 18 } : null
        ].filter(Boolean)));
        out.push(...RollCall(it.motion));
      }
      if (it.action_left || it.action_right) out.push(ApprovedRes(it.action_left, it.action_right));
      if (it.entitled) out.push(Entitled(it.entitled));
    }
  }

  // COUNCIL ORAL & WRITTEN
  if (m.council_oral_communication?.length) {
    out.push(Section(nextSection(), "CITY COUNCIL ORAL AND WRITTEN COMMUNICATION"));
    out.push(Body("City Council Members Reporting on Meetings Attended (Gov. Code Section 53232.3 (D))."));
    for (const c of m.council_oral_communication) {
      out.push(BodyM([
        { t: `${c.name} `, b: true },
        { t: c.report || "" },
        c.ts ? { t: `  [${c.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
    }
  }

  // STAFF ORAL
  if (m.staff_oral_comments?.length) {
    out.push(Section(nextSection(), "STAFF ORAL COMMENTS"));
    for (const s of m.staff_oral_comments) {
      out.push(BodyM([
        { t: `${s.name} `, b: true },
        { t: s.report || "" },
        s.ts ? { t: `  [${s.ts}]`, i: true, s: 18 } : null
      ].filter(Boolean)));
    }
  }

  // ADJOURNMENT
  if (m.adjournment) {
    out.push(CenterHead("ADJOURNMENT"));
    const parts = [];
    if (m.adjournment.time) parts.push({ t: `At ${m.adjournment.time}, ` });
    if (m.adjournment.motion) {
      parts.push({ t: "MOTION: " });
      parts.push({ t: m.adjournment.motion + " " });
    }
    parts.push({ t: m.adjournment.text || "" });
    if (m.adjournment.ts) parts.push({ t: `  [${m.adjournment.ts}]`, i: true, s: 18 });
    out.push(BodyM(parts));
  }

  // SIGNATURES
  if (m.type === "successor_agency" || m.type === "housing_authority"
      || m.type === "public_financing_authority" || m.type === "utility_authority") {
    out.push(...SigBlock("Secretary", "Chair"));
  } else {
    out.push(...SigBlock("City Clerk", "Mayor"));
  }
  return out;
}

function buildDoc(title, children) {
  return new Document({
    creator: "City of Lynwood",
    title,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 },
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })]
          })]
        })
      },
      children
    }]
  });
}

function safeFilename(s) {
  return (s || "Meeting").replace(/[^a-z0-9 _.-]/gi, "").replace(/\s+/g, "_");
}

export async function buildAllMinutesDocs(data) {
  const out = [];
  const date = data.meeting_date || "";
  const dateSlug = date.replace(/[^0-9A-Za-z]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  for (const m of data.meetings || []) {
    const doc = buildDoc(`${m.title} – ${date} (DRAFT)`, renderMeeting(m, date));
    const blob = await Packer.toBlob(doc);
    const filename = `Lynwood_${safeFilename(m.title)}_${dateSlug}_DRAFT.docx`;
    out.push({ filename, blob });
  }
  return out;
}
