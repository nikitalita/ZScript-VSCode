/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-prototype-builtins */
import { DebugProtocol as DAP } from '@vscode/debugprotocol';
import * as path from 'path';
import { DAPLogLevel, DebugAdapterProxy, DebugAdapterProxyOptions } from './DebugAdapterProxy';
import { Response, Message } from '@vscode/debugadapter/lib/messages';
import * as vscode from 'vscode';

if (vscode) {
    vscode;
}

export enum ErrorDestination {
    User = 1,
    Telemetry = 2,
}

export interface GZDoomDebugAdapterProxyOptions extends DebugAdapterProxyOptions {
    projectPath?: string;
    projectArchive: string;
}

type responseCallback = (response: DAP.Response, request: DAP.Request) => void;

interface pendingRequest {
    cb: responseCallback;
    request: DAP.Request;
    noLogResponse: boolean;
}

const GZDOOM_DAP_LOCALE = {
    linesStartAt1: true,
    columnsStartAt1: true,
    pathsAreURIs: false,
};
const DEFAULT_TIMEOUT = 1000000;

class CustomSet<T> implements Set<T> {
    private items: T[] = [];
    private comparator: (a: T, b: T) => boolean;
    constructor(comparator, iterable?: Iterable<T>) {
        // instance a Comparator object
        this.comparator = comparator || ((a, b) => a === b);
        for (const item of iterable || []) {
            this.add(item);
        }
    }


    add(item: T): this {
        if (!this.has(item)) {
            this.items.push(item);
        }
        return this;
    }

    has(item: T): boolean {
        return this.items.some(existingItem => this.comparator(item, existingItem));
    }

    get(item: T): T | undefined {
        return this.items.find(existingItem => this.comparator(item, existingItem));
    }

    delete(item: T): boolean {
        const index = this.items.findIndex(existingItem => this.comparator(item, existingItem));
        if (index > -1) {
            this.items.splice(index, 1);
            return true;
        }
        return false;
    }

    get size(): number {
        return this.items.length;
    }

    clear(): void {
        this.items = [];
    }

    [Symbol.iterator](): SetIterator<T> {
        return this.items[Symbol.iterator]();
    }

    [Symbol.toStringTag]: string = 'CustomSet';

    forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
        this.items.forEach(item => callbackfn.call(thisArg, item, item, this));
    }

    entries(): SetIterator<[T, T]> {
        return this.items.entries() as SetIterator<[T, T]>;
    }

    keys(): SetIterator<T> {
        return this.items.keys() as SetIterator<T>;
    }

    values(): SetIterator<T> {
        return this.items.values() as SetIterator<T>;
    }
}

class ICaseSet extends CustomSet<string> {
    constructor(iterable?: Iterable<string>) {
        super((a, b) => a.toLowerCase() === b.toLowerCase(), iterable);
    }
}


// Usage example

// interface Set<T> {
//     /** Iterates over values in the set. */
//     [Symbol.iterator](): SetIterator<T>;
//     /**
//      * Returns an iterable of [v,v] pairs for every value `v` in the set.
//      */
//     entries(): SetIterator<[T, T]>;
//     /**
//      * Despite its name, returns an iterable of the values in the set.
//      */
//     keys(): SetIterator<T>;

//     /**
//      * Returns an iterable of values in the set.
//      */
//     values(): SetIterator<T>;
// }

export class GZDoomDebugAdapterProxy extends DebugAdapterProxy {

    private _pendingRequestsMap = new Map<number, pendingRequest>();
    private projectPath: string = '';
    private projectArchive: string | undefined = undefined;
    private onFinishedScanning = new vscode.EventEmitter<number | null>();
    private done_scanning_project = false;
    private launch_request_sent = false;
    private onSentLaunchRequest = new vscode.EventEmitter<number | null>();
    // Set of strings
    private sourcePaths: ICaseSet = new ICaseSet([]);
    private logServerToProxyReal: DAPLogLevel = 'info';

