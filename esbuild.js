const esbuild = require('esbuild');
const { copy } = require('esbuild-plugin-copy');
const postCssPlugin = require('esbuild-plugin-style');
const path = require('path');
const fs = require('fs');
// Check if the CJS files exist
// const sdkPath = path.resolve(__dirname, 'node_modules/');
// const cjsClientPath = path.resolve(sdkPath, 'dist/cjs/client/index.js');
// const cjsTypesPath = path.resolve(sdkPath, 'dist/cjs/types.js');

// // Get proper paths depending on what exists
// const clientPath = fs.existsSync(cjsClientPath) 
//   ? cjsClientPath 
//   : path.resolve(sdkPath, 'dist/esm/client/index.js');

// const typesPath = fs.existsSync(cjsTypesPath)
//   ? cjsTypesPath
//   : path.resolve(sdkPath, 'dist/esm/types.js');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Create extension bundle
async function buildExtension() {
  return esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    loader: {
      '.node': 'file'
    },
    external: ['vscode'],
    logLevel: 'warning',
    plugins: [
      esbuildProblemMatcherPlugin,
      {
        name: 'handle-esm-in-commonjs',
        setup(build) {
          // Handle specific ESM modules that use top-level await
          build.onResolve({ filter: /pkce-challenge/ }, args => {
            return {
              path: args.path,
              external: true
            };
          });
        }
      }
    ],
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"'
    }
  });
}

// Create webview bundle
async function buildWebview() {
  // First, make sure the dist/webview directory exists
  if (!fs.existsSync('dist/webview')) {
    fs.mkdirSync('dist/webview', { recursive: true });
  }

  return esbuild.build({
    entryPoints: ['src/webview/index.tsx'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'dist/webview/webview.js',
    loader: {
      '.ts': 'tsx',
      '.tsx': 'tsx',
      '.js': 'jsx',
      '.jsx': 'jsx',
      '.json': 'json',
      '.css': 'css'
    },
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"'
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
    external: [],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Explicitly alias the problematic imports to their actual paths
    //   '/client/index': clientPath,
    //   : typesPath
    },
    plugins: [
      // Copy plugin to copy necessary webview assets
      postCssPlugin({
        postcss: {
          plugins: [require('@tailwindcss/postcss'), require('autoprefixer')],
        },
      }),
    ],
  });
}

// Copy webview HTML file
function copyWebviewHtml() {
  const webviewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Server Manager</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src 'unsafe-inline' vscode-resource:; style-src vscode-resource: 'unsafe-inline';">
  <script type="module" src="${production ? './webview.js' : './webview.js'}"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

  if (!fs.existsSync('dist/webview')) {
    fs.mkdirSync('dist/webview', { recursive: true });
  }
  fs.writeFileSync('dist/webview/index.html', webviewHtml);
}

const main = async () => {
  try {
    if (watch) {
      // In watch mode, use contexts
      const extensionCtx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        loader: {
          '.node': 'file'
        },
        external: ['vscode'],
        logLevel: 'warning',
        plugins: [
          esbuildProblemMatcherPlugin,
          {
            name: 'handle-esm-in-commonjs',
            setup(build) {
              // Handle specific ESM modules that use top-level await
              build.onResolve({ filter: /pkce-challenge/ }, args => {
                return {
                  path: args.path,
                  external: true
                };
              });
            }
          }
        ],
        define: {
          'process.env.NODE_ENV': production ? '"production"' : '"development"'
        }
      });

      const webviewCtx = await esbuild.context({
        entryPoints: ['src/webview/index.tsx'],
        bundle: true,
        format: 'esm',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',
        outfile: 'dist/webview/webview.js',
        loader: {
          '.ts': 'tsx',
          '.tsx': 'tsx',
          '.js': 'jsx',
          '.jsx': 'jsx',
          '.json': 'json',
          '.css': 'css'
        },
        define: {
          'process.env.NODE_ENV': production ? '"production"' : '"development"'
        },
        resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
        external: [],
        alias: {
          '@': path.resolve(__dirname, 'src'),
          // Explicitly alias the problematic imports to their actual paths
    //   '/client/index': clientPath,
    //   : typesPath
        },
        plugins: [
          // Copy plugin to copy necessary webview assets
          postCssPlugin({
            postcss: {
              plugins: [require('@tailwindcss/postcss'), require('autoprefixer')],
            },
          }),
        ],
      });

      copyWebviewHtml();
      
      console.log('Watching for changes...');
      // Use .then() instead of await at the top level
      return Promise.all([
        extensionCtx.watch(),
        webviewCtx.watch()
      ]);
    } else {
      // One-time build
      await Promise.all([
        buildExtension(),
        buildWebview()
      ]);
      copyWebviewHtml();
    }
  } catch (error) {
    console.error('Build error:', error);
    process.exit(1);
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
