# Connecting agents to Captureze

One server, two transports:

- **Streamable HTTP** (`POST /mcp`) — the client calls a URL and sends its own
  `Authorization: Bearer cap_...` per request. Use it for hosted clients (ChatGPT, claude.ai,
  server-side agents). **We run this for you at `https://mcp.captureze.com/mcp`** — nothing to
  install, nothing to deploy.
- **stdio** — the client starts the process; the API key comes from `CAPTUREZE_API_KEY`.
  Use it for agents running on the user's machine.

Run the HTTP transport yourself only if you point at a self-hosted Captureze install, or want the
endpoint inside your own network — see [Self-hosting the HTTP transport](#self-hosting-the-http-transport).

Protocol note: the server is built on `@modelcontextprotocol/sdk` 1.30.x, which negotiates
`2025-11-25` and accepts older revisions down to `2024-11-05`. The HTTP transport already runs
stateless — no session id, no sticky routing — which is the shape the 2026-07-28 revision of the
spec standardises, so moving to it is an SDK bump rather than a rewrite.

---

## Claude Code

```bash
claude mcp add captureze --env CAPTUREZE_API_KEY=cap_xxx -- npx -y @captureze/mcp
```

Remote instead — no local install, no Node:

```bash
claude mcp add --transport http captureze https://mcp.captureze.com/mcp \
  --header "Authorization: Bearer cap_xxx"
```

## Claude Desktop

`claude_desktop_config.json`:

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

## claude.ai (remote connector)

Add a custom connector pointing at:

```
https://mcp.captureze.com/mcp
```

**Caveat, checked 6 September 2026:** claude.ai's _Add custom connector_ dialog takes the URL and,
under **Advanced settings**, an OAuth Client ID and Client Secret — there is no field for a bearer
token or an arbitrary header
([anthropics/claude-ai-mcp#112](https://github.com/anthropics/claude-ai-mcp/issues/112) is open on
exactly this). This endpoint authenticates with `Authorization: Bearer cap_...` and does not
implement OAuth yet, so the connector cannot currently authenticate itself from the claude.ai web
UI.

Until either side changes, connect from Claude Code instead — its remote transport does pass the
header:

```bash
claude mcp add -s user --transport http captureze https://mcp.captureze.com/mcp \
  --header "Authorization: Bearer cap_xxx"
```

Claude Desktop and other clients that accept a `headers` block in their MCP config can point at
the same URL.

## ChatGPT (developer mode / deep research connector)

ChatGPT connects only to **remote** MCP servers — no stdio — and, in deep research, only calls
two tools: `search` and `fetch`. This server ships both, backed by the same account data as the
`captureze_*` tools, so it registers cleanly:

1. In ChatGPT: **Settings → Apps → Advanced settings → Developer mode**.
2. Add a custom connector with the URL `https://mcp.captureze.com/mcp`.
3. Set the API key as an `Authorization: Bearer cap_...` header.

Custom connectors are available on Pro, Plus, Business, Enterprise and Edu plans; on managed
workspaces an admin has to permit them first.

In developer mode the full `captureze_*` tool set is callable. In deep research only
`search`/`fetch` are, which is why they exist:

- `search("example.com")` → monitored pages and recent captures, as `{id, title, text, url}`
- `fetch("site:<uuid>")` / `fetch("capture:<site-uuid>:<capture-uuid>")` → the full record

## OpenClaw

`~/.openclaw/openclaw.json`:

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

Restart the gateway afterwards. OpenClaw's MCP client handles discovery and argument validation,
so no per-integration code is needed on its side. It also speaks HTTP/SSE if you would rather
point it at a deployed instance.

## Hermes and other OpenAI-compatible agent loops

Agents that are model + loop rather than a packaged client (Hermes-family models, custom
ReAct/tool-calling loops) connect through an MCP **client** library and hand the discovered tools
to the model as function definitions:

```python
# python: pip install mcp
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(
    command="npx", args=["-y", "@captureze/mcp"],
    env={"CAPTUREZE_API_KEY": "cap_xxx"},
)

async with stdio_client(params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools          # -> function definitions
        result = await session.call_tool(
            "captureze_capture_url", {"url": "https://example.com"}
        )
```

The same code against a deployment: swap `stdio_client` for the streamable HTTP client and pass
`Authorization: Bearer cap_...`. Frameworks with built-in MCP support (OpenAI Agents SDK,
Claude Agent SDK, LangGraph, Mastra, PydanticAI) take the server config directly.

`captureze_capture_url` returns the screenshot as an image content block, so a vision-capable
model can read the page; models without vision should pass `include_image: false` and work from
`image_url` and `diff_percent`.

---

## Self-hosting the HTTP transport

Only needed for a self-hosted Captureze install or an endpoint inside your own network —
`https://mcp.captureze.com/mcp` is already running against captureze.com.

```bash
docker run -d --name captureze-mcp -p 8787:8787 \
  -e HOST=0.0.0.0 \
  -e CAPTUREZE_MCP_ALLOWED_HOSTS=mcp.example.com \
  ghcr.io/captureze/mcp:latest --http
```

Images are published to `ghcr.io/captureze/mcp`: `:latest` and an immutable `:main-<short-sha>`
from `main`, plus `:<version>` on each `v*` release tag. Pin an immutable tag in production.

- Terminate TLS in front of it; MCP clients require HTTPS.
- Keep `CAPTUREZE_MCP_ALLOWED_HOSTS` set to the public hostname — it blocks DNS-rebinding.
- Do **not** set `CAPTUREZE_API_KEY` on a multi-tenant deployment: it becomes the fallback
  identity for any request that arrives without a key.
- `GET /healthz` for liveness. `GET`/`DELETE /mcp` answer 405 by design: stateless servers keep
  no stream to resume.
- Captures take 10–60s. Give proxies and load balancers a request timeout above
  `CAPTUREZE_TIMEOUT_MS` (default 180s), or clients will see truncated responses for work that
  did in fact complete.

## Errors an agent will meet

| Status | Meaning                                                                                                  | What the agent should do                     |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 401    | Key missing or invalid                                                                                   | Stop; ask the user for a valid `cap_...` key |
| 402    | Plan limit or gated feature (`SCHEDULE_LIMIT`, `SCREENSHOT_LIMIT`, `INTERVAL_LIMIT`, `FEATURE_REQUIRED`) | Report what needs upgrading — never retry    |
| 429    | Rate limited (global, or 20 consent detections/day)                                                      | Back off                                     |
| 5xx    | Capture or upstream failure                                                                              | Retry once, then report                      |

Every one comes back as a tool error whose text already carries this guidance.
