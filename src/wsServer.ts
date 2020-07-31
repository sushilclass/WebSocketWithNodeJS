const WebSocket = require('ws')
const uuidv4 = require('uuid/v4');
const fs = require('fs')
import jwt = require('jsonwebtoken');

//Our tenant id. Not used in development build
let TID = process.env.TID || "7b8f7acc-e1c0-467a-86e9-678144da7881";
//Program will need to work for "production"
let BUILD = process.env.BUILD || "development";

var azureSignatures;
let wss;
// let logInputFilename = "wsserver-input.json";
// let logOutputFilename = "wsserver-output.json";
let logRevitSelectionJson = "wsserver-revitCurrentSelection.json";
var revitJsonObjs: { oid: string, RevitWsSessionId: string, obj: any }[] = [];
import { JsonHelper, Options } from "./jsonHelper";

//let envvar = new envVar();

function noop() { }

function heartbeat() {
    //Logger.log("Heartbeat.");
    this.isAlive = true;
}

const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) { return ws.terminate(); }
        ws.isAlive = false;
        ws.ping(noop);
    });
}, 30000);



export default class WsServer {
    noop() { }
    start(port, azureSignaturesHold) {
        azureSignatures = azureSignaturesHold;
        wss = new WebSocket.Server({
            port,
            perMessageDeflate: {
                clientNoContextTakeover: true, // Defaults to negotiated value.
                serverNoContextTakeover: true, // Defaults to negotiated value.
            },
        });


        wss.on("connection", function connection(ws) {
            log("Connection/Message with client at " + ws._socket.remoteAddress);
            //tokenDecode();
            ws.id = uuidv4();

            let client = ws;
            ws.isAlive = true;
            ws.ping(noop);
            ws.on("message", async function incoming(bufferOne) {
                log("Message from client at " + ws._socket.remoteAddress);
                let jsonHelper = new JsonHelper();
                jsonHelper.init(bufferOne);
                var opt: Options = jsonHelper.getOptions();
                let optStr = JSON.stringify([opt]);

                //log("IdToken Encoded: " + opt.IdToken);
                if (opt.IdToken != null) {
                    let IdToken = tokenDecode(opt.IdToken);
                    if (IdToken != null) {
                        log("IdToken Decoded: " + JSON.stringify(IdToken));
                        //let IdToken //= jwtDecode(opt.IdToken);
                        let oid = IdToken.oid;
                        if (ws.clientType == null) {
                            if (opt.FromWebapp == true) {
                                ws.clientType = "Webapp";
                            }
                            else {
                                ws.clientType = "Revit";
                            }
                        }
                        if (ws.appName != opt.AppName) {
                            ws.appName = opt.AppName
                        }
                        log("Message Action {" + opt.Action + "} AppName {" + opt.AppName + "} source {" + ws.clientType + "} email {" + IdToken.preferred_username + "} ");
                        if (opt.Action == "setOidRevitClient" || ws.userOidRevitClient == null) {
                            ws.userOidRevitClient = oid;
                            if (opt.AppName == "Properties GUI") {
                                var revitObj:any = [];
                                storeData(revitObj, logRevitSelectionJson);
                                if (revitObj != null) {
                                    let success = actionRevitSetJsonObj(revitObj, revitJsonObjs, ws, oid);
                                    if (success) {
                                        //Will update any associated webapp clients
                                        updateAssociatedWebClients(oid, opt.AppName);
                                        //Will send hasWebAppClient action if there are associated webapp client
                                        updateAssociatedRevitClients(wss, oid, opt.AppName, "TRUE");
                                    }
                                }
                            }
                        }
                        if (opt.FromWebapp == true && ws.userOidWebClient == null) {
                            ws.userOidWebClient = oid;
                            var actionArray: any;
                            if (oid != null && oid != "" && opt.AppName != null) {
                                updateAssociatedRevitClients(wss, oid, opt.AppName, "TRUE");
                            }
                        }
                        if (opt.AppName == "Properties GUI") {
                            processPropertiesGuiActions(opt, oid, ws.clientType, jsonHelper, ws)
                        }
                        //todo Chetu
                        //After getting this to work only real values like "Coordination Configuration GUI" are acceptable
                        if (opt.AppName == "Coordination Configuration GUI") {
                            processCoordinationConfigurationGuiActions(opt, oid, ws.clientType, jsonHelper, ws)
                        }
                    }
                }

            });

            ws.on("error", function connection() {
                log("Connection Error with client at " + ws._socket.remoteAddress);
            });

            ws.on("close", function () {
                let message = "Connection Closed with client at " + ws._socket.remoteAddress;
                removeRevitJsonObj(revitJsonObjs, ws);
                if (ws.appName != null) {
                    message += " AppName {" + ws.appName + "}";
                    if (ws.clientType == "Revit" && ws.userOidRevitClient != null) {
                        updateAssociatedWebClients(ws.userOidRevitClient, ws.appName);
                        message += " source {" + ws.clientType + "}";
                    }
                    if (ws.clientType == "Webapp" && ws.userOidWebClient != null) {
                        updateAssociatedRevitClients(wss, ws.userOidWebClient, ws.appName, "FALSE");
                        message += " source {" + ws.clientType + "}";
                    }
                }
                log(message);
            });

            ws.on("open", function () {
                log("Connection Opened:" + Date.now());
            });
            ws.on('pong', heartbeat);
        });

        function processPropertiesGuiActions(opt: Options, oid, clientType, jsonHelper, ws) {
            if (clientType == "Webapp") {
                if (opt.Action == "getJsonAll") {
                    actionSendRevitJsonObj(ws, oid);
                }
                if (opt.RevitWsSessionId != null) {
                    if (opt.Action == "setParameter" || opt.Action == "changeType"
                        || opt.Action == "showTypeProperties" || opt.Action == "showElement"
                        || opt.Action == "phaseCreated" || opt.Action == "phaseDemolished"
                        || opt.Action == "SelectWireType" || opt.Action == "SelectWorkSet"
                        || opt.Action == "SelectDistributionSystem" || opt.Action == "SelectScheduleLevel"
                        || opt.Action == "SelectModel" || opt.Action == "SelectPowerFactor" || opt.Action == "SendSelectionValue") {
                        let actionWs = getActionWs(opt.RevitWsSessionId, opt.AppName, ws);
                        if (actionWs != null) {
                            var actionArray;
                            if (opt.ActionArray != undefined) {
                                actionArray = opt.ActionArray;
                            } else {
                                actionArray = [opt];
                            }
                            actionWs.send(JSON.stringify(actionArray));
                            log(JSON.stringify(actionArray));
                        }
                    }
                }
            }
            if (clientType == "Revit") {
                if (opt.Action == "clearRevitSelection" || opt.Action == "displayMessage") {
                    var revitObj:any = [];
                    storeData(revitObj, logRevitSelectionJson);
                    if (revitObj != null) {
                        let success = actionRevitSetJsonObj(revitObj, revitJsonObjs, ws, oid);
                        if (success && opt.Action == "clearRevitSelection") {
                            updateAssociatedWebClients(oid, opt.AppName);
                        }
                        if(success && opt.Action == "displayMessage"){
                            let message:string = opt.Value;
                            updateAssociatedWebClients(oid, opt.AppName,message);
                        }
                    }
                }
                if (opt.Action == "setSelectionObject" && jsonHelper.obj != null) {
                    var revitObj:any = JSON.parse(opt.Value);

                    storeData(revitObj, logRevitSelectionJson);
                    if (revitObj != null) {
                        let success = actionRevitSetJsonObj(revitObj, revitJsonObjs, ws, oid);
                        if (success) {
                            updateAssociatedWebClients(oid, opt.AppName);
                        }
                    }
                }
            }
        }

        function processCoordinationConfigurationGuiActions(opt: Options, oid, clientType, jsonHelper, ws) {
            //todo Chetu
            if (opt.Action == "getJsonAllMechanicalGUI") {
                //var _clientId = "phase4";
                actionSendRevitJsonObj(ws, oid);
            }
            if (opt.RevitWsSessionId != null) {
                if (opt.Action == "setParameter" || opt.Action == "changeType" || opt.Action == "showTypeProperties"
                    || opt.Action == "showElement" || opt.Action == "sendParameter" || opt.Action == "sendMechGUID" || opt.Action == "refreshMechGUID"
                    || opt.Action == "sendElectricalGUID" || opt.Action == "sendControlGUID" || opt.Action == "Recalculate"
                    || opt.Action == "SendUniqueId") {
                    let actionWs = getActionWs(opt.RevitWsSessionId, opt.AppName, ws);
                    if (actionWs != null) {
                        var actionArray;
                        if (opt.ActionArray != undefined) {
                            actionArray = opt.ActionArray;
                        } else {
                            actionArray = [opt];
                        }
                        actionWs.send(JSON.stringify(actionArray));
                        log(JSON.stringify(actionArray));
                    }
                }
            }

            if (opt.Action == "setSelectionObject" && jsonHelper.obj != null) {
                var revitObj = JSON.parse(opt.Value);

                storeData(revitObj, logRevitSelectionJson);
                if (revitObj != null) {
                    let success = actionRevitSetJsonObj(revitObj, revitJsonObjs, ws, oid);
                    if (success) {
                        updateAssociatedWebClients(oid, opt.AppName);
                    }
                }
            }
        }

        function getActionWs(revitWsSessionId, appName, ws) {
            if (ws.id === revitWsSessionId) {
                //Is this still needed?
                return getRandomOtherClientId(ws.id);
            } else {
                return getClientById(wss, revitWsSessionId, appName)
            }
        }

        function log(value) {
            var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
            var localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);

            console.log(localISOTime + "CST: " + value);
        }
        //return null if fails
        //returns token if successful
        function tokenDecode(token: string): any {
            let result;
            let tokenSplit = token.split('.');
            // get the decoded payload and header
            var decoded = jwt.decode(token, { complete: true });
            if (decoded != null && decoded.header != null && decoded.payload != null
                && decoded.header.kid != null && decoded.payload.oid != null && tokenSplit.length == 3) {

                if (decoded.payload.tid == TID || BUILD != "production") {
                    for (let index = 0; index < azureSignatures.keys.length; index++) {
                        const azureKid = azureSignatures.keys[index].kid;
                        if (decoded.header.kid == azureKid) {
                            let pubKeys = azureSignatures.keys[index].x5c;
                            //There should only be one
                            for (let index2 = 0; index2 < pubKeys.length; index2++) {
                                const pubKey = `-----BEGIN CERTIFICATE-----\n${pubKeys[index2]}\n-----END CERTIFICATE-----`;

                                try {
                                    //Fails if pubKey is not verified and if token expired.
                                    let tokenResult = jwt.verify(token, pubKey);
                                    //Fail will not go to this next line
                                    result = tokenResult;
                                } catch (err) {
                                    log("ERROR in IdToken Decoding: " + err);
                                    // err
                                }
                            }
                        }
                    }
                }
                if (BUILD == "tokenTest") {
                    result = decoded.payload;
                }
            }
            return result;
        }
        function storeData(data, path) {
            try {
                fs.writeFileSync(path, JSON.stringify(data), null, 2)
            } catch (err) {
                console.error(err)
            }
        }
        function actionRevitSetJsonObj(revitObj, _revitJsonObjs, ws, oid): boolean {
            var success: boolean;
            if (oid != null && oid != "") {
                success = true;
                //Checks to see if object as already been set for revit session.
                let update: boolean = hasRevitJsonObj(_revitJsonObjs, ws, oid)
                if (update) {
                    updateRevitJsonObj(revitObj, _revitJsonObjs, ws, oid);
                }
                else {
                    addNewRevitJsonObjs(revitObj, _revitJsonObjs, ws, oid);
                }
            } else {
                success = false;
                ws.send(`[{"action":"displayMessage","value":"Id_Token unknown issue for web GUI. Contact Administrator."}]`);
            }
            return success;
        }

