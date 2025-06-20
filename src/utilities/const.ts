export const GITHUB_AUTH_PROVIDER_ID = "github";
export const SCOPES = [
	"user:email",
	"read:org",
	"read:user",
	"repo",
	"workflow",
];

export const dspyExamples = [
	{
		readme: `
                # 21st.dev Magic AI Agent
                Magic Component Platform (MCP) is a powerful AI-driven tool that helps developers create beautiful, modern UI components instantly through natural language descriptions. It integrates seamlessly with popular IDEs and provides a streamlined workflow for UI development.
                ## 🚀 Getting Started

                ##### Manual VS Code Setup

                First, check the install buttons above for one-click installation. For manual setup:

                Add the following JSON block to your User Settings (JSON) file in VS Code. You can do this by pressing \`Ctrl + Shift + P\` and typing \`Preferences: Open User Settings (JSON)\`:

                \`\`\`json
                {
                    "mcp": {
                        "inputs": [
                            {
                                "type": "promptString",
                                "id": "apiKey",
                                "description": "21st.dev Magic API Key",
                                "password": true
                            }
                        ],
                        "servers": {
                            "@21st-dev/magic": {
                                "command": "npx",
                                "args": ["-y", "@21st-dev/magic@latest"],
                                "env": {
                                    "API_KEY": "\${input:apiKey}"
                                }
                            }
                        }
                    }
                }
                \`\`\`

                Optionally, you can add it to a file called \`.vscode/mcp.json\` in your workspace:

                \`\`\`json
                {
                    "inputs": [
                        {
                            "type": "promptString",
                            "id": "apiKey",
                            "description": "21st.dev Magic API Key",
                            "password": true
                        }
                    ],
                    "servers": {
                        "@21st-dev/magic": {
                            "command": "npx",
                            "args": ["-y", "@21st-dev/magic@latest"],
                            "env": {
                                "API_KEY": "\${input:apiKey}"
                            }
                        }
                    }
                }
                \`\`\`
                `,
		name: "@21st-dev/magic",
		command: "npx",
		args: ["-y", "@21st-dev/magic@latest"],
		env: {
			API_KEY: "${input:apiKey}",
		},
		inputs: [
			{
				type: "promptString",
				id: "apiKey",
				description: "21st.dev Magic API Key",
				password: true,
			},
		],
	},
	{
		readme: `
                    # GitMCP
                    ## 🤔 What is GitMCP?
                    **Stop vibe-hallucinating and start vibe-coding!**

                    [GitMCP](https://gitmcp.io) is a free, open-source, remote [Model Context Protocol (MCP)](https://docs.anthropic.com/en/docs/agents-and-tools/mcp) server that transforms **any** GitHub project (repositories or GitHub pages) into a documentation hub. It enables AI tools like Cursor to access up-to-date documentation and code, even if the LLM has never encountered them, thereby eliminating code hallucinations seamlessly.
                    ### Step 2: Connect your AI assistant

                    Select your AI assistant from the options below and follow the configuration instructions:

                    #### Connecting Cursor

                    Update your Cursor configuration file at \`~/.cursor/mcp.json\`:
                    \`\`\`json
                    {
                        "mcpServers": {
                            "gitmcp": {
                                "url": "https://gitmcp.io/{owner}/{repo}"
                            }
                        }
                    }
                    \`\`\`

                    #### Connecting Claude Desktop

                    1. In Claude Desktop, go to Settings > Developer > Edit Config
                    2. Replace the configuration with:
                    \`\`\`json
                    {
                        "mcpServers": {
                            "gitmcp": {
                                "command": "npx",
                                "args": [
                                    "mcp-remote",
                                    "https://gitmcp.io/{owner}/{repo}"
                                ]
                            }
                        }
                    }
                    \`\`\`

                    #### Connecting Windsurf
                    \`\`\`json
                    {
                        "mcpServers": {
                            "gitmcp": {
                                "serverUrl": "https://gitmcp.io/{owner}/{repo}"
                            }
                        }
                    }
                    \`\`\`

                    #### Connecting VSCode
                    \`\`\`json
                    {
                        "servers": {
                            "gitmcp": {
                                "type": "sse",
                                "url": "https://gitmcp.io/{owner}/{repo}"
                            }
                        }
                    }
                    \`\`\`
                    ## ⚙ How It Works

                    GitMCP connects your AI assistant to GitHub repositories using the Model Context Protocol (MCP), a standard that lets AI tools request additional information from external sources.
                    `,
		name: "gitmcp",
		command: "npx",
		args: ["mcp-remote", "https://gitmcp.io/${input:owner}/${input:repo}"],
		inputs: [
			{
				type: "promptString",
				id: "owner",
				description: "Repository Owner",
				password: false,
			},
			{
				type: "promptString",
				id: "repo",
				description: "Repository name.",
				password: false,
			},
		],
	},
	{
		readme: `
                    # mcp-server-qdrant: A Qdrant MCP server
                    > The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) is an open protocol that enables
                    > seamless integration between LLM applications and external data sources and tools. Whether you're building an
                    > AI-powered IDE, enhancing a chat interface, or creating custom AI workflows, MCP provides a standardized way to
                    > connect LLMs with the context they need.

                    This repository is an example of how to create a MCP server for [Qdrant](https://qdrant.tech/), a vector search engine.

                    ## Overview

                    An official Model Context Protocol server for keeping and retrieving memories in the Qdrant vector search engine.
                    It acts as a semantic memory layer on top of the Qdrant database.

                    ## Components
                    ...
                    ## Installation

                    ### Using uvx

                    When using [uvx](https://docs.astral.sh/uv/guides/tools/#running-tools) no specific installation is needed to directly run *mcp-server-qdrant*.

                    \`\`\`shell
                        QDRANT_URL="http://localhost:6333" \\
                        COLLECTION_NAME="my-collection" \\
                        EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2" \
                        uvx mcp-server-qdrant
                    \`\`\`

                    #### Transport Protocols

                    The server supports different transport protocols that can be specified using the \`--transport\` flag:

                        \`\`\`shell
                    QDRANT_URL="http://localhost:6333" \
                    COLLECTION_NAME="my-collection" \
                    uvx mcp-server-qdrant --transport sse
                        \`\`\`

                    Supported transport protocols:

                    - \`stdio\` (default): Standard input/output transport, might only be used by local MCP clients
                    - \`sse\`: Server-Sent Events transport, perfect for remote clients

                    The default transport is \`stdio\` if not specified.

                    ### Using Docker

                    A Dockerfile is available for building and running the MCP server:

                    \`\`\`bash
                    # Build the container
                    docker build -t mcp-server-qdrant .

                    # Run the container
                    docker run -p 8000:8000 \
                    -e QDRANT_URL="http://your-qdrant-server:6333" \
                    -e QDRANT_API_KEY="your-api-key" \
                    -e COLLECTION_NAME="your-collection" \
                    mcp-server-qdrant
                    \`\`\`

                    ### Installing via Smithery

                    To install Qdrant MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/protocol/mcp-server-qdrant):

                    \`\`\`bash
                    npx @smithery/cli install mcp-server-qdrant --client claude
                    \`\`\`

                    ### Manual configuration of Claude Desktop

                    To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your
                    \`claude_desktop_config.json\`:

                    \`\`\`json
                    {
                        "qdrant": {
                            "command": "uvx",
                            "args": ["mcp-server-qdrant"],
                            "env": {
                                "QDRANT_URL": "https://xyz-example.eu-central.aws.cloud.qdrant.io:6333",
                                "QDRANT_API_KEY": "your_api_key",
                                "COLLECTION_NAME": "your-collection-name",
                                "EMBEDDING_MODEL": "sentence-transformers/all-MiniLM-L6-v2"
                            }
                        }
                    }
                    \`\`\`

                    For local Qdrant mode:

                    \`\`\`json
                    {
                        "qdrant": {
                            "command": "uvx",
                            "args": ["mcp-server-qdrant"],
                            "env": {
                                "QDRANT_LOCAL_PATH": "/path/to/qdrant/database",
                                "COLLECTION_NAME": "your-collection-name",
                                "EMBEDDING_MODEL": "sentence-transformers/all-MiniLM-L6-v2"
                            }
                        }
                    }
                    \`\`\`

                    This MCP server will automatically create a collection with the specified name if it doesn't exist.

                    By default, the server will use the \`sentence-transformers/all-MiniLM-L6-v2\` embedding model to encode memories.
                    For the time being, only [FastEmbed](https://qdrant.github.io/fastembed/) models are supported.

                    ## Support for other tools

                    This MCP server can be used with any MCP-compatible client. For example, you can use it with
                    [Cursor](https://docs.cursor.com/context/model-context-protocol) and [VS Code](https://code.visualstudio.com/docs), which provide built-in support for the Model Context
                    Protocol.

                    ### Using with Cursor/Windsurf

                    You can configure this MCP server to work as a code search tool for Cursor or Windsurf by customizing the tool
                    descriptions:

                    \`\`\`bash
                    QDRANT_URL="http://localhost:6333" \
                    COLLECTION_NAME="code-snippets" \
                    TOOL_STORE_DESCRIPTION="Store reusable code snippets for later retrieval. \
                    The 'information' parameter should contain a natural language description of what the code does, \
                    while the actual code should be included in the 'metadata' parameter as a 'code' property. \
                    The value of 'metadata' is a Python dictionary with strings as keys. \
                    Use this whenever you generate some code snippet." \
                    TOOL_FIND_DESCRIPTION="Search for relevant code snippets based on natural language descriptions. \
                    The 'query' parameter should describe what you're looking for, \
                    and the tool will return the most relevant code snippets. \
                    Use this when you need to find existing code snippets for reuse or reference." \
                    uvx mcp-server-qdrant --transport sse # Enable SSE transport
                    \`\`\`

                    In Cursor/Windsurf, you can then configure the MCP server in your settings by pointing to this running server using
                    SSE transport protocol. The description on how to add an MCP server to Cursor can be found in the [Cursor
                    documentation](https://docs.cursor.com/context/model-context-protocol#adding-an-mcp-server-to-cursor). If you are
                    running Cursor/Windsurf locally, you can use the following URL:

                    \`\`\`
                    http://localhost:8000/sse
                    \`\`\`

                    > [!TIP]
                    > We suggest SSE transport as a preferred way to connect Cursor/Windsurf to the MCP server, as it can support remote
                    > connections. That makes it easy to share the server with your team or use it in a cloud environment.

                    This configuration transforms the Qdrant MCP server into a specialized code search tool that can:

                    1. Store code snippets, documentation, and implementation details
                    2. Retrieve relevant code examples based on semantic search
                    3. Help developers find specific implementations or usage patterns

                    You can populate the database by storing natural language descriptions of code snippets (in the \`information\` parameter)
                    along with the actual code (in the \`metadata.code\` property), and then search for them using natural language queries
                    that describe what you're looking for.

                    > [!NOTE]
                    > The tool descriptions provided above are examples and may need to be customized for your specific use case. Consider
                    > adjusting the descriptions to better match your team's workflow and the specific types of code snippets you want to
                    > store and retrieve.

                    **If you have successfully installed the \`mcp-server-qdrant\`, but still can't get it to work with Cursor, please
                    consider creating the [Cursor rules](https://docs.cursor.com/context/rules-for-ai) so the MCP tools are always used when
                    the agent produces a new code snippet.** You can restrict the rules to only work for certain file types, to avoid using
                    the MCP server for the documentation or other types of content.

                    ### Using with Claude Code

                    You can enhance Claude Code's capabilities by connecting it to this MCP server, enabling semantic search over your
                    existing codebase.

                    #### Setting up mcp-server-qdrant

                    1. Add the MCP server to Claude Code:

                        \`\`\`shell
                        # Add mcp-server-qdrant configured for code search
                        claude mcp add code-search \
                        -e QDRANT_URL="http://localhost:6333" \
                        -e COLLECTION_NAME="code-repository" \
                        -e EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2" \
                        -e TOOL_STORE_DESCRIPTION="Store code snippets with descriptions. The 'information' parameter should contain a natural language description of what the code does, while the actual code should be included in the 'metadata' parameter as a 'code' property." \
                        -e TOOL_FIND_DESCRIPTION="Search for relevant code snippets using natural language. The 'query' parameter should describe the functionality you're looking for." \
                        -- uvx mcp-server-qdrant
                        \`\`\`

                    2. Verify the server was added:

                        \`\`\`shell
                        claude mcp list
                        \`\`\`

                    #### Using Semantic Code Search in Claude Code

                    Tool descriptions, specified in \`TOOL_STORE_DESCRIPTION\` and \`TOOL_FIND_DESCRIPTION\`, guide Claude Code on how to use
                    the MCP server. The ones provided above are examples and may need to be customized for your specific use case. However,
                    Claude Code should be already able to:

                    1. Use the \`qdrant-store\` tool to store code snippets with descriptions.
                    2. Use the \`qdrant-find\` tool to search for relevant code snippets using natural language.

                    ### Run MCP server in Development Mode

                    The MCP server can be run in development mode using the \`mcp dev\` command. This will start the server and open the MCP
                    inspector in your browser.

                    \`\`\`shell
                    COLLECTION_NAME=mcp-dev mcp dev src/mcp_server_qdrant/server.py
                    \`\`\`

                    ### Using with VS Code

                    For one-click installation, click one of the install buttons below:

                    [![Install with UVX in VS Code](https://img.shields.io/badge/VS_Code-UVX-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=qdrant&config=%7B%22command%22%3A%22uvx%22%2C%22args%22%3A%5B%22mcp-server-qdrant%22%5D%2C%22env%22%3A%7B%22QDRANT_URL%22%3A%22%24%7Binput%3AqdrantUrl%7D%22%2C%22QDRANT_API_KEY%22%3A%22%24%7Binput%3AqdrantApiKey%7D%22%2C%22COLLECTION_NAME%22%3A%22%24%7Binput%3AcollectionName%7D%22%7D%7D&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantUrl%22%2C%22description%22%3A%22Qdrant+URL%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantApiKey%22%2C%22description%22%3A%22Qdrant+API+Key%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22collectionName%22%2C%22description%22%3A%22Collection+Name%22%7D%5D) [![Install with UVX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-UVX-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=qdrant&config=%7B%22command%22%3A%22uvx%22%2C%22args%22%3A%5B%22mcp-server-qdrant%22%5D%2C%22env%22%3A%7B%22QDRANT_URL%22%3A%22%24%7Binput%3AqdrantUrl%7D%22%2C%22QDRANT_API_KEY%22%3A%22%24%7Binput%3AqdrantApiKey%7D%22%2C%22COLLECTION_NAME%22%3A%22%24%7Binput%3AcollectionName%7D%22%7D%7D&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantUrl%22%2C%22description%22%3A%22Qdrant+URL%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantApiKey%22%2C%22description%22%3A%22Qdrant+API+Key%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22collectionName%22%2C%22description%22%3A%22Collection+Name%22%7D%5D&quality=insiders)

                    [![Install with Docker in VS Code](https://img.shields.io/badge/VS_Code-Docker-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=qdrant&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-p%22%2C%228000%3A8000%22%2C%22-i%22%2C%22--rm%22%2C%22-e%22%2C%22QDRANT_URL%22%2C%22-e%22%2C%22QDRANT_API_KEY%22%2C%22-e%22%2C%22COLLECTION_NAME%22%2C%22mcp-server-qdrant%22%5D%2C%22env%22%3A%7B%22QDRANT_URL%22%3A%22%24%7Binput%3AqdrantUrl%7D%22%2C%22QDRANT_API_KEY%22%3A%22%24%7Binput%3AqdrantApiKey%7D%22%2C%22COLLECTION_NAME%22%3A%22%24%7Binput%3AcollectionName%7D%22%7D%7D&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantUrl%22%2C%22description%22%3A%22Qdrant+URL%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantApiKey%22%2C%22description%22%3A%22Qdrant+API+Key%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22collectionName%22%2C%22description%22%3A%22Collection+Name%22%7D%5D) [![Install with Docker in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Docker-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=qdrant&config=%7B%22command%22%3A%22docker%22%2C%22args%22%3A%5B%22run%22%2C%22-p%22%2C%228000%3A8000%22%2C%22-i%22%2C%22--rm%22%2C%22-e%22%2C%22QDRANT_URL%22%2C%22-e%22%2C%22QDRANT_API_KEY%22%2C%22-e%22%2C%22COLLECTION_NAME%22%2C%22mcp-server-qdrant%22%5D%2C%22env%22%3A%7B%22QDRANT_URL%22%3A%22%24%7Binput%3AqdrantUrl%7D%22%2C%22QDRANT_API_KEY%22%3A%22%24%7Binput%3AqdrantApiKey%7D%22%2C%22COLLECTION_NAME%22%3A%22%24%7Binput%3AcollectionName%7D%22%7D%7D&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantUrl%22%2C%22description%22%3A%22Qdrant+URL%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22qdrantApiKey%22%2C%22description%22%3A%22Qdrant+API+Key%22%2C%22password%22%3Atrue%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22collectionName%22%2C%22description%22%3A%22Collection+Name%22%7D%5D&quality=insiders)

                    #### Manual Installation

                    Add the following JSON block to your User Settings (JSON) file in VS Code. You can do this by pressing \`Ctrl + Shift + P\` and typing \`Preferences: Open User Settings (JSON)\`.

                    \`\`\`json
                    {
                        "mcp": {
                            "inputs": [
                            {
                                "type": "promptString",
                                "id": "qdrantUrl",
                                "description": "Qdrant URL"
                            },
                            {
                                "type": "promptString",
                                "id": "qdrantApiKey",
                                "description": "Qdrant API Key",
                                "password": true
                            },
                            {
                                "type": "promptString",
                                "id": "collectionName",
                                "description": "Collection Name"
                            }
                            ],
                            "servers": {
                                "qdrant": {
                                    "command": "uvx",
                                    "args": ["mcp-server-qdrant"],
                                    "env": {
                                    "QDRANT_URL": "\${input:qdrantUrl}",
                                    "QDRANT_API_KEY": "\${input:qdrantApiKey}",
                                    "COLLECTION_NAME": "\${input:collectionName}"
                                    }
                                }
                            }
                        }
                    }
                    \`\`\`

                    Or if you prefer using Docker, add this configuration instead:

                    \`\`\`json
                    {
                        "mcp": {
                            "inputs": [
                                {
                                    "type": "promptString",
                                    "id": "qdrantUrl",
                                    "description": "Qdrant URL"
                                },
                                {
                                    "type": "promptString",
                                    "id": "qdrantApiKey",
                                    "description": "Qdrant API Key",
                                    "password": true
                                },
                                {
                                    "type": "promptString",
                                    "id": "collectionName",
                                    "description": "Collection Name"
                                }
                            ],
                            "servers": {
                                "qdrant": {
                                    "command": "docker",
                                    "args": [
                                        "run",
                                        "-p", "8000:8000",
                                        "-i",
                                        "--rm",
                                        "-e", "QDRANT_URL",
                                        "-e", "QDRANT_API_KEY",
                                        "-e", "COLLECTION_NAME",
                                        "mcp-server-qdrant"
                                    ],
                                    "env": {
                                        "QDRANT_URL": "\${input:qdrantUrl}",
                                        "QDRANT_API_KEY": "\${input:qdrantApiKey}",
                                        "COLLECTION_NAME": "\${input:collectionName}"
                                    }
                                }
                            }
                        }
                    }
                    \`\`\`

                    Alternatively, you can create a \`.vscode/mcp.json\` file in your workspace with the following content:

                    \`\`\`json
                    {
                        "inputs": [
                            {
                                "type": "promptString",
                                "id": "qdrantUrl",
                                "description": "Qdrant URL"
                            },
                            {
                                "type": "promptString",
                                "id": "qdrantApiKey",
                                "description": "Qdrant API Key",
                                "password": true
                            },
                            {
                                "type": "promptString",
                                "id": "collectionName",
                                "description": "Collection Name"
                            }
                        ],
                        "servers": {
                            "qdrant": {
                                "command": "uvx",
                                "args": ["mcp-server-qdrant"],
                                "env": {
                                    "QDRANT_URL": "\${input:qdrantUrl}",
                                    "QDRANT_API_KEY": "\${input:qdrantApiKey}",
                                    "COLLECTION_NAME": "\${input:collectionName}"
                                }
                            }
                        }
                    }
                    \`\`\`

                    For workspace configuration with Docker, use this in \`.vscode/mcp.json\`:

                    \`\`\`json
                    {
                        "inputs": [
                            {
                                "type": "promptString",
                                "id": "qdrantUrl",
                                "description": "Qdrant URL"
                            },
                            {
                                "type": "promptString",
                                "id": "qdrantApiKey",
                                "description": "Qdrant API Key",
                                "password": true
                            },
                            {
                                "type": "promptString",
                                "id": "collectionName",
                                "description": "Collection Name"
                            }
                        ],
                        "servers": {
                            "qdrant": {
                                "command": "docker",
                                "args": [
                                    "run",
                                    "-p", "8000:8000",
                                    "-i",
                                    "--rm",
                                    "-e", "QDRANT_URL",
                                    "-e", "QDRANT_API_KEY",
                                    "-e", "COLLECTION_NAME",
                                    "mcp-server-qdrant"
                                ],
                                "env": {
                                    "QDRANT_URL": "\${input:qdrantUrl}",
                                    "QDRANT_API_KEY": "\${input:qdrantApiKey}",
                                    "COLLECTION_NAME": "\${input:collectionName}"
                                }
                            }
                        }
                    }
                    \`\`\`

                    ## Contributing
                    `,
		name: "qdrant",

		command: "uvx",
		args: ["mcp-server-qdrant"],
		env: {
			QDRANT_URL: "${input:qdrantUrl}",
			QDRANT_API_KEY: "${input:qdrantApiKey}",
			COLLECTION_NAME: "${input:collectionName}",
		},

		inputs: [
			{
				type: "promptString",
				id: "qdrantUrl",
				description: "Qdrant URL",
			},
			{
				type: "promptString",
				id: "qdrantApiKey",
				description: "Qdrant API Key",
				password: true,
			},
			{
				type: "promptString",
				id: "collectionName",
				description: "Collection Name",
			},
		],
	},
];
