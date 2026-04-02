# Captureze MCP Server

Model Context Protocol (MCP) server that connects AI assistants to the [Captureze](https://captureze.com) screenshot and visual-monitoring API.

## Features

- **Take screenshots** – capture any URL as PNG, JPEG, WebP, or PDF
- **List & retrieve captures** – browse recent captures with pagination
- **Manage monitors** – create, list, and delete visual-change monitors
- **Account info** – view plan details and API usage

## Prerequisites

- **Node.js** ≥ 18
- A [Captureze](https://captureze.com) account with an API key

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and fill in your API key:

```bash
cp .env.example .env
```

```dotenv
CAPTUREZE_API_KEY=your_api_key_here
```

## MCP Server Setup

Add the server to your MCP client configuration (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "captureze": {
      "command": "node",
      "args": ["/path/to/mcp/dist/index.js"],
      "env": {
        "CAPTUREZE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `create_capture` | Take a screenshot of a URL |
| `list_captures` | List recent captures (paginated) |
| `get_capture` | Get details of a specific capture |
| `list_monitors` | List all visual-change monitors (paginated) |
| `get_monitor` | Get details of a specific monitor |
| `create_monitor` | Create a new visual-change monitor |
| `delete_monitor` | Delete a monitor |
| `get_account` | View account info and API usage |

## CLI Usage

You can also use the CLI directly:

```bash
# Take a screenshot
npm run dev:cli -- create-capture --url https://example.com

# List captures
npm run dev:cli -- list-captures --limit 10

# Get a capture
npm run dev:cli -- get-capture --id cap_123

# List monitors
npm run dev:cli -- list-monitors

# Create a monitor
npm run dev:cli -- create-monitor --name "My Site" --url https://example.com --interval daily

# Delete a monitor
npm run dev:cli -- delete-monitor --id mon_456

# Account info
npm run dev:cli -- get-account
```

## Development

```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Run tests
npm test

# Build
npm run build
```

## Project Structure

```
src/
├── cli/              # CLI command definitions
├── controllers/      # Business logic layer
├── services/         # Captureze API client and service functions
├── tools/            # MCP tool definitions (registered with the server)
├── types/            # TypeScript type definitions
├── utils/            # Shared utilities (logger, error handler, formatter)
├── __tests__/        # Unit tests
└── index.ts          # MCP server entry point
```

## License

ISC
