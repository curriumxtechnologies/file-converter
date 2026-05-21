const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
};

http.createServer((req, res) => {
  // ✅ Cross-origin isolation headers — required for SharedArrayBuffer
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  
  // Prevent caching issues during development
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
  
  // Security: Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`404: ${req.url}`);
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>404 - File Not Found</h1>");
      return;
    }
    
    // Special headers for WASM files
    if (ext === ".wasm") {
      res.setHeader("Content-Type", "application/wasm");
    }
    
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🔒 COOP/COEP headers enabled for SharedArrayBuffer`);
});