    private projectOrigin = '';
    // object name to source map
    constructor(options: GZDoomDebugAdapterProxyOptions) {
        const logdir = path.join(
            process.env.USERPROFILE || process.env.HOME || '.',
            'Documents',
            'My Games',
            'GZDoom',
            'Logs',
            'DAProxy'
        );
        options.logdir = options.logdir || logdir;
        options.debuggerLocale = GZDOOM_DAP_LOCALE;
        super(options);
        this.projectPath = options.projectPath || vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        this.scanProjectDirectoryForFiles(options.projectPath!);
        this.projectArchive = options.projectArchive;
        this.clientCaps.adapterID = 'gzdoom';
        this.logClientToProxy = 'info';
        this.logProxyToServer = 'trace';
        this.logServerToProxy = 'silent'; // we take care of this ourselves
        this.logServerToProxyReal = 'info';
        this.logProxyToClient = 'trace';
        this.projectArchive;
    }
    clearExecutionState() {
    }

    //overrides base class
    handleMessageFromServer(message: DAP.ProtocolMessage): void {
        if (message.type == 'response') {
            const response = <DAP.Response>message;
            const pending = this._pendingRequestsMap.get(response.request_seq);
            // The callbacks should handle all the responses we need to translate into the expected response objects
            if (pending) {
                if (!pending.noLogResponse) {
                    this.log(this.logServerToProxyReal, { message }, '---SERVER->PROXY:');
                }
                this._pendingRequestsMap.delete(response.request_seq);
                pending.cb(response, pending.request);
                return;
            }
            // just in case
            this.logwarn('!!!SERVER->PROXY - Received response with no callback!!!');
            this.sendMessageToClient(response);
        } else if (message.type == 'event') {
            const event = message as DAP.Event;
            if (event.event == 'output') {
                this.handleOutputEvent(event as DAP.OutputEvent);
            } else if (event.event == 'loadedSource') {
                const response = event as DAP.LoadedSourceEvent;
                response.body.source = this.convertDebuggerSourceToClient(response.body.source as DAP.Source);
                this.sendMessageToClient(response);
            } else {
                this.sendMessageToClient(event);
            }
        } else {
            this.sendMessageToClient(message);
        }
    }


    //overrides base class
    protected handleMessageFromClient(message: DAP.ProtocolMessage): void {
        const pmessage = message as DAP.ProtocolMessage;
        if (pmessage.type === 'request') {
            this.handleClientRequest(pmessage as DAP.Request);
        } else {
            // TODO: handle other message types
            this.sendMessageToServer(pmessage);
        }
    }

    handleOutputEvent(message: DAP.OutputEvent) {
        // The output messages don't have newlines, so just append one.
        // TODO: something with the rest of the fields?
        message.body.output += '\n';
        this.sendMessageToClient(message);
    }

    protected sendErrorResponse(
        response: DAP.Response,
        codeOrMessage: number | DAP.Message,
        format?: string,
        variables?: any,
        dest: ErrorDestination = ErrorDestination.User
    ): void {
        let msg: DAP.Message;
        if (typeof codeOrMessage === 'number') {
            msg = <DAP.Message>{
                id: <number>codeOrMessage,
                format: format,
            };
            if (variables) {
                msg.variables = variables;
            }
            if (dest & ErrorDestination.User) {
                msg.showUser = true;
            }
            if (dest & ErrorDestination.Telemetry) {
                msg.sendTelemetry = true;
            }
        } else {
            msg = codeOrMessage;
        }

        response.success = false;
        response.message = DebugAdapterProxy.formatPII(msg.format, true, msg.variables || {});
        if (!response.body) {
            response.body = {};
        }
        response.body.error = msg;
        this.log(
            'error',
            `***PROXY->CLIENT - Request '${response.command}' (seq: ${response.request_seq}) Failed: ${response.message}`
        );
        this.sendMessageToClient(response, true);
    }

    public sendRequestToServerWithCB(
        request: DAP.Request,
        timeout: number,
        cb: responseCallback,
        nolog: boolean = false
    ): void {
        this.sendMessageToServer(request, nolog);
        // check if cb
        this._pendingRequestsMap.set(request.seq, { cb, request, noLogResponse: nolog });
        if (timeout > 0) {
            const timer = setTimeout(() => {
                clearTimeout(timer);
                const pending = this._pendingRequestsMap.get(request.seq);
                if (pending?.cb) {
                    this._pendingRequestsMap.delete(request.seq);
                    pending.cb(new Response(request, 'timeout'), pending.request);
                }
            }, timeout);
        }
    }

