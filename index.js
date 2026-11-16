/**
 * Resource manager — Host half.
 *
 * One Host plugin owns the whole capability so the Settings page and the agent
 * tool execute the same code:
 *
 *   - MCP servers: Loader entries that mount an MCP client/manager are switched
 *     through the plugin manager, exactly like the Plugins page does, so the
 *     choice persists in the profile patch layer.
 *   - Tools: a disabled tool is denied by a deployment-wide guard (no agent can
 *     execute it) and removed from each agent's own tool view with
 *     `tools.restrict()` on that agent's context, so the model stops seeing the
 *     schema too. Listing and restriction both walk the live agents' views, not
 *     only the global layer, because a preset registers its tools in its own
 *     layer.
 *   - Skills: a disabled skill is shadowed by runtime registrations whose
 *     invocation policy forbids model and human invocation — one in the global
 *     layer and one in each live agent's layer, because the nearer layer wins a
 *     duplicate name. The catalog, the `skill` tool, and `/name` gestures then
 *     stop offering it.
 *
 * The browser page talks to this file over two same-origin HTTP routes rather
 * than a generated Remote namespace: this bundle ships no build step, so routes
 * are the transport a hand-written Client half can use.
 *
 * @module dsh-resource-manager
 */

export const name = 'resource-manager'

/** Tools and agents are required; every other service is read optionally. */
export const inject = ['tools']

/** Route prefix served by the Host for the Settings page. */
const ROUTE_PREFIX = '/resource-manager'

/** Loader modules whose entries count as MCP servers. */
const MCP_MODULES = new Set(['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-mcp-manager'])

/** The agent-facing tool this bundle registers. */
const MANAGED_TOOL = 'manage_resources'

/** The shipped tool that loads a skill body on demand. */
const SKILL_TOOL = 'skill'

/** Provider label this bundle uses for its skill shadows. */
const SHADOW_PROVIDER = 'resource-manager'

/** Description carried by a skill shadow. */
const SHADOW_DESCRIPTION = 'Switched off in Settings > Resource manager.'

/** Kebab-case skill name grammar accepted by the skill registry. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Trimmed string, or the empty string for anything else. */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Normalize a persisted name list into unique non-empty trimmed strings. */
function cleanList(value) {
  const unique = new Set()
  if (!Array.isArray(value)) return []
  for (const item of value) {
    const entry = text(item)
    if (entry !== '') unique.add(entry)
  }
  return [...unique]
}

/** Readable message for an arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** JSON response helper for the Settings page routes. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Guard denial shape for one disabled resource. */
function denial(reason, code) {
  return { reason, info: { name: 'resource-manager', code } }
}