        function updateAssociatedWebClients(oid, appName,message=null) {
            let matchingWebClientsWS = getWebClientSessionIdsByOidAndAppname(wss, oid, appName);
            matchingWebClientsWS.forEach(function (WebClientWS) {
                actionSendRevitJsonObj(WebClientWS, oid,message);
            });
        }

        function updateAssociatedRevitClients(_wss, oid, appName, value) {
            let matchingWebClientsWS = getWebClientSessionIdsByOidAndAppname(wss, oid, appName);
            if ((matchingWebClientsWS.length < 1 && value=="FALSE")||(matchingWebClientsWS.length > 0 && value=="TRUE")) {
                let wsClient = getRevitClientById(_wss, oid, appName);
                if (wsClient != null) {
                    var optAction: Options = {};
                    optAction.RevitWsSessionId = wsClient.userOidRevitClient;
                    optAction.AppName = appName;
                    optAction.Action = "hasWebAppClient";
                    optAction.Value = value;
                    wsClient.send(JSON.stringify([optAction]));
                    log(JSON.stringify([optAction]));
                }
            }
        }

        function addNewRevitJsonObjs(revitObj, _revitJsonObjs, ws, oid) {
            addSessionIdToRevitJsonObjs(revitObj, ws);
            _revitJsonObjs.push({ oid: oid, RevitWsSessionId: ws.id, obj: revitObj });
        }