    public sendRunInTerminalRequest(
        args: DAP.RunInTerminalRequestArguments,
        timeout: number,
        _cb: (response: DAP.RunInTerminalResponse) => void
    ) {
        const request = <DAP.RunInTerminalRequest>new Message('request');
        request.arguments = args;
        this.sendRequestToServerWithCB(request, timeout, (r, _req) => {
            r.command = 'runInTerminal';
        });
    }

    protected async scanProjectDirectoryForFiles(projectDirectory: string) {
        // these types of files:
        // (ext == ".zs" || ext == ".zsc" || ext == ".zc" || ext == ".acs" || ext == ".dec")
        // also files named exactly this:
        // (entry.path().filename() == "DECORATE" || entry.path().filename() == "ACS")
        const file_glob = '**/*.{zs,zsc,zc,acs,dec}';
        // load the project directory
        const thing = await vscode.workspace.findFiles(file_glob, '**/node_modules/**', 100000);
        const decorates = await vscode.workspace.findFiles('**/DECORATE', '**/node_modules/**', 100000);
        const acs = await vscode.workspace.findFiles('**/ACS', '**/node_modules/**', 100000);
        const combined = thing.concat(decorates).concat(acs);
        this.sourcePaths = new ICaseSet(combined.map((uri) => uri.fsPath));
        this.done_scanning_project = true;
        this.onFinishedScanning.fire(null);
    }

