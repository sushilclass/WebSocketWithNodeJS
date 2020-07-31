import * as express from 'express';
import WsServer from "./wsServer";
const fetch = require("node-fetch");
var compression = require('compression');
const bodyParser = require('body-parser');
const https = require("https");

const app = express();
const jsonFileSizeLimit = '50mb';
//let PORT = process.env.PORT || "4002";
let PORT = process.env.PORT || 80;
// let HOST = process.env.HOST || "http://localhost";
let WSHOST = process.env.WSHOST || "ws(s)://0.0.0.0";
let urlSignatureKeys = process.env.URLSIGNKEYS || 'https://login.microsoftonline.com/common/discovery/keys';

//look at compression for response later
app.use(compression())
app.use(bodyParser.json({ limit: jsonFileSizeLimit, extended: true }))

//app.use('/static', express.static('public')).listen( PORT );

// console.log(`Webapp running at ${HOST}:${PORT}/`);
const wsServer = new WsServer();

const request = async () => {
    const agent = new https.Agent({
        rejectUnauthorized: false
      })
    const response = await fetch(urlSignatureKeys, { agent });
    //We need to handle when errors on fetch
    let azureSignatures = await response.json();
    wsServer.start(PORT,azureSignatures);
    console.log(`Websocket running at ${WSHOST}:${PORT}/`);
}
request();