        function updateRevitJsonObj(revitObj, _revitJsonObjs, ws, oid) {
            addSessionIdToRevitJsonObjs(revitObj, ws);
            let revitJsonObj = getRevitJsonObj(_revitJsonObjs, ws, oid);
            if (revitJsonObj != null) {
                revitJsonObj.obj = revitObj;
                revitJsonObj.RevitWsSessionId = ws.id;
            }
        }

        function addSessionIdToRevitJsonObjs(revitObj, ws) {
            revitObj.forEach(function (obj) {
                obj.RevitWsSessionId = ws.id;
            });
        }

        function hasWebAppClientAction(ws, oid, appName): boolean {
            var matchingWebAppClient: boolean = false;
            let matchingWebClientsWS = getWebClientSessionIdsByOidAndAppname(wss, oid, appName);
            if (matchingWebClientsWS != null && matchingWebClientsWS.length > 0) {
                matchingWebAppClient = true;
            }
            return matchingWebAppClient;
        }

        function getRevitJsonObj(_revitJsonObjs, ws, oid): any {
            let revitJsonObjMatch;
            _revitJsonObjs.forEach(function (revitJsonObj) {
                if (revitJsonObj.oid == oid) {
                    revitJsonObjMatch = revitJsonObj;
                }
            });
            return revitJsonObjMatch;
        }

