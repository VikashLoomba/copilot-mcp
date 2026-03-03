<div align="center">
<h1>Copilot MCP Search for VS Code</h1>
</div>

<div align="center">
  <a href="vscode://AutomataLabs.copilot-mcp">
    <img src="https://badgen.net/vs-marketplace/i/AutomataLabs.copilot-mcp?icon=visualstudio" />
  </a>
  <br />
  <a href="https://discord.gg/cloudmcp">
    <img src="https://dcbadge.limes.pink/api/server/https://discord.gg/cloudmcp" />
  </a>
</div>

<!-- ✨ New: value-first CTA block -->
<div align="center">
  
  > **Want remote MCP in ~30s?** Try **Cloud MCP** — paste a URL → OAuth → done.  
  > Works with Copilot & Claude (no keys, no terminal).  
  > **Get started at** [cloudmcp.run](https://cloudmcp.run/?utm_source=github&utm_medium=readme&utm_campaign=copilot-mcp)
</div>

<div align="center">
  <div style="display: flex; justify-content: center; gap: 20px; margin: 20px 0;">
    <img width="800" alt="image" src="https://automatalabs.io/demo.gif" />
  </div>
</div>

<div align="center">
  
![Version](https://img.shields.io/badge/version-0.0.92-blue.svg?cacheSeconds=2592000)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue.svg?logo=visual-studio-code)](https://code.visualstudio.com/api/references/extension-guidelines)
[![MCP Client](https://img.shields.io/badge/MCP-Client-green.svg)](https://modelcontextprotocol.io/clients)

</div>

> A powerful VS Code extension that lets you **discover, install, and manage** open‑source MCP servers and agent skills from one place.

## ✨ Features
- 🔧 **MCP Server Management** – connect/manage multiple servers via an intuitive UI  
- 🧠 **Skills Search & Install** – discover skills from `skills.sh` and install to your agents  
- 🗂️ **Installed Skills Management** – view installed skills and uninstall with agent-level controls  
- 🚀 **Claude/Codex/Copilot Integration** – expose MCP tools directly to your agents  
- 🎯 **Server Discovery** – automatically discover open‑source servers  

## 📦 Installation
1) Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AutomataLabs.copilot-mcp).  
2) Open **MCP Servers** in the Activity Bar, or configure in **Settings**.

<!-- ✨ New: Remote option -->
### Optional: Remote MCP (no local setup)
If you don’t want to run servers locally, use **Cloud MCP** (remote, OAuth‑only).  
Paste the MCP URL into Copilot/Claude and you’re done:
- **Learn More:** [https://cloudmcp.run](https://cloudmcp.run/?utm_source=github&utm_medium=readme&utm_campaign=copilot-mcp)

## 🛠️ Configuration
Configure via the UI or VS Code settings. Look for the **MCP Servers** icon in the Activity Bar.

## 🚀 Usage
1) Open the **MCP Servers** view  
2) Connect or search for servers  
3) Switch to **Skills** to search and install skills, and manage installed skills  
4) Use Copilot Chat with your newly added tools and skills

<!-- ✨ New: Discovery + Remote deploy hint -->
> Tip: When a server supports `npx`/`uvx`, the **Server Discovery** panel shows a **“Deploy via Cloud MCP”** option so you can run it remotely without installing anything.

## 🔗 Requirements
- VS Code
- GitHub Copilot Chat extension

## 🌟 Benefits
- Give Copilot standardized tools via MCP
- Local or remote workflows (Cloud MCP)
- Join a growing, interoperable ecosystem

## 🔄 Maintainer: Vendored Copilot Provider Sync
This repo vendors an upstream Copilot provider from `anomalyco/opencode` under:

- `vendor/opencode-copilot/src/**`

Sync it with:

```bash
npm run sync:copilot-provider
```

Check drift without writing files:

```bash
npm run sync:copilot-provider:check
```

Automated daily sync PRs are created by:

- `.github/workflows/sync-opencode-copilot.yml`

## 👥 Contributing
PRs and feature requests welcome! See [issues](https://github.com/VikashLoomba/copilot-mcp/issues).

## ✍️ Author
**Vikash Loomba**  
Website: [https://cloudmcp.run](https://cloudmcp.run/?utm_source=github&utm_medium=readme&utm_campaign=copilot-mcp)  
X: [@DevAutomata](https://x.com/DevAutomata)  
GitHub: [@vikashloomba](https://github.com/vikashloomba)

## 📝 License
GPL‑3.0 — see [LICENSE](LICENSE).

---

_Part of the [MCP Client Ecosystem](https://modelcontextprotocol.io/clients)_