/** Localized title from entry metadata, or undefined. */
function metaTitle(meta) {
  if (meta === null || typeof meta !== 'object') return undefined
  const title = meta.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  if (title === null || typeof title !== 'object') return undefined
  try {
    const english = text(title.en)
    if (english !== '') return english
    for (const value of Object.values(title)) {
      const entry = text(value)
      if (entry !== '') return entry
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Read a JSON request body without trusting its shape. */
async function readJson(request) {
  try {
    const body = await request.json()
    return body !== null && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

/**
 * Apply the resource manager.
 * @param ctx - the plugin context.
 * @param config - the row's config, holding the persisted switch lists.
 */
export function apply(ctx, config = {}) {
  const disabledTools = new Set(cleanList(config.disabledTools))
  const disabledSkills = new Set(cleanList(config.disabledSkills))

  /** Per-agent restriction disposers, keyed by agent id. */
  const restrictions = new Map()
  /** Tool names each agent has exposed, so a restriction stays aligned after it hides one. */
  const seenTools = new Map()
  /** Per-agent skill shadow disposers, keyed by agent id. */
  const agentShadows = new Map()
  /** Global-layer skill shadow disposers. */
  const globalShadows = []
  /** Pending debounced config write. */
  let persistTimer
  let persistPending = false
  let disposed = false

  function log(level, message) {
    try {
      ctx.logger?.[level]?.(message)
    } catch {
      // Logging must never break a switch operation.
    }
  }

  /** Live agents known to the Host, if the registry is composed. */
  function liveAgents() {
    try {
      return ctx.get('agents')?.list?.() ?? []
    } catch {
      return []
    }
  }

  /** Tool definitions visible to one scope; an omitted scope reads the global view. */
  function definitionsOf(scope) {
    try {
      return ctx.tools.definitions(scope)
    } catch {
      return []
    }
  }

  /** The tools service for one context, read without the inject requirement. */
  function toolsOf(scopeCtx) {
    try {
      return scopeCtx.get('tools')
    } catch {
      return undefined
    }
  }

  /** Skill summaries for one scope; an omitted scope reads the global layer alone. */
  async function skillsOf(scope) {
    const skills = ctx.get('skills')
    if (skills === undefined) return []
    try {
      return await skills.list(scope === undefined ? {} : { scope })
    } catch (error) {
      log('warn', `resource-manager: reading a skill catalog failed: ${messageOf(error)}`)
      return []
    }
  }

  // ---------------------------------------------------------------- tools ---

  /**
   * Re-align one agent's restriction with the current disabled set. A previous
   * restriction is lifted first so `restrict()` never accumulates stale masks.
   */
  function syncRestriction(agent) {
    const previous = restrictions.get(agent.id)
    if (previous !== undefined) {
      restrictions.delete(agent.id)
      try {
        previous()
      } catch (error) {
        log('warn', `resource-manager: lifting a stale tool restriction failed: ${messageOf(error)}`)
      }
    }
    if (disposed || disabledTools.size === 0) return
    // Remember every tool this agent has exposed: once a restriction hides one,
    // the view no longer reports it, and the deny list must survive that.
    const seen = seenTools.get(agent.id) ?? new Set()
    for (const definition of definitionsOf(agent)) seen.add(definition.name)
    seenTools.set(agent.id, seen)
    for (const definition of definitionsOf(undefined)) seen.add(definition.name)
    const deny = [...disabledTools].filter(entry => entry !== MANAGED_TOOL && seen.has(entry))
    if (deny.length === 0) return
    const tools = toolsOf(agent.ctx)
    if (tools === undefined || typeof tools.restrict !== 'function') return
    try {
      restrictions.set(agent.id, tools.restrict({ deny }))
      return
    } catch {
      // A name the agent's own layer registered cannot be restricted; apply the
      // rest one by one so one such name cannot drop the whole mask.
    }
    const granted = []
    for (const name of deny) {
      try {
        granted.push(tools.restrict({ deny: [name] }))
      } catch {
        // Not restrictable from this scope; the guard still refuses a call.
      }
    }
    if (granted.length > 0) {
      restrictions.set(agent.id, () => {
        for (const dispose of granted) {
          try {
            dispose()
          } catch {
            // The agent context may already be disposed.
          }
        }
      })
    }
  }

  /** Re-align every live agent. */
  function syncAllAgents() {
    if (disposed) return
    for (const agent of liveAgents()) syncRestriction(agent)
  }

  // A denial that holds for every caller, whatever its scope or registration
  // order. It also carries the `skill` tool case, where the resource is one
  // argument of a tool that stays enabled.
  ctx.effect(() => ctx.tools.guard((execution) => {
    const toolName = execution.name
    if (disabledTools.has(toolName)) {
      return denial(
        `Tool "${toolName}" is switched off in the resource manager. Enable it in Settings > Resource manager before calling it.`,
        'tool-disabled',
      )
    }
    if (toolName === SKILL_TOOL) {
      const args = execution.arguments
      const target = args !== null && typeof args === 'object' ? text(args.name) : ''
      if (target !== '' && disabledSkills.has(target)) {
        return denial(
          `Skill "${target}" is switched off in the resource manager. Enable it in Settings > Resource manager before loading it.`,
          'skill-disabled',
        )
      }
    }
    return undefined
  }), 'resource-manager: disabled-resource guard')

  // --------------------------------------------------------------- skills ---

  /** One hidden runtime registration that makes a skill unavailable. */
  function registerShadow(scopeCtx, skillName) {
    const skills = scopeCtx.get('skills')
    if (skills === undefined || typeof skills.register !== 'function') return undefined
    try {
      return skills.register({
        name: skillName,
        description: SHADOW_DESCRIPTION,
        content: '',
        source: 'runtime',
        provider: SHADOW_PROVIDER,
        invocation: { modelInvocable: false, userInvocable: false },
      })
    } catch (error) {
      log('warn', `resource-manager: cannot hide skill "${skillName}" in its layer: ${messageOf(error)}`)
      return undefined
    }
  }

  /** Replace every shadow so the hidden set matches the disabled set exactly. */
  function syncSkillShadows() {
    for (const dispose of globalShadows.splice(0)) {
      try {
        dispose()
      } catch {
        // The registry may already be gone.
      }
    }
    for (const disposers of agentShadows.values()) {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // The agent context may already be disposed.
        }
      }
    }
    agentShadows.clear()
    if (disposed || disabledSkills.size === 0) return
    const names = [...disabledSkills].filter(skillName => SKILL_NAME.test(skillName))
    for (const skillName of disabledSkills) {
      if (!SKILL_NAME.test(skillName)) log('warn', `resource-manager: "${skillName}" is not a valid skill name and was skipped`)
    }
    // Global layer first: it covers bundled and user-provided skills.
    for (const skillName of names) {
      const dispose = registerShadow(ctx, skillName)
      if (dispose !== undefined) globalShadows.push(dispose)
    }
    // Then each live agent's own layer, which outranks the preset that supplied
    // the skill — the nearer layer wins a duplicate name outright.
    for (const agent of liveAgents()) syncAgentShadows(agent, names)
  }

  /** Register the per-agent shadows for one agent. */
  function syncAgentShadows(agent, names) {
    if (disposed) return
    const target = names ?? [...disabledSkills].filter(skillName => SKILL_NAME.test(skillName))
    const existing = agentShadows.get(agent.id)
    if (existing !== undefined) {
      for (const dispose of existing) {
        try {
          dispose()
        } catch {
          // The agent context may already be disposed.
        }
      }
      agentShadows.delete(agent.id)
    }
    if (target.length === 0) return
    const disposers = []
    for (const skillName of target) {
      const dispose = registerShadow(agent.ctx, skillName)
      if (dispose !== undefined) disposers.push(dispose)
    }
    if (disposers.length > 0) agentShadows.set(agent.id, disposers)
  }

  // ----------------------------------------------------------- state reads ---

  /** MCP servers as Loader entries, read through the plugin manager. */
  async function listMcpServers() {
    const pluginManager = ctx.get('pluginManager')
    if (pluginManager === undefined) return []
    let plugins
    try {
      plugins = await pluginManager.listPlugins()
    } catch (error) {
      log('warn', `resource-manager: reading plugin rows failed: ${messageOf(error)}`)
      return []
    }
    const rows = []
    for (const plugin of Array.isArray(plugins) ? plugins : []) {
      const moduleName = text(plugin?.moduleName)
      if (!MCP_MODULES.has(moduleName)) continue
      // The row id is the stable, distinguishing name; the localized plugin
      // title is the same for every MCP client row, so it only labels the row.
      const rowId = text(plugin?.patchId) || text(plugin?.entryId)
      if (rowId === '') continue
      rows.push({
        id: text(plugin?.entryId) || rowId,
        name: rowId,
        label: metaTitle(plugin?.meta) ?? '',
        moduleName,
        enabled: plugin?.enabled === true,
        phase: text(plugin?.fiberPhase) || null,
      })
    }
    rows.sort((left, right) => left.name.localeCompare(right.name))
    return rows
  }

  /** Every tool visible to the global view or to a live agent, plus disabled names. */
  function listTools() {
    const rows = new Map()
    const record = (definition) => {
      const name = text(definition?.name)
      if (name === '' || rows.has(name)) return
      rows.set(name, {
        name,
        description: text(definition?.description),
        enabled: !disabledTools.has(name),
        locked: name === MANAGED_TOOL,
      })
    }
    for (const definition of definitionsOf(undefined)) record(definition)
    for (const agent of liveAgents()) {
      for (const definition of definitionsOf(agent)) record(definition)
      for (const name of seenTools.get(agent.id) ?? []) record({ name })
    }
    for (const name of disabledTools) record({ name })
    return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Every skill visible to the global layer or to a live agent, plus disabled names. */
  async function listSkills() {
    const rows = new Map()
    const record = (summary) => {
      const name = text(summary?.name)
      if (name === '') return
      const provider = text(summary?.provider)
      const existing = rows.get(name)
      // Prefer the real definition over this bundle's own shadow so a row keeps
      // describing the skill rather than the switch.
      if (existing !== undefined && existing.shadow !== true) return
      rows.set(name, {
        name,
        description: text(summary?.description),
        source: text(summary?.source),
        provider,
        shadow: provider === SHADOW_PROVIDER,
        enabled: !disabledSkills.has(name),
      })
    }
    const catalogs = await Promise.all([
      skillsOf(undefined),
      ...liveAgents().map(agent => skillsOf(agent)),
    ])
    for (const catalog of catalogs) {
      for (const summary of Array.isArray(catalog) ? catalog : []) record(summary)
    }
    for (const name of disabledSkills) record({ name, provider: SHADOW_PROVIDER })
    return [...rows.values()]
      .map(({ shadow, ...row }) => row)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** The complete page payload. */
  async function fullState() {
    const [mcp, skills] = await Promise.all([listMcpServers(), listSkills()])
    return {
      ok: true,
      mcp,
      tools: listTools(),
      skills,
      disabled: {
        tools: [...disabledTools].sort(),
        skills: [...disabledSkills].sort(),
      },
    }
  }

  // -------------------------------------------------------------- mutation ---

  /** Persist both switch lists into this row's config through the editor. */
  async function persist() {
    persistPending = false
    const entry = ctx.fiber?.entry
    const editor = ctx.get('configEditor')
    if (entry === undefined || editor === undefined) {
      throw new Error('the config editor is not mounted in this deployment, so the switch lasts only until the Host restarts')
    }
    await editor.edit(entry, current => ({
      ...current,
      disabledTools: [...disabledTools].sort(),
      disabledSkills: [...disabledSkills].sort(),
    }))
  }

  /**
   * Write the lists back to the profile after a short debounce. The write
   * re-activates this plugin (ordinary config fields rebuild the fiber), so the
   * page answers first and the fresh state is read after that restart.
   */
  function schedulePersist() {
    persistPending = true
    if (persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      if (disposed || !persistPending) return
      void persist().catch((error) => {
        log('warn', `resource-manager: saving the disabled lists failed: ${messageOf(error)}`)
      })
    }, 150)
    if (typeof persistTimer?.unref === 'function') persistTimer.unref()
  }

  /**
   * Switch one resource on or off.
   * @param kind - `mcp`, `tool`, or `skill`.
   * @param rawName - entry id (MCP), tool name, or skill name.
   * @param enabled - whether the resource should be usable.
   * @returns the outcome of the change.
   */
  async function setEnabled(kind, rawName, enabled) {
    const target = text(rawName)
    if (target === '') throw new Error('a resource name is required')
    if (kind === 'tool') {
      if (target === MANAGED_TOOL) {
        throw new Error(`"${MANAGED_TOOL}" cannot be switched off: it is how the agent lists and switches everything else`)
      }
      if (enabled) disabledTools.delete(target)
      else disabledTools.add(target)
      syncAllAgents()
      schedulePersist()
      return { changed: true, application: 'applied' }
    }
    if (kind === 'skill') {
      if (!SKILL_NAME.test(target)) throw new Error(`"${target}" is not a valid skill name`)
      if (enabled) disabledSkills.delete(target)
      else disabledSkills.add(target)
      syncSkillShadows()
      schedulePersist()
      return { changed: true, application: 'applied' }
    }
    if (kind === 'mcp') {
      const pluginManager = ctx.get('pluginManager')
      if (pluginManager === undefined) throw new Error('the plugin manager service is not mounted in this deployment')
      const result = await pluginManager.setPluginEnabled(target, enabled === true)
      return {
        changed: result?.changed === true,
        application: text(result?.application) || 'unknown',
        diagnostic: result?.error === undefined
          ? undefined
          : [text(result.error.code), text(result.error.diagnostic)].filter(entry => entry !== '').join(': '),
      }
    }
    throw new Error(`unknown resource kind "${kind}"`)
  }

  // -------------------------------------------------------------- the page ---

  /** Serve the Settings page: state reads plus switch writes. */
  async function handleResource(request, peer) {
    try {
      const principalKind = peer === undefined ? 'owner' : peer?.principal?.kind
      if (principalKind !== 'owner') return jsonResponse({ ok: false, error: 'forbidden' }, 403)
      const url = new URL(request.url)
      const action = text(url.searchParams.get('action'))
      if (request.method === 'POST' || action === 'toggle') {
        const payload = request.method === 'POST'
          ? await readJson(request)
          : Object.fromEntries(url.searchParams)
        const rawEnabled = payload.enabled
        const enabled = rawEnabled === true || rawEnabled === 'true' || rawEnabled === '1'
        const result = await setEnabled(text(payload.kind), payload.name, enabled)
        const state = await fullState()
        return jsonResponse({ ...state, result })
      }
      return jsonResponse(await fullState())
    } catch (error) {
      return jsonResponse({ ok: false, error: messageOf(error) }, 500)
    }
  }

  // The route must wait for the carrier instead of reading it once: this Host
  // half may mount before the `web-runtime` row provides `webServer`, and a
  // one-shot `ctx.get('webServer')` would then silently register nothing and
  // leave the Settings page fetching a 404 for the rest of the process.
  ctx.inject(['webServer'], (injected) => {
    injected.effect(() => injected.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      resource: handleResource,
    }), 'resource-manager: settings page routes')
  })

  // ------------------------------------------------------------- agent tool ---

  /** Render a state payload as compact plain text for a tool result. */
  function renderState(state) {
    const line = (row, extra) => `- ${row.name}${row.enabled ? ' [on]' : ' [off]'}${extra === undefined || extra === '' ? '' : ` — ${extra}`}`
    const blocks = [
      `MCP servers (${state.mcp.length}):`,
      ...(state.mcp.length === 0
        ? ['- none configured']
        : state.mcp.map(row => line(row, [row.moduleName, row.label].filter(entry => entry !== '').join(' ')))),
      '',
      `Tools (${state.tools.length}):`,
      ...(state.tools.length === 0
        ? ['- none registered']
        : state.tools.map(row => line(row, row.locked ? 'locked' : undefined))),
      '',
      `Skills (${state.skills.length}):`,
      ...(state.skills.length === 0
        ? ['- none discovered']
        : state.skills.map(row => line(row, [row.source, row.provider].filter(entry => entry !== '').join(' ')))),
    ]
    return blocks.join('\n')
  }

  ctx.tools.register({
    name: MANAGED_TOOL,
    description: 'List and switch MCP servers, agent tools, and skills on or off for this deployment. '
      + 'Call it with action "list" first to read the exact names, then with action "set", kind (mcp|tool|skill), '
      + 'name, and enabled. A disabled tool leaves the model tool list and cannot be executed; a disabled skill '
      + 'leaves the skill catalog and cannot be loaded; a disabled MCP server stops and its tools are withdrawn.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'list: read MCP servers, tools, and skills with their current state. set: switch one resource on or off.',
      },
      kind: {
        type: 'string',
        description: 'For set: mcp, tool, or skill.',
      },
      name: {
        type: 'string',
        description: 'For set: the exact MCP row id, tool name, or skill name reported by list.',
      },
      enabled: {
        type: 'boolean',
        description: 'For set: true to switch the resource on, false to switch it off.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          text: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value !== null && typeof value === 'object' && typeof value.text === 'string'
          ? value.text
          : JSON.stringify(value),
      }],
    },
    async execute(args) {
      const action = text(args.action)
      if (action === 'list' || action === 'status') {
        return { text: renderState(await fullState()) }
      }
      if (action === 'set') {
        const kind = text(args.kind)
        const name = text(args.name)
        const enabled = args.enabled === true
        const result = await setEnabled(kind, name, enabled)
        const state = await fullState()
        const headline = result.diagnostic === undefined
          ? `${kind} "${name}" switched ${enabled ? 'on' : 'off'} (${result.application}).`
          : `${kind} "${name}" was not switched: ${result.diagnostic}.`
        return { text: `${headline}\n\n${renderState(state)}` }
      }
      throw new Error('action must be "list" or "set"')
    },
  })

  // ------------------------------------------------------------- lifecycle ---

  syncSkillShadows()
  syncAllAgents()

  ctx.on('agent/created', ({ agent }) => {
    syncRestriction(agent)
    syncAgentShadows(agent)
  })

  ctx.on('tools/change', () => {
    syncAllAgents()
  })

  ctx.effect(() => () => {
    disposed = true
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    for (const dispose of restrictions.values()) {
      try {
        dispose()
      } catch {
        // A disposed agent context may already be gone.
      }
    }
    restrictions.clear()
    seenTools.clear()
    for (const dispose of globalShadows.splice(0)) {
      try {
        dispose()
      } catch {
        // The skill registry may already be disposed.
      }
    }
    for (const disposers of agentShadows.values()) {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // A disposed agent context may already be gone.
        }
      }
    }
    agentShadows.clear()
  }, 'resource-manager: lifetime')
}