        function removeRevitJsonObj(_revitJsonObjs, ws): any {
            let revitJsonObjMatch;
            _revitJsonObjs.forEach(function (revitJsonObj, index, object) {
                if (revitJsonObj.RevitWsSessionId == ws.id) {
                    object.splice(index, 1);
                }
            });
            return revitJsonObjMatch;
        }

        function hasRevitJsonObj(_revitJsonObjs, ws, oid): boolean {
            let found: boolean = false;
            _revitJsonObjs.forEach(function (revitJsonObj) {
                if (revitJsonObj.oid == oid) {
                    found = true;
                }
            });
            return found;
        }

        function actionHasWebAppClient(ws, oid) {
            let warn = true;
            let warning = "No matching Revit Session found.";
            if (revitJsonObjs.length > 0) {
                let revitObj = findRevitJsonObjByOid(oid);
                if (revitObj != null) {
                    if (revitObj.length > 0) {
                        warn = false;
                        //Should send compress data
                        ws.send(JSON.stringify(revitObj));
                    } else {
                        warning = "No selection in revit.";
                    }
                }
            }
            if (warn) {
                ws.send('{"warning":"' + warning + '"}');
            }
        }

        function actionSendRevitJsonObj(ws, oid,message=null) {
            let warn = true;
            let warning = "No matching Revit Session found.";
            if (revitJsonObjs.length > 0) {
                let revitObj = findRevitJsonObjByOid(oid);
                if (revitObj != null) {
                    if (revitObj.length > 0) {
                        warn = false;
                        //Should send compress data
                        ws.send(JSON.stringify(revitObj));
                    } else {
                        if(message==null){
                            warning = "No selection in revit.";
                        }else{
                            warning = message;
                        }
                        
                    }
                }
            }
            if (warn) {
                ws.send('{"warning":"' + warning + '"}');
            }
        }

        function findRevitJsonObjByOid(oid: string): any {
            var objFound;
            revitJsonObjs.forEach(element => {
                if (element.oid == oid) {
                    objFound = element.obj;
                }
            });
            return objFound;
        }

        function getRandomOtherClientId(id) {
            var wsClient;
            wss.clients.forEach(function each(ws) {
                if (ws.id != id) {
                    wsClient = ws;
                }
            });
            return wsClient;
        }

        function getWebClientSessionIdsByOidAndAppname(_wss, oid, appName): any[] {
            var wsClient = [];
            _wss.clients.forEach(function each(_ws) {
                if (_ws.userOidWebClient == oid && _ws.appName == appName) {
                    wsClient.push(_ws);
                }
            });
            return wsClient;
        }

        function getClientById(_wss, id, appName) {
            var wsClient;
            _wss.clients.forEach(function each(_ws) {
                if (_ws.id == id && _ws.appName == appName) {
                    wsClient = _ws;
                }
            });
            return wsClient;
        }

        function getRevitClientById(_wss, id, appName) {
            var wsClient;
            _wss.clients.forEach(function each(_ws) {
                if (_ws.appName == appName && _ws.userOidRevitClient == id && _ws.clientType == "Revit") {
                    wsClient = _ws;
                }
            });
            return wsClient;
        }
    }

    close() {
        wss.close(() => {

        });
    }

}