    protected handleLaunchRequest(request: DAP.LaunchRequest): void {
        this.clearExecutionState();
        this.handleLaunchOrAttach(request);
    }
    protected handleAttachRequest(request: DAP.AttachRequest): void {
        this.clearExecutionState();
        this.handleLaunchOrAttach(request);
    }
    private handleLaunchOrAttach(request: DAP.Request): void {
        if (!this.connected) {
            this._socket?.once('connect', () => {
                this.handleLaunchOrAttach(request);
            });
            return;
        }
        if (!this.done_scanning_project) {
            this.onFinishedScanning.event(() => {
                this.handleLaunchOrAttach(request);
            });
            return;
        }



        request.arguments.projectSources = Array.from(this.sourcePaths).map((sourcePath) => {
            return this.convertClientSourceToDebugger({
                name: path.basename(sourcePath),
                // make sure path is relative to the workspace folder
                path: sourcePath,
                origin: this.projectArchive,
            } as DAP.Source);
        });
        // send it on
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) => {
            this._defaultResponseHandler(r);
        });
        this.launch_request_sent = true;
        this.onSentLaunchRequest.fire(null);
    }

    protected handleClientRequest(request: DAP.Request): void {
        try {

            if (request.command === 'launch') {
                this.handleLaunchRequest(<DAP.LaunchRequest>request);
            } else if (request.command === 'attach') {
                this.handleAttachRequest(<DAP.AttachRequest>request);
            } else {
                if (request.command != 'initialize' && !this.launch_request_sent) {
                    this.onSentLaunchRequest.event(() => {
                        this.handleClientRequest(request);
                    });
                    return;
                }
                if (request.command === 'setBreakpoints') {
                    this.handleSetBreakpointsRequest(<DAP.SetBreakpointsRequest>request);
                } else if (request.command === 'stackTrace') {
                    this.handleStackTraceRequest(<DAP.StackTraceRequest>request);
                } else if (request.command === 'scopes') {
                    this.handleScopesRequest(<DAP.ScopesRequest>request);
                } else if (request.command === 'source') {
                    this.handleSourceRequest(<DAP.SourceRequest>request);
                } else if (request.command === 'disconnect') {
                    this.handleDisconnectRequest(<DAP.DisconnectRequest>request);
                    // loaded sources request
                } else if (request.command === 'loadedSources') {
                    this.handleLoadedSourcesRequest(<DAP.LoadedSourcesRequest>request);
                } else if (request.command === 'disassemble') {
                    this.handleDisassembleRequest(<DAP.DisassembleRequest>request);
                } else {
                    this.handleRequestDefault(request);
                }
            }
        } catch (e) {
            this.sendErrorResponse(new Response(request), 1104, '{_stack}', e, ErrorDestination.Telemetry);
        }
    }
    protected handleLoadedSourcesRequest(request: DAP.LoadedSourcesRequest) {
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) => {
            const response = r as DAP.LoadedSourcesResponse;
            for (let i in response.body.sources) {
                response.body.sources[i] = this.convertDebuggerSourceToClient(response.body.sources[i] as DAP.Source);
            }
        });
    }

    protected handleDisconnectRequest(request: DAP.DisconnectRequest): void {
        this.sendRequestToServerWithCB(request, 5000, (_r, _req) => {
            this.stop();
        });
    }

    protected handleSetBreakpointsRequest(request: DAP.SetBreakpointsRequest): void {
        request.arguments.source = this.convertClientSourceToDebugger(request.arguments.source as DAP.Source);
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) => {
            this.handleSetBreakpointsResponse(r as DAP.SetBreakpointsResponse, req as DAP.SetBreakpointsRequest);
        });
    }

    // They set body.breakpoints[].source argument to a string instead of a source object, need to fix this
    protected handleSetBreakpointsResponse(
        message: DAP.SetBreakpointsResponse,
        request: DAP.SetBreakpointsRequest
    ): void {
        if (message.body.breakpoints) {
            message.body.breakpoints.forEach((bp: DAP.Breakpoint) => {
                if (bp.source) {
                    bp.source = this.convertDebuggerSourceToClient(bp.source as DAP.Source);
                }
            });
        }
        this.sendMessageToClient(message);
    }

    private _defaultResponseHandler(response: DAP.Response) {
        this.sendMessageToClient(response);
    }

    // We shouldn't get these; if we do, we screwed up somewhere.'
    // In either case, gzdoom doesn't respond to them
    protected handleSourceRequest(request: DAP.SourceRequest): void {
        if (request.arguments.source) {
            request.arguments.source = this.convertClientSourceToDebugger(request.arguments.source as DAP.Source);
        }
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) => {
            this._defaultResponseHandler(r);
        });
    }


    protected handleStackTraceRequest(request: DAP.StackTraceRequest): void {
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) =>
            this.handleStackTraceResponse(r as DAP.StackTraceResponse, req as DAP.StackTraceRequest)
        );
    }

    protected handleStackTraceResponse(response: DAP.StackTraceResponse, request: DAP.StackTraceRequest) {
        if (response.body.stackFrames) {
            response.body.stackFrames.forEach((frame: DAP.StackFrame) => {
                frame.source = this.convertDebuggerSourceToClient(frame.source as DAP.Source);
            });
        }
        this.sendMessageToClient(response);
    }

    /**
     * @param scopesRequest
     */
    protected handleScopesRequest(scopesRequest: DAP.ScopesRequest): void {
        this.sendRequestToServerWithCB(scopesRequest, DEFAULT_TIMEOUT, (r, _req) => {
            const response = r as DAP.ScopesResponse;
            for (const scope of response.body.scopes) {
                if (scope.source) {
                    scope.source = this.convertDebuggerSourceToClient(scope.source);
                }
            }
            this.sendMessageToClient(response);
        });
    }

    protected handleDisassembleRequest(request: DAP.DisassembleRequest): void {
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, req) => {
            const response = r as DAP.DisassembleResponse;
            if (response.body?.instructions) {
                for (const instr of response.body?.instructions) {
                    if (instr.location) {
                        instr.location = this.convertDebuggerSourceToClient(instr.location);
                    }
                }
            }
            this.sendMessageToClient(response);
        });
    }


    // handleEvaluateRequest(request: DAP.EvaluateRequest) {
    //     try {
    //         const expr = request.arguments.expression.trim();
    //         if (request.arguments.context == 'repl') {
    //             if (expr.startsWith(this.SEND_TO_SERVER_CMD)) {
    //                 this.handleREPLSendToServer(request);
    //                 return;
    //             }
    //         }
    //         // Straight-up expression, make a value request
    //         // TODO: Not implemented yet
    //         this.sendErrorResponse(
    //             new Response(request),
    //             1109,
    //             'Evaluation of values is not implemented',
    //             null,
    //             ErrorDestination.Telemetry
    //         );
    //     } catch (e) {
    //         this.sendErrorResponse(
    //             new Response(request),
    //             1109,
    //             'Invalid expression in REPL message!',
    //             null,
    //             ErrorDestination.Telemetry
    //         );
    //     }
    // }

    // Using this for debugging/RE; in the debug console of the client, you can type in server requests and they will be sent to the server
    // private handleREPLSendToServer(evalRequest: DAP.EvaluateRequest) {
    //     try {
    //         const expr = evalRequest.arguments.expression.trim();
    //         const messageToSend: DAP.ProtocolMessage = JSON.parse(expr.replace(this.SEND_TO_SERVER_CMD, '').trim());
    //         //check that it's a valid DAP.ProtocolMessage
    //         // make sure we have a valid sequence number
    //         messageToSend.seq = 10000 + this.currentSeq;
    //         if (messageToSend.type) {
    //             // send it to the server
    //             this.loginfo('!!!PROXY->SERVER - Sending message from REPL console to server!!!');
    //             if (messageToSend.type == 'request') {
    //                 const sreq = messageToSend as DAP.Request;
    //                 if (!sreq.command) {
    //                     this.sendErrorResponse(
    //                         new Response(evalRequest),
    //                         1105,
    //                         'Invalid server request!',
    //                         null,
    //                         ErrorDestination.User
    //                     );
    //                 }
    //                 // special handler for variableRequest
    //                 if (
    //                     sreq.command == 'variables' &&
    //                     sreq?.arguments?.hasOwnProperty('root') &&
    //                     sreq?.arguments?.hasOwnProperty('path')
    //                 ) {
    //                     // formatted correctly, send it to the server
    //                     this.sendRequestToServerWithCB(sreq as DAP.VariablesRequest, 10000, (r, req) => {
    //                         // this was sent from a REPL
    //                         if (r.success != false) {
    //                             // failed responses will show in the REPL console by themselves
    //                             this.emitOutputEvent(
    //                                 `Response to REPL variables request (path: ${req.arguments.path.join(
    //                                     '.'
    //                                 )}):\n${colorize_message(r.body.variables)}`,
    //                                 'console'
    //                             );
    //                         }
    //                         // TODO: do something else other than sending the response straight back
    //                         this.sendMessageToClient(r);
    //                         return;
    //                     });
    //                 } else {
    //                     this.handleClientRequest(sreq);
    //                 }
    //             } else {
    //                 this.sendMessageToServer(messageToSend as DAP.ProtocolMessage);
    //             }
    //         } else {
    //             this.sendErrorResponse(
    //                 new Response(evalRequest),
    //                 1106,
    //                 'Invalid server message!',
    //                 null,
    //                 ErrorDestination.User
    //             );
    //         }
    //     } catch (e) {
    //         this.sendErrorResponse(
    //             new Response(evalRequest),
    //             1107,
    //             'Invalid JSON in REPL Send to Server command!',
    //             e,
    //             ErrorDestination.Telemetry
    //         );
    //     }
    // }

    /**
     * Just pass it through to the server
     */
    protected handleRequestDefault(request: DAP.Request): void {
        this.sendRequestToServerWithCB(request, DEFAULT_TIMEOUT, (r, _req) => this._defaultResponseHandler(r));
    }

    private convertClientSourceToDebugger(Source: DAP.Source): DAP.Source {
        // change the source path to add the workspace folder
        if (!Source.path) {
            return Source;
        }
        Source.path = this.convertClientPathToDebugger(Source.path);
        let new_path = path.isAbsolute(Source.path) ? path.relative(this.projectPath, Source.path) : Source.path;
        if (new_path.startsWith('..') || path.isAbsolute(new_path)) {
            new_path = Source.path;
        }
        Source.path = new_path;
        if (!Source.origin) {
            Source.origin = this.projectArchive;
        }
        return Source;
    }

    private convertDebuggerSourceToClient(Source: DAP.Source): DAP.Source {
        if (!Source.path) {
            return Source
        }
        let new_path = Source.path;
        if (Source.path && !path.isAbsolute(Source.path) && Source.origin?.toLowerCase() == this.projectArchive?.toLowerCase()) {
            new_path = path.join(this.projectPath, Source.path);
        }
        // check if it's in the set of source paths
        var ourPath = this.sourcePaths.get(new_path);
        if (!ourPath) {
            Source.path = this.convertDebuggerPathToClient(Source.path);
            return Source;
        }
        Source.path = this.convertDebuggerPathToClient(ourPath);
        Source.name = path.basename(ourPath);
        Source.sourceReference = 0;
        return Source;
    }
}
