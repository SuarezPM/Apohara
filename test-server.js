const http = require('http');
const server = http.createServer((req, res) => {
    console.log("Got request:", req.url);
    res.end("OK");
});
server.listen(51121, () => {
    console.log("Listening on 51121");
    setTimeout(() => server.close(), 1000);
});
