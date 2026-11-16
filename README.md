# dsh-resource-manager

一个 DeepSeek Harness 插件：在 **设置 → 资源管理** 中统一开启 / 关闭 **MCP 服务器**、
**工具**、**技能**，并注册同名智能体工具 `manage_resources`，让同样的操作也能在对话里完成。

A DeepSeek Harness bundle: one Settings page (**Settings → Resource manager**) that
switches **MCP servers**, **agent tools**, and **skills** on or off, plus a
`manage_resources` agent tool that runs the same operations from chat.

## 安装 / Install

从 npm 安装（该包发布到 npm 之后可用），用插件管理器安装 spec `dsh-resource-manager`（等价命令行）：

```bash
dsh plugin --profile web add dsh-resource-manager
```

也可以直接指向本地目录（开发时）：

```bash
dsh plugin --profile web add /absolute/path/to/dsh-resource-manager
```

装好后重启 DSH，**设置 → 资源管理** 出现，智能体同时获得 `manage_resources` 工具。

装完如果设置页报错，先确认这个包在你的 profile 里是启用状态，并强制刷新一次页面
（Client 半是浏览器里跑的，路由修复要等页面重新加载）。

## 功能 / What it does

- **MCP 服务器**：列出挂载 `@deepseek-ai/dsh-mcp-client` / `dsh-mcp-manager` 的
  Loader 行，开关通过插件管理器落盘到 profile 补丁层，关闭后服务器停止并收回其工具。
- **工具**：列出所有全局注册的工具；关闭后由全部署守卫拒绝执行，并从每个活跃智能体的
  工具视图中移除（`tools.restrict()`），模型不再看到该工具。
- **技能**：列出已发现的技能；关闭后用隐藏的运行时注册遮蔽该技能（禁止模型与人手动
  调用），技能目录、`skill` 工具与 `/名字` 手势都不再提供它。

## 使用 / Usage

设置面板：打开 **设置 → 资源管理**，在三个分页中切换开关，支持按名称筛选。

对话：先让模型列出，再让它切换。

```
manage_resources(action="list")
manage_resources(action="set", kind="skill", name="dsh-doc", enabled=false)
```

## 状态保存 / Persistence

工具与技能的关闭名单保存在本插件自己的 Loader 行（`disabledTools`、`disabledSkills`），
经配置编辑器写入用户补丁层，重启与升级后仍然有效；MCP 开关由插件管理器保存。

## 限制 / Limitations

- 当前项目自带的同名技能（`project-dsh` / `project-agents`）优先级高于运行时层，此处关闭
  不会遮蔽它们。
- 由其他插件在运行时注册的 MCP 服务器（`mcpManager.register()`）归注册方所有，不在此列。
- 开关作用于整个 profile，没有按会话或按智能体的粒度。
- 设置页面依赖 Host 的 web server；没有 web server 时页面会提示无法连接，智能体工具仍可用。
- `manage_resources` 自身不能被关闭。

## 许可 / License

MIT © SuMuxi66。见 [LICENSE](LICENSE)。
