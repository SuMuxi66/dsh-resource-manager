/**
 * Resource manager — Client half.
 *
 * Registers one page in the Settings panel (`settings.section`) that lists MCP
 * servers, agent tools, and skills and switches each of them on or off. The
 * page reads and writes through the two same-origin routes its own Host half
 * serves (`/resource-manager/state`, `/resource-manager/toggle`), so the page
 * and the agent tool share one implementation.
 *
 * The module is a hand-written bundle client artifact: it registers a lazy
 * factory, requires only the browser React table, and contributes through
 * slots. Styling uses host theme tokens and lives in a component-local <style>
 * element so unmounting removes it.
 */

window.__ModuleLoader__.load({
  id: 'dsh-resource-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Route prefix served by this package's Host half. */
    const ROUTE = '/resource-manager'

    const EN = {
      nav: 'Resource manager',
      title: 'Resource manager',
      subtitle: 'Switch MCP servers, agent tools, and skills on or off. Changes apply to every session in this profile.',
      tabMcp: 'MCP servers',
      tabTools: 'Tools',
      tabSkills: 'Skills',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      searchTool: 'Filter tools',
      searchSkills: 'Filter skills',
      searchMcp: 'Filter servers',
      emptyMcp: 'No MCP server is mounted in this profile.',
      emptyTools: 'No tool is registered.',
      emptySkills: 'No skill was discovered.',
      emptyFiltered: 'Nothing matches this filter.',
      loading: 'Reading the current state…',
      unavailable: 'The resource manager Host service is not reachable.',
      retry: 'Retry',
      on: 'On',
      off: 'Off',
      locked: 'Always on',
      restart: 'Restart required',
      footer: 'Switched-off tools are removed from the model tool list and refused when called. Switched-off skills leave the skill catalog. Switched-off MCP servers stop and withdraw their tools. Skills defined by the current project take precedence over this switch.',
      failed: 'The change failed',
      statusOn: 'on',
      statusOff: 'off',
    }

    const ZH = {
      nav: '资源管理',
      title: '资源管理',
      subtitle: '在此开启或关闭 MCP 服务器、工具与技能，更改会作用于该配置下的所有会话。',
      tabMcp: 'MCP 服务器',
      tabTools: '工具',
      tabSkills: '技能',
      refresh: '刷新',
      refreshing: '刷新中…',
      searchTool: '筛选工具',
      searchSkills: '筛选技能',
      searchMcp: '筛选服务器',
      emptyMcp: '当前配置没有挂载 MCP 服务器。',
      emptyTools: '当前没有已注册的工具。',
      emptySkills: '没有发现技能。',
      emptyFiltered: '没有匹配的条目。',
      loading: '正在读取当前状态…',
      unavailable: '无法连接资源管理服务。',
      retry: '重试',
      on: '已开启',
      off: '已关闭',
      locked: '常开',
      restart: '需要重启',
      footer: '关闭的工具会从模型的工具列表中移除，被调用时也会被拒绝；关闭的技能会从技能目录中移除；关闭的 MCP 服务器会停止并收回其工具。当前项目自带的同名技能优先级高于此处的开关。',
      failed: '更改失败',
      statusOn: '开启',
      statusOff: '关闭',
    }

    const CSS = `
.rm-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 24px; color: var(--dsw-alias-label-primary); }
.rm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.rm-headText { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rm-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; }
.rm-subtitle { margin: 0; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.rm-refresh { flex: none; height: 28px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; }
.rm-refresh:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.rm-refresh:disabled { cursor: default; opacity: .6; }
.rm-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); align-self: flex-start; }
.rm-tab { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12.5px; cursor: pointer; }
.rm-tab:hover { color: var(--dsw-alias-label-primary); }
.rm-tab[data-active="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 1px var(--dsw-alias-border-l1); }
.rm-count { font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.rm-tab[data-active="true"] .rm-count { color: var(--dsw-alias-brand-primary); }
.rm-search { height: 30px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 0 10px; font-size: 12.5px; outline: none; }
.rm-search:focus { border-color: var(--dsw-alias-brand-primary); }
.rm-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.rm-row { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.rm-row:last-child { border-bottom: 0; }
.rm-rowMain { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.rm-name { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-desc { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rm-meta { font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-secondary); opacity: .85; }
.rm-switch { flex: none; position: relative; width: 38px; height: 22px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-base); cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.rm-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); transition: transform .15s ease, background .15s ease; }
.rm-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.rm-switch[aria-checked="true"]::after { transform: translateX(16px); background: var(--dsw-alias-bg-base); }
.rm-switch:disabled { cursor: default; opacity: .55; }
.rm-switchLabel { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-left: 6px; }
.rm-empty { padding: 22px 14px; text-align: center; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.rm-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.rm-notice[data-tone="info"] { border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.rm-footer { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin: 0; }
.rm-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`

    /** Build a translate function bound to the live Client locale. */
    function createTranslate(ctx) {
      const locale = ctx.get('locale')
      const pick = () => {
        let id = ''
        try {
          const snapshot = locale?.getLocale?.()
          id = typeof snapshot?.id === 'string' ? snapshot.id : ''
        } catch {
          id = ''
        }
        if (id === '') {
          try {
            id = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '')
          } catch {
            id = ''
          }
        }
        return id.toLowerCase().startsWith('zh') ? ZH : EN
      }
      return (key) => {
        const dict = pick()
        return dict[key] ?? EN[key] ?? key
      }
    }

    /** One same-origin JSON request against this package's Host routes. */
    async function requestJson(path, init) {
      const response = await fetch(`${ROUTE}${path}`, {
        cache: 'no-store',
        headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...init,
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) {
        const detail = body !== null && typeof body === 'object' && typeof body.error === 'string'
          ? body.error
          : `${response.status} ${response.statusText}`
        throw new Error(detail)
      }
      if (body === null || typeof body !== 'object') throw new Error('the Host returned an unreadable response')
      if (body.ok === false) throw new Error(typeof body.error === 'string' ? body.error : 'the Host refused the change')
      return body
    }

    /** One switch control with the host's accessibility contract. */
    function Switch(props) {
      const { t, checked, disabled, onToggle, label } = props
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        title: checked ? t('statusOn') : t('statusOff'),
        className: 'rm-switch',
        disabled,
        onClick: onToggle,
      })
    }

    /** One resource row. */
    function Row(props) {
      const { t, item, busy, onToggle, kind } = props
      const meta = []
      if (kind === 'mcp' && item.label) meta.push(item.label)
      if (kind === 'mcp' && item.moduleName !== undefined) meta.push(item.moduleName)
      if (kind === 'mcp' && item.phase !== null && item.phase !== undefined) meta.push(String(item.phase))
      if (kind === 'skill' && item.source) meta.push(item.source)
      if (kind === 'skill' && item.provider) meta.push(item.provider)
      if (item.locked === true) meta.push(t('locked'))
      return h('li', { className: 'rm-row' },
        h('div', { className: 'rm-rowMain' },
          h('span', { className: 'rm-name', title: item.name }, item.name),
          item.description ? h('span', { className: 'rm-desc' }, item.description) : null,
          meta.length > 0 ? h('span', { className: 'rm-meta' }, meta.join(' · ')) : null),
        h('span', { className: 'rm-switchLabel', 'aria-hidden': 'true' }, item.enabled ? t('on') : t('off')),
        h(Switch, {
          t,
          checked: item.enabled,
          disabled: item.locked === true || busy,
          label: `${item.name} ${item.enabled ? t('statusOn') : t('statusOff')}`,
          onToggle: () => onToggle(item, !item.enabled),
        }))
    }

    /** The Settings page itself. */
    function ResourceManagerPage(props) {
      const t = props.translate
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [notice, setNotice] = React.useState(null)
      const [tab, setTab] = React.useState('mcp')
      const [filter, setFilter] = React.useState('')
      const [busyKey, setBusyKey] = React.useState(null)
      const [reloadToken, setReloadToken] = React.useState(0)
      const alive = React.useRef(true)

      React.useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        requestJson('/state')
          .then((body) => {
            if (cancelled) return
            setState(body)
            setError(null)
          })
          .catch((cause) => {
            if (cancelled) return
            setError(cause instanceof Error ? cause.message : String(cause))
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => { cancelled = true }
      }, [reloadToken])

      const toggle = React.useCallback(async (kind, item, enabled) => {
        const key = `${kind}:${item.id ?? item.name}`
        setBusyKey(key)
        setNotice(null)
        try {
          // The Host route is a Web *resource*, and the carrier answers a
          // resource with GET/HEAD only — a POST here dies as 405 before the
          // handler runs. The Host already reads this action from the query
          // string, so the switch travels as GET parameters.
          const query = new URLSearchParams({
            action: 'toggle',
            kind,
            name: String(item.id ?? item.name),
            enabled: String(enabled),
          })
          const body = await requestJson(`/toggle?${query.toString()}`)
          if (alive.current) {
            setState(body)
            setError(null)
            if (body.result !== undefined && body.result.application === 'restart-required') {
              setNotice(t('restart'))
            }
          }
        } catch (cause) {
          if (alive.current) {
            setError(`${t('failed')}: ${cause instanceof Error ? cause.message : String(cause)}`)
          }
        } finally {
          if (alive.current) setBusyKey(null)
        }
      }, [t])

      const rows = state === null
        ? []
        : tab === 'mcp' ? state.mcp : tab === 'tools' ? state.tools : state.skills
      const needle = filter.trim().toLowerCase()
      const visible = needle === ''
        ? rows
        : rows.filter((item) => item.name.toLowerCase().includes(needle)
          || (typeof item.description === 'string' && item.description.toLowerCase().includes(needle)))

      const tabButton = (key, label, count) => h('button', {
        type: 'button',
        key,
        className: 'rm-tab',
        'data-active': tab === key ? 'true' : 'false',
        'aria-pressed': tab === key ? 'true' : 'false',
        onClick: () => { setTab(key); setFilter('') },
      }, label, h('span', { className: 'rm-count' }, String(count)))

      const counts = state === null
        ? { mcp: 0, tools: 0, skills: 0 }
        : {
            mcp: state.mcp.length,
            tools: state.tools.length,
            skills: state.skills.length,
          }

      const placeholder = tab === 'mcp' ? t('searchMcp') : tab === 'tools' ? t('searchTool') : t('searchSkills')
      const emptyText = needle !== ''
        ? t('emptyFiltered')
        : tab === 'mcp' ? t('emptyMcp') : tab === 'tools' ? t('emptyTools') : t('emptySkills')

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', { className: 'rm-root' },
          h('div', { className: 'rm-head' },
            h('div', { className: 'rm-headText' },
              h('h2', { className: 'rm-title' }, t('title')),
              h('p', { className: 'rm-subtitle' }, t('subtitle'))),
            h('button', {
              type: 'button',
              className: 'rm-refresh',
              disabled: loading,
              onClick: () => setReloadToken((value) => value + 1),
            }, loading ? t('refreshing') : t('refresh'))),
          error !== null
            ? h('div', { className: 'rm-notice', role: 'alert' },
                h('span', null, error),
                h('button', {
                  type: 'button',
                  className: 'rm-refresh',
                  onClick: () => setReloadToken((value) => value + 1),
                }, t('retry')))
            : null,
          notice !== null
            ? h('div', { className: 'rm-notice', 'data-tone': 'info' }, h('span', null, notice))
            : null,
          h('div', { className: 'rm-tabs', role: 'tablist' },
            tabButton('mcp', t('tabMcp'), counts.mcp),
            tabButton('tools', t('tabTools'), counts.tools),
            tabButton('skills', t('tabSkills'), counts.skills)),
          h('input', {
            className: 'rm-search',
            type: 'search',
            value: filter,
            placeholder,
            'aria-label': placeholder,
            onChange: (event) => setFilter(event.target.value),
          }),
          h('ul', { className: 'rm-list', role: 'list' },
            state === null && loading
              ? h('li', { className: 'rm-empty' }, t('loading'))
              : visible.length === 0
                ? h('li', { className: 'rm-empty' }, emptyText)
                : visible.map((item) => h(Row, {
                    key: `${tab}:${item.id ?? item.name}`,
                    t,
                    item,
                    kind: tab,
                    busy: busyKey === `${tab}:${item.id ?? item.name}`,
                    onToggle: (target, enabled) => void toggle(tab, target, enabled),
                  }))),
          h('p', { className: 'rm-footer' }, t('footer'))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const translate = createTranslate(ctx)
        function Page(props) {
          return h(ResourceManagerPage, { ...props, translate })
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'resource-manager',
          order: 40,
          label: () => translate('nav'),
        }, Page))
      },
    }
  },
})
