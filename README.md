# Slack Digest

A local Mac app that pulls recent Slack activity through Glean and presents it as a grouped, scannable digest.

## Prerequisites

- [Node.js 20+](https://nodejs.org) (for local dev)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) **or** [Colima](https://github.com/abiosoft/colima) (free Docker runtime for macOS) and Docker Compose (for containerized run)
- A Glean API token (see [Getting your Glean API token](#getting-your-glean-api-token))

## Running with Docker Compose

```bash
cd slack-digest
touch .env.local
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

## Running locally

```bash
cd slack-digest
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Getting your Glean API token

1. Open Glean in your browser
2. Go to **Settings → Your profile → API tokens**
3. Click **Create token**, give it a name (e.g. "Slack Digest")
4. Copy the token and paste it into the setup screen

The backend URL is pre-filled as `https://scio-prod-be.glean.com` — leave it as-is unless your Glean instance has a different URL.

## Usage

- Select a **time window** (24h / 3d / 7d) in the top bar
- Click **Refresh** to regenerate the digest
- Use **j/k** or **↑/↓** to navigate items within a group
- Press **Enter** to open the selected thread in Slack
- Press **Esc** to collapse the expanded item

## Digest groups

| Group | What's in it |
|---|---|
| 🔴 Needs Attention | Direct mentions, urgent asks, items needing a reply |
| ✅ Decisions Made | Threads where a conclusion was reached |
| 📋 Action Items | Tasks, next steps, commitments |
| 🤝 Partner Mentions | External partners, customers, vendors |
| ℹ️ FYI Updates | Announcements and info with no required action |
| 📺 Channel Summaries | Per-channel activity overview |
