const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

// For production on Render, frontend files are in the same directory
// But since you're hosting separately, we'll serve from a 'public' folder or handle CORS
const FRONTEND_PATH = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, "public")  // For combined hosting
  : path.join(__dirname, "..", "frontend"); // For local development

// Enable CORS for frontend static site
const enableCORS = (res) => {
  const allowedOrigins = [
    'http://localhost:5500',
    'http://localhost:3000',
    'https://filesconverter.curriumx.online/' // Replace with your actual frontend URL
  ];
  const origin = process.env.FRONTEND_URL || 'https://your-frontend.onrender.com';
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const server = http.createServer((req, res) => {
  console.log(`📡 ${req.method} ${req.url}`);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    enableCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }
  
  // CRITICAL: These headers enable SharedArrayBuffer for FFmpeg
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  
  // Enable CORS for frontend
  enableCORS(res);
  
  // Handle API status endpoint
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "ok", 
      coop: "same-origin", 
      coep: "require-corp",
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // For backend service, we only need API endpoints
  // Static files are handled by the frontend service
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "healthy", 
      service: "file-converter-backend",
      headers: {
        coop: "same-origin",
        coep: "require-corp"
      }
    }));
    return;
  }
  
  // If trying to access static files, return 404 (frontend handles these)
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found - this is an API server" }));
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔒 COOP/COEP headers enabled for SharedArrayBuffer`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});