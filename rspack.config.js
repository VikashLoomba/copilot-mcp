// @ts-check

const path = require('path');

/**
 * Rspack supports multi-compiler by returning an array of configurations,
 * similar to webpack. Each config can have different entry, target, and rules.
 *
 * @type {import('@rspack/cli').Configuration[]}
 */
module.exports = [
  // ========== 1) Extension (backend) config ==========
  {
    name: 'extension',
    target: 'node', // The extension runs in Node context
    entry: {
      extension: './src/extension/extension.ts'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2'
    },
    externals: {
      vscode: 'commonjs vscode' // must exclude the vscode module
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          include: path.resolve(__dirname, 'src/extension'),
          use: [
            {
              loader: 'ts-loader',
              options: {
                configFile: 'tsconfig.extension.json'
              }
            }
          ]
        },
        // If you have other rules (e.g., for keytar.node) in the extension:
        {
          test: /\keytar.node$/,
          use: { loader: "file-loader" }
        }
      ]
    },
    // Typically you'd set devtool for your extension bundling:
    devtool: 'nosources-source-map'
  },

  // ========== 2) Webview (frontend) config ==========
  {
    name: 'webview',
    target: 'web', // The webview runs in a browser environment
    entry: {
      webview: './src/webview/index.tsx'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'webview.js',
      // If you want to use ESM in the webview (e.g., to do <script type="module">),
      // you can specify `library: { type: 'module' }` and `experiments.outputModule = true`.
      library: {
        type: 'module'
      }
    },
    experiments: {
      // needed if you use 'type: module' in the library output
      outputModule: true
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          include: path.resolve(__dirname, 'src/webview'),
          use: [
            {
              loader: 'ts-loader',
              options: {
                configFile: 'tsconfig.webview.json'
              }
            }
          ]
        },
        // If you have CSS/Tailwind, also add style-loader, css-loader, etc.
        // e.g.:
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader']
        }
      ]
    },
    // For easier debugging in the webview
    devtool: 'source-map',
    performance: {
      hints: false
    },
    optimization: {
      minimize: false
    }
  }
];
