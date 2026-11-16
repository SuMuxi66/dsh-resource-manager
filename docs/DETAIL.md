# Resource manager

资源管理 / Resource manager is a DeepSeek Harness bundle with one Settings page
(**Settings → Resource manager**) that switches three kinds of capability on and
off, and one agent tool (`manage_resources`) that performs the same operations
from chat.

## What it manages

| Kind | Where the list comes from | What a switch does |
|---|---|---|
| MCP servers | Loader entries mounting `@deepseek-ai/dsh-mcp-client` or `@deepseek-ai/dsh-mcp-manager` | Enables or disables that Loader entry through the plugin manager, exactly like the Plugins page. The profile patch keeps the choice, and the server's tools are withdrawn when it stops. |
| Tools | Every globally registered tool (`ctx.tools.definitions()`) | A switched-off tool is denied by a deployment-wide guard and removed from each live agent's tool view with `tools.restrict()` on that agent's context, so the model stops seeing the schema and every call is refused. |
| Skills | Every discovered skill (`ctx.skills.list()`) | A switched-off skill is shadowed by a hidden runtime registration whose invocation policy forbids model and human invocation: it leaves the skill catalog, the `skill` tool refuses it, and `/name` gestures stop loading it. |

## How a change is applied and stored

- Tools and skills apply immediately and are stored in this bundle's own Loader
  row (`disabledTools`, `disabledSkills`) through the config editor, so they
  survive a restart and survive DSH upgrades because they live in the user's
  patch layer.
- MCP switches are stored by the plugin manager in the same layer.
- Because the row's config is ordinary config, saving new switch lists
  re-activates this plugin. The page answers the click first, then the write
  happens; the page re-reads state on its next refresh.

## Agent flow

```
manage_resources(action="list")
manage_resources(action="set", kind="tool", name="bash", enabled=false)
```

`manage_resources` itself cannot be switched off: it is how the agent reaches
everything else.

## Limitations

- **Skills defined by the current project win.** The runtime layer that hides a
  skill ranks below project-provided skills (`project-dsh` / `project-agents`),
  so such a skill still appears in a session whose workspace supplies it.
- **MCP rows are switched as Loader entries.** A server registered at runtime by
  another plugin (through `mcpManager.register()`) is owned by that plugin and
  cannot be switched here.
- **A switch covers the whole profile.** There is no per-session or per-agent
  variant; the tool restriction follows each agent, the guard and the skill
  shadow are deployment-wide.
- **The page needs a web server.** The client half reads and writes two
  same-origin routes served by the Host half; in a deployment without
  `ctx.webServer` the page reports that it cannot reach the service, while the
  agent tool keeps working.
