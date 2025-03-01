/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-prototype-builtins */
import { DebugProtocol as DAP } from '@vscode/debugprotocol';
import * as path from 'path';
import { DebugAdapterProxy, DebugAdapterProxyOptions } from './DebugAdapterProxy';
import { Response, Message } from '@vscode/debugadapter/lib/messages';

export enum ErrorDestination {
    User = 1,
    Telemetry = 2,
}

export interface GZDoomDebugAdapterProxyOptions extends DebugAdapterProxyOptions {
    projectPath?: string;
    projectArchive?: string;
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
export class GZDoomDebugAdapterProxy extends DebugAdapterProxy {

    private _pendingRequestsMap = new Map<number, pendingRequest>();
    private projectPath: string = '';
    private projectArchive: string | undefined = undefined;
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
        this.projectPath = options.projectPath || '';
        this.projectArchive = options.projectArchive;
        this.clientCaps.adapterID = 'gzdoom';
        this.logClientToProxy = 'info';
        this.logProxyToServer = 'trace';
        this.logServerToProxy = 'info'; // we take care of this ourselves
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
                    this.log(this.logServerToProxy, { message }, '---SERVER->PROXY:');
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

    protected handleClientRequest(request: DAP.Request): void {
        try {
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
            } else {
                this.handleRequestDefault(request);
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
        this.sendErrorResponse(new Response(request), 1015, 'SOURCE REQUEST?!?!?!?!?', null, ErrorDestination.User);
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

    private convertDebuggerSourceToClient(Source: DAP.Source): DAP.Source {
        // TODO: make this only apply to the sources in the workspace folder
        // change the source path to add the workspace folder
        if (Source.path && !path.isAbsolute(Source.path)) {
            Source.path = path.join(this.projectPath, Source.path);
            Source.path = this.convertDebuggerPathToClient(Source.path);
        }
        Source.sourceReference = 0;
        return Source;
    }
}
