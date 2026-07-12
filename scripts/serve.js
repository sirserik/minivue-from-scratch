// A tiny static server on bare Node — for opening the playground.
// Why a server at all if it's just HTML? The browser forbids importing ES modules
// (import ... from) from the file:// scheme. We need http://, so we serve the
// project folder over http. No dependencies — only Node's built-in modules.
//
// Run:   node scripts/serve.js       (default port 5173)
// Open:  http://localhost:5173/playground/01-reactivity.html
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || 5173

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = http.createServer((req, res) => {
  // Strip the query string and guard against escaping the project folder.
  let urlPath = decodeURIComponent(req.url.split('?')[0])
  if (urlPath === '/') urlPath = '/playground/index.html'
  const filePath = path.join(ROOT, path.normalize(urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('404: ' + urlPath)
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream'
    // no-store — so the browser NEVER caches the modules. Otherwise, after edits,
    // a mix of old and new versions gets pulled in → hard-to-track bugs.
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`MiniVue playground: http://localhost:${PORT}/playground/`)
})
