// Крошечный статический сервер на голом Node — чтобы открывать playground.
// Зачем вообще сервер, если это просто HTML? Браузер запрещает импорт ES-модулей
// (import ... from) со схемы file://. Нужен http://, поэтому раздаём папку
// проекта по http. Никаких зависимостей — только встроенные модули Node.
//
// Запуск:  node scripts/serve.js       (по умолчанию порт 5173)
// Открыть: http://localhost:5173/playground/01-reactivity.html
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
  // Отрезаем query-строку и защищаемся от выхода за пределы папки проекта.
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
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`MiniVue playground: http://localhost:${PORT}/playground/`)
})
