# Minutes Generator

A small web app that takes a meeting transcript (`.txt`) and a short agenda
(`.pdf`), runs them through Anthropic's Claude API, and downloads three
draft Word documents (Closed Session, Regular Meeting, Successor Agency / etc.)
formatted to match the City Clerk's existing style.

## Architecture at a glance

```
┌─────────────────┐    HTTPS+JWT     ┌──────────────────────┐    HTTPS    ┌──────────────────┐
│  Browser (UI)   │  ───────────────▶│ Railway unction     │ ──────────▶ │ Anthropic API    │
│  - file uploads │   ←─── stream ───│  - verifies JWT      │ ◀── stream ─│  (Claude)        │
│  - JWT auth     │                  │  - email whitelist   │             └──────────────────┘
│  - builds .docx │                  │  - holds API KEY     │
└─────────────────┘                  └──────────────────────┘
