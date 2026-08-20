# Captureze MCP server

Model Context Protocol server for [Captureze](https://captureze.com) — scheduled website
screenshots, visual diffs and Certificates of Capture, exposed as tools an AI agent can call.

With it connected, an agent can:

- screenshot any URL and **look at the image** (proxy-backed, so bot-protected and geo-restricted pages work);
- keep a page under watch on a cron and report **what changed and by how much**;
- pull a **Certificate of Capture** (SHA-256, timestamp, capture origin, verification URL) for evidence work;
- detect a site's **cookie consent banner** and its accept/reject selectors.

Works with any MCP client: Claude Code, Claude Desktop, claude.ai, ChatGPT (developer mode /
deep research connectors), OpenClaw, and anything built on the MCP SDKs or an agent framework
with MCP support.

## Requirements

- Node.js 20+
- A Captureze API key (`cap_...`) — Captureze console → **Settings → API keys**

## Quick start

```bash
# stdio (local agents)
CAPTUREZE_API_KEY=cap_xxx npx -y @captureze/mcp

# streamable HTTP (remote connectors)
CAPTUREZE_API_KEY=cap_xxx npx -y @captureze/mcp --http --port 8787
```

## Connect it

### Claude Code

```bash
claude mcp add captureze --env CAPTUREZE_API_KEY=cap_xxx -- npx -y @captureze/mcp
```

### Claude Desktop / any stdio client

```json
{
  "mcpServers": {
    "captureze": {
      "command": "npx",
      "args": ["-y", "@captureze/mcp"],
      "env": { "CAPTUREZE_API_KEY": "cap_xxx" }
    }
  }
}
```

### ChatGPT (custom connector, developer mode)

ChatGPT only talks to **remote** servers, so run the HTTP transport behind HTTPS and register
`https://your-host/mcp`. The server ships the `search` and `fetch` tools ChatGPT requires
alongside the `captureze_*` ones. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

### OpenClaw

```json
{
  "mcpServers": {
    "captureze": {
      "command": "npx",
      "args": ["-y", "@captureze/mcp"],
      "env": { "CAPTUREZE_API_KEY": "cap_xxx" }
    }
  }
}
```

Hermes-based and other OpenAI-compatible agent loops connect through their MCP client layer —
stdio locally, `https://your-host/mcp` remotely. Details for each in
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Tools

| Tool                                                                  | What it does                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `captureze_capture_url`                                               | Screenshot a URL now; returns the image and the change vs the previous capture |
| `captureze_capture_site`                                              | Capture an existing site with its stored settings                              |
| `captureze_list_sites` / `captureze_get_site`                         | What the account monitors                                                      |
| `captureze_monitor_site`                                              | Start capturing a page on a cron                                               |
| `captureze_update_site` / `captureze_delete_site`                     | Change or remove a site (delete is destructive)                                |
| `captureze_list_captures`                                             | Capture history with per-capture change percentages                            |
| `captureze_get_capture_image`                                         | Look at a stored capture, or its diff overlay                                  |
| `captureze_list_capture_runs`                                         | Execution log — why a scheduled capture failed                                 |
| `captureze_compare_captures`                                          | Pixel-diff any two captures (Pro)                                              |
| `captureze_diff_trend`                                                | How much a page has been moving (Pro)                                          |
| `captureze_get_capture_certificate`                                   | Certificate of Capture for evidence (Starter+)                                 |
| `captureze_detect_consent_banner` / `captureze_get_consent_detection` | Find the cookie banner and its selectors                                       |
| `captureze_account_status`                                            | Plan, entitlements, usage against limits                                       |
| `search` / `fetch`                                                    | ChatGPT-compatible views over the same data                                    |

Resources: `captureze://sites`, `captureze://viewport-presets`.
Prompts: `watch-page`, `evidence-pack`, `consent-audit`.

### How ad-hoc captures are stored

Every capture belongs to a _site_, which is what gives it history, diffs and certificates. So
`captureze_capture_url` files its capture under a site for that URL: an existing one if the
account already has it, otherwise a new one created **paused** (`is_active: false`), which
captures on request and never on its own. Pass `monitor: true` to have it run on a schedule too.

## CLI

The same tools are reachable by hand, which is the quickest way to tell "the agent asked for the
wrong thing" apart from "the API misbehaved":

```bash
export CAPTUREZE_API_KEY=cap_xxx        # or put it in a .env file

captureze-mcp sites                     # what the account monitors
captureze-mcp capture https://example.com --full-page --out shot.png
captureze-mcp captures <site-id>        # history with change percentages
captureze-mcp compare <capture-id> <capture-id>
captureze-mcp account                   # plan, entitlements, usage
captureze-mcp --help                    # every command
```

Output is JSON on stdout. With no command the same binary starts the MCP server, so existing
client configs are unaffected.

## Configuration

| Variable                           | Default                 | Meaning                                                                                       |
| ---------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `CAPTUREZE_API_KEY`                | —                       | API key. Required for stdio; the fallback for HTTP requests without an `Authorization` header |
| `CAPTUREZE_BASE_URL`               | `https://captureze.com` | Captureze install (self-hosted or staging)                                                    |
| `CAPTUREZE_TIMEOUT_MS`             | `180000`                | Upstream timeout — captures run a real browser and are slow                                   |
| `CAPTUREZE_MAX_INLINE_IMAGE_BYTES` | `4500000`               | Above this, tools return a URL instead of inlining the image                                  |
| `PORT` / `HOST`                    | `8787` / `127.0.0.1`    | HTTP transport bind                                                                           |
| `CAPTUREZE_MCP_ALLOWED_HOSTS`      | —                       | `Host` header allowlist when binding beyond localhost                                         |

A `.env` file in the working directory is loaded on startup.

## Running the HTTP transport

```bash
docker build -t captureze-mcp .
docker run --rm -p 8787:8787 -e HOST=0.0.0.0 \
  -e CAPTUREZE_MCP_ALLOWED_HOSTS=mcp.example.com captureze-mcp --http
```

The HTTP transport is **stateless and multi-tenant**: each request carries its own
`Authorization: Bearer cap_...`, a fresh server instance handles it, and nothing about one
caller survives into the next request. Any instance can answer any request, so it scales behind
an ordinary load balancer with no sticky sessions.

Terminate TLS in front of it, keep `CAPTUREZE_MCP_ALLOWED_HOSTS` set to the public hostname, and
do not set `CAPTUREZE_API_KEY` on a shared deployment — that key would become the fallback for
every unauthenticated request.

## Development

```bash
npm install
npm test            # node:test, no network
npm run lint
npm run format      # prettier --write
npm run typecheck
npm run build
```

## License

MIT
