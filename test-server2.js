const http = require('http');

const port = 51121;
const callbackPath = "/oauth-callback";

const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    console.log("Got request:", req.url, "->", url.pathname);
    
    if (url.pathname === callbackPath) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Authentication Successful!</h1><p>You may close this window.</p></body></html>");
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
    }
});

server.listen(port, "127.0.0.1", () => {
    console.log("Listening on", port);
});
