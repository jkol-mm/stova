import { defineConfig } from 'vite'
import { resolve } from 'path'
import https from 'https'
import zlib from 'zlib'
import { obfuscator } from 'rollup-obfuscator'
import viteImagemin from 'vite-plugin-imagemin'
import { createProxyMiddleware } from 'http-proxy-middleware'
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
import path from 'path'
import process from 'process'

const configPath = path.resolve(process.cwd(), 'config.json')
const config = require(configPath)

function getEntries(dir, ext) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.startsWith('_'))
    .map((f) => resolve(dir, f))
}

function getCssLinks() {
  try {
    return fs
      .readdirSync('src/scss')
      .filter((f) => f.endsWith('.scss') && !f.startsWith('_'))
      .map((f) => `<link rel="stylesheet" href="/src/scss/${f}">`)
      .join('\n')
  } catch {
    return ''
  }
}

function getJsScripts() {
  try {
    return fs
      .readdirSync('src/js')
      .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
      .map((f) => `<script type="module" src="/src/js/${f}"></script>`)
      .join('\n')
  } catch {
    return ''
  }
}

function htmlProxyInjectPlugin() {
  const isBlank = config.blankMode === true || process.env.BLANK === '1'
  const blankModeStyle = {
    match: /<link\s+href="https:\/\/cdn\.myshoptet\.com\/prj\/[^"]+"[^>]*>/gi,
    fn: function () {
      return ''
    },
  }

  const distFiles = [
    ...fs
      .readdirSync('src/scss')
      .filter((f) => f.endsWith('.scss') && !f.startsWith('_'))
      .map((f) => f.replace('.scss', '.css')),
    ...fs.readdirSync('src/js').filter((f) => f.endsWith('.js') && !f.startsWith('_')),
  ]

  const userDocumentsLink = {
    match: new RegExp(
      `<link[^>]+href=["'].*?/user/documents/.*?/(?:${distFiles
        .map((f) => f.replace('.', '\\.'))
        .join('|')})(?:\\.min)?\\.css["'][^>]*>`,
      'gi'
    ),
    fn: function () {
      return ''
    },
  }

  const userDocumentsScript = {
    match: new RegExp(
      `<script[^>]+src=["'].*?/user/documents/.*?/(?:${distFiles
        .map((f) => f.replace('.js', ''))
        .join('|')})(?:\\.min)?\\.js["'][^>]*>.*?<\/script>`,
      'gi'
    ),
    fn: function () {
      return ''
    },
  }

  return {
    name: 'html-proxy-inject',
    configureServer(server) {
      const proxyTarget = config.sourceUrl.replace(/\/$/, '')

      // Proxy API endpoints (/action) using http-proxy-middleware to preserve methods, bodies and streaming
      server.middlewares.use(
        '/action',
        createProxyMiddleware({
          target: proxyTarget,
          changeOrigin: true,
          ws: false,
          logLevel: process.env.PROXY_LOG ? 'debug' : 'silent',
          onProxyReq(proxyReq, req, res) {
            // ensure host header matches target
            proxyReq.setHeader('host', new URL(proxyTarget).host)
          },
          onProxyRes(proxyRes, req, res) {
            // forward Set-Cookie from upstream
            if (proxyRes.headers && proxyRes.headers['set-cookie']) {
              res.setHeader('set-cookie', proxyRes.headers['set-cookie'])
            }
          },
        })
      )

      // Fallback HTML injector for root-like requests
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        const pathname = url.split('?')[0]
        // only handle HTML-like routes: no file extension and not vite internal
        if (!pathname.includes('.') && !url.startsWith('/@') && req.method === 'GET') {
          const targetUrl = proxyTarget + url
          try {
            const target = new URL(targetUrl)
            const options = {
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port || (target.protocol === 'https:' ? 443 : 80),
              path: target.pathname + target.search,
              headers: { ...req.headers, host: target.host },
              method: 'GET',
            }

            const proxyReq = https.request(options, (proxyRes) => {
              const chunks = []
              proxyRes.on('data', (c) => chunks.push(c))
              proxyRes.on('end', () => {
                let bodyBuffer = Buffer.concat(chunks)
                try {
                  const enc = (proxyRes.headers['content-encoding'] || '').toLowerCase()
                  if (enc === 'br') bodyBuffer = zlib.brotliDecompressSync(bodyBuffer)
                  else if (enc === 'gzip' || enc === 'x-gzip')
                    bodyBuffer = zlib.gunzipSync(bodyBuffer)
                  else if (enc === 'deflate') bodyBuffer = zlib.inflateSync(bodyBuffer)
                } catch (e) {
                  // if decompression fails, continue with raw buffer
                }

                let html = bodyBuffer.toString('utf8')

                if (isBlank) html = html.replace(blankModeStyle.match, blankModeStyle.fn)

                // inject vite client and local assets
                html = html.replace(
                  '</head>',
                  '<script type="module" src="/@vite/client"></script>\n</head>'
                )
                html = html.replace('</head>', `${getCssLinks()}\n</head>`)
                html = html.replace('</body>', `${getJsScripts()}\n</body>`)

                // remove user documents references
                html = html.replace(userDocumentsLink.match, userDocumentsLink.fn)
                html = html.replace(userDocumentsScript.match, userDocumentsScript.fn)

                // forward Set-Cookie if present
                if (proxyRes.headers && proxyRes.headers['set-cookie']) {
                  res.setHeader('set-cookie', proxyRes.headers['set-cookie'])
                }

                res.statusCode = proxyRes.statusCode || 200
                res.setHeader('content-type', 'text/html')
                res.end(html)
              })
            })

            proxyReq.on('error', (err) => {
              res.statusCode = 502
              res.end('Proxy error: ' + err.message)
            })

            proxyReq.end()
          } catch (e) {
            res.statusCode = 500
            res.end('Proxy error: ' + e.message)
          }
        } else {
          next()
        }
      })
    },
  }
}

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
  base: './',
  root: '.',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: (() => {
        const jsEntries = getEntries('src/js', '.js').map((f) => ({
          name: 'js-' + path.basename(f, '.js'),
          path: f,
        }))
        const scssEntries = getEntries('src/scss', '.scss').map((f) => ({
          name: 'scss-' + path.basename(f, '.scss'),
          path: f,
        }))
        const allEntries = [
          ...jsEntries.map((e) => [e.name, e.path]),
          ...scssEntries.map((e) => [e.name, e.path]),
        ]
        if (allEntries.length === 0) {
          throw new Error(
            'Ve složkách src/js ani src/scss nejsou žádné vstupní soubory. Přidejte alespoň jeden .js nebo .scss soubor.'
          )
        }
        return Object.fromEntries(allEntries)
      })(),
      output: {
        entryFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.startsWith && assetInfo.name.startsWith('scss-'))
            return 'css/[name].min.css'
          if (assetInfo.name && assetInfo.name.startsWith && assetInfo.name.startsWith('js-'))
            return 'js/[name].min.js'
          return '[name].min[extname]'
        },
        chunkFileNames: 'js/[name]-[hash].min.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && /\.(css)$/.test(assetInfo.name)) return 'css/[name].min[extname]'
          if (assetInfo.name && /\.(js)$/.test(assetInfo.name)) return 'js/[name].min[extname]'
          return 'assets/[name][extname]'
        },
      },
    },
  },
  css: { preprocessorOptions: { scss: {} } },
  server: { port: 3010, open: false, watch: { usePolling: true } },
  plugins: [
    htmlProxyInjectPlugin(),
    ...(isProd
      ? [
          obfuscator({
            compact: true,
            controlFlowFlattening: false,
            deadCodeInjection: false,
            debugProtection: false,
            disableConsoleOutput: true,
            identifierNamesGenerator: 'hexadecimal',
            numbersToExpressions: true,
            renameGlobals: false,
            selfDefending: true,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 2,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 2,
            stringArrayWrappersType: 'function',
            stringArrayThreshold: 0.25,
            unicodeEscapeSequence: false,
          }),
          viteImagemin({
            gifsicle: { optimizationLevel: 7, interlaced: false },
            optipng: { optimizationLevel: 7 },
            mozjpeg: { quality: 80 },
            pngquant: { quality: [0.7, 0.9], speed: 3 },
            svgo: { plugins: [{ name: 'removeViewBox', active: false }] },
            webp: { quality: 80 },
          }),
        ]
      : []),
  ],
})
