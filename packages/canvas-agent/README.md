# sig-dream Canvas Agent

Maintained MCP adapter used by sig-dream v0.3.3. It is based on the MIT-licensed `@basketikun/canvas-agent` 0.6.0 distribution; see [PROVENANCE.md](PROVENANCE.md) and [LICENSE](LICENSE). The maintained package adds bounded input validation and authenticated Streamable HTTP while preserving the stdio MCP tools.

## Start the local canvas service

Run from the sig-dream app's Agent connection panel, which provides the exact command and the service URL/Connect token. To start the service from an archive manually:

```sh
npx --yes --package ./sig-dream-canvas-agent-0.3.3.tgz -- canvas-agent
```

Keep it running on the canvas computer. It binds to loopback by default. Do not expose it directly on a public interface; use the app's access control and a TLS reverse proxy.

## Configure an MCP client

Clients using local stdio start the MCP transport as a separate process:

```sh
npx --yes --package ./sig-dream-canvas-agent-0.3.3.tgz -- canvas-agent mcp
```

The Agent panel generates a client-specific configuration and selects the matching runtime archive. Merge the provided entry into the client's existing MCP settings. For a remote MCP client, use the Streamable HTTP endpoint `<service-origin>/mcp` with `Authorization: Bearer <Connect token>` over HTTPS.

The token is intentionally not returned by unauthenticated discovery endpoints. Read it from the local service terminal and enter it in the canvas connection panel or the client's secure secret setting.

## Development

The shipped `dist/` directory is the maintained, editable JavaScript source for this fork. Run `npm run build:agent` from the repository root to create the versioned archive. `npm run test:agent:bridge` exercises stdio, HTTP, token validation, input bounds, and the packaged archive against an isolated test canvas.
