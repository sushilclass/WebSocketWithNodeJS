//import Logger from "./Logger";

export class JsonHelper {
    jsonStr: string;
    opt: Options;
    obj: any;
    

    /**
     * Converts buffer stream to string.
     *
     * @param {*} bufferOne
     * @returns {string}
     * @memberof JsonHelper
     */
    public init(bufferOne: any) {
        this.jsonStr = bufferOne.toString("utf8");
        this.createObject(this.jsonStr);
    };

    /**
     * Converts string to object.
     *
     * @param {string} jsonStr
     * @returns {boolean}
     * @memberof JsonHelper
     */
    private createObject(jsonStr:string):boolean {
        try {
            this.opt = JSON.parse(jsonStr);
            this.obj = JSON.parse(jsonStr);
        } catch (e) {
            //Logger.log("Received non-JSON");
            return false;
        }
        return true;
    }

    /**
     * getObject
     */

    public getOptions():Options {
        return this.opt;
    }

    
}

export interface Options {
    ActionArray?: [];
    Action?: string;
    AppName?: string;
    RevitWsSessionId?: string;
    Value?: string;
    IdToken?: string;
    FromWebapp?: boolean;
    ValidTypes?: string;
}