// Node SSR server. For each page request it renders the app into an HTML string
// and serves the ready HTML with the embedded client script for hydration. All other
// paths (our ES modules) are served as static files.
//
//   node playground/07-ssr/server.js
//   open http://localhost:5174/
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToString } from '../../packages/server-renderer/index.js'
import { createVNode } from '../../packages/runtime-core/vnode.js'
import { App } from './app.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = process.env.PORT || 5174

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
}

const page = (appHtml) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>MiniVue · SSR</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
      .card { border: 1px solid #e3e6ea; border-radius: 12px; padding: 20px; background: #fbfcfd; }
      .counter { display: flex; align-items: center; gap: 16px; font-size: 22px; }
      button { font-size: 18px; width: 40px; height: 40px; border: 1px solid #cdd2d8; border-radius: 8px; background: #fff; cursor: pointer; }
      button:hover { background: #f0f2f5; }
    </style>
  </head>
  <body>
    <!-- The server placed the already-rendered HTML here: -->
    <div id="app">${appHtml}</div>
    <!-- And this script will "bring it to life" on the client: -->
    <script type="module" src="/playground/07-ssr/client.js"></script>
  </body>
</html>`

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0])

  // Home page — server-render the app into a string.
  if (urlPath === '/' || urlPath === '/index.html') {
    const appHtml = renderToString(createVNode(App))
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page(appHtml))
    return
  }

  // Everything else — static files (our modules) so the client can import them.
  const filePath = path.join(ROOT, path.normalize(urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('404')
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`MiniVue SSR: http://localhost:${PORT}/`)
})
