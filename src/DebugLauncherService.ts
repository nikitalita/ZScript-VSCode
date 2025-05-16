import { CancellationToken, CancellationTokenSource, window } from 'vscode';
import { ChildProcess, spawn } from 'node:child_process';
import waitPort from 'wait-port';
import findProcess from 'find-process';
import { lsof, ProcessInfo } from 'list-open-files';

export enum DebugLaunchState {
    success,
    launcherError,
    gameFailedToStart,
    gameExitedBeforeOpening,
    multipleGamesRunning,
    cancelled,
}
export interface IDebugLauncherService {
    tearDownAfterDebug(): Promise<boolean>;
    runLauncher(
        launcherCommand: LaunchCommand,
        portToCheck: number,
        cancellationToken?: CancellationToken
    ): Promise<DebugLaunchState>;
    getLaunchCommandFromRunningProcess(port: number): Promise<LaunchCommand | undefined>;
}

export interface LaunchCommand {
    command: string;
    args: string[];
    cwd?: string;
}
const GAME_NAME = 'gzdoom';
export class DebugLauncherService implements IDebugLauncherService {

    // TODO: Move this stuff into the global Context
    private cancellationTokenSource: CancellationTokenSource | undefined;
    public launcherProcess: ChildProcess | undefined;
    private gamePID: number | undefined;
    private tearingDown = false;
    constructor() {
    }
    private reset() {
        this.launcherProcess = undefined;
        this.gamePID = undefined;
    }

    async getGameIsRunning() {
        const processList = await findProcess('name', GAME_NAME, false);
        return processList.some((p) => p.name.toLowerCase() === GAME_NAME);
    }

    async getGamePIDs(): Promise<Array<number>> {
        const processList = await findProcess('name', GAME_NAME, false);

        const gameProcesses = processList.filter(
            (p) => p.name.toLowerCase() === GAME_NAME
        );

        if (gameProcesses.length === 0) {
            return [];
        }

        return gameProcesses.map((p) => p.pid);
    }

    async getLaunchCommandFromRunningProcess(port: number): Promise<LaunchCommand | undefined> {
        let process = await findProcess('port', port, false);
        if (process.length === 0) {
            // just look for "gzdoom"
            process = await findProcess('name', GAME_NAME, false);
            if (process.length === 0) {
                return undefined;
            } else if (process.length > 1) {
                console.error(`Found multiple gzdoom processes running on port ${port}`);
            }
        }
        let argv: string[] = []
        // we need to split on spaces, but not between single or double quotes
        let quote = '';
        let currentArg = '';
        for (let char of process[0]?.cmd || '') {
            if (char === '"' || char === "'") {
                if (quote === '') {
                    quote = char;
                } else if (char === quote) {
                    quote = '';
                    char = ' ';
                }
            }
            if (char === ' ' && quote === '') {
                if (currentArg) {
                    argv.push(currentArg);
                    currentArg = '';
                }
            } else {
                currentArg += char;
            }
        }
        if (currentArg) {
            argv.push(currentArg);
        }
        let launchCommand: LaunchCommand = {
            command: argv[0],
            args: argv.slice(1)
        }
        let thing: ProcessInfo[] = await lsof({ pids: [process[0]?.pid] })
        if (thing.length == 0) {
            return launchCommand;
        }
        launchCommand.cwd = thing[0].process.cwd?.name || "";
        return launchCommand;
    }

    async tearDownAfterDebug() {
        // If MO2 was already opened by the user before launch, the process would have detached and this will be closed anyway
        if (this.launcherProcess) {
            this.launcherProcess.removeAllListeners();
            try {
                if (this.launcherProcess.kill()) {
                    this.reset();
                } else if (this.launcherProcess.kill('SIGKILL')) {
                    this.reset();
                }
            } catch (e) {
                console.error(e);
            }
        }

        if (await this.getGameIsRunning()) {
                let pids = await this.getGamePIDs();
            let retris = 0;
            while (pids.length > 0 && retris < 5) {
                for (let pid of pids) {
                    try {
                        if (retris == 0) {
                            process.kill(pid);
                        } else {
                            process.kill(pid, 'SIGKILL');
                        }
                    } catch (e) {
                        /* empty */
                    }
                }
                retris++;
                pids = await this.getGamePIDs();
            }
            if (pids.length > 0) {
                console.error(`Failed to kill game process after 5 retries`);
            }
        }

        this.reset();

        return true;
    }

    async keepSleepingUntil(startTime: number, timeout: number) {
        const currentTime = new Date().getTime();

        if (currentTime > startTime + timeout) {
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
    }

    async cancelLaunch() {
        if (this.cancellationTokenSource) {
            this.cancellationTokenSource.cancel();
        }
    }

    processExitedWithError() {
        return !this.launcherProcess || (this.launcherProcess.exitCode !== null && this.launcherProcess.exitCode !== 0)
    }

    /**
     *
     * @param port
     * @param connectionTimeout
     * @param intervalCallback called every 1000ms if we've failed to open the port, but haven't timed out yet; returns true if we should keep waiting
     * @returns true if the port was opened, false if we timed out
     */
    async waitForPort(port: number, connectionTimeout: number = 15000, intervalCallback: () => boolean = () => true) {
        let result = false;
        const startTime: number = new Date().getTime();
        while (true) {
            const currentTime = new Date().getTime();
            const timedOut = currentTime > startTime + connectionTimeout;
            if (timedOut) {
                return false;
            } else {
                result = (
                    await waitPort({
                        host: 'localhost',
                        port: port,
                        timeout: Math.min(1000, connectionTimeout),
                        interval: Math.min(1000, connectionTimeout),
                        output: 'silent',
                    })
                ).open;
                if (result || !intervalCallback()) {
                    break;
                }
            }
        }
        return result;
    }

    public getLaunchCommand(
        gzdoomPath: string,
        iwad: string,
        pwads: string[],
        debugPort: number,
        map?: string,
        gzdoomIniPath?: string,
        gzdoomArgs?: string[],
        cwd?: string,
    ): LaunchCommand {
        let args = [
            '-iwad',
            iwad,
            '-debug',
            debugPort.toString(),
        ];
        for (const pwad of pwads) {
            args.push('-file', pwad);
        }
        if (gzdoomIniPath) {
            args.push('-config', gzdoomIniPath);
        }
        if (map) {
            args.push('+map', map);
        }
        if (gzdoomArgs) {
            args.push(...gzdoomArgs);
        }
        return {
            command: gzdoomPath,
            args: args,
            cwd: cwd,
        };
    }


    async runLauncher(
        launcherCommand: LaunchCommand,
        portToCheck: number,
        cancellationToken: CancellationToken | undefined
    ): Promise<DebugLaunchState> {
        await this.tearDownAfterDebug();
        if (!cancellationToken) {
            this.cancellationTokenSource = new CancellationTokenSource();
            cancellationToken = this.cancellationTokenSource.token;
        }
        const cmd = launcherCommand.command;
        const args = launcherCommand.args;
        const port = portToCheck;
        let _stdOut: string = '';
        let _stdErr: string = '';
        this.launcherProcess = spawn(cmd, args, {
            cwd: launcherCommand.cwd,
        });
        this.launcherProcess.stdout?.on('data', (data) => {
            console.log(data.toString());
        });
        this.launcherProcess.stderr?.on('data', (data) => {
            console.error(data.toString());
        });
        if (!this.launcherProcess || !this.launcherProcess.stdout || !this.launcherProcess.stderr) {
            window.showErrorMessage(`Failed to start launcher process.\ncmd: ${cmd}\nargs: ${args.join(' ')}`);
            return DebugLaunchState.launcherError;
        }
        this.launcherProcess.stdout.on('data', (data) => {
            _stdOut += data;
        });
        this.launcherProcess.stderr.on('data', (data) => {
            _stdErr += data;
        });
        const _handleProcessExit = () => {
            return (
                !this.launcherProcess || (this.launcherProcess.exitCode !== null && this.launcherProcess.exitCode !== 0)
            );
        };
        const _showErrorCode = () => {
            window.showErrorMessage(
                `Launcher process exited with error code ${this.launcherProcess?.exitCode || -1
                }.\ncmd: ${cmd}\nargs: ${args.join(' ')}\nstderr: ${_stdErr}\nstdout: ${_stdOut}`
            );
        };
        const GameStartTimeout = 15000;
        // get the current system time
        let startTime = new Date().getTime();
        // wait for the games process to start
        while (!cancellationToken.isCancellationRequested) {
            const gameIsRunning = await this.getGameIsRunning();
            const timedOut = !(await this.keepSleepingUntil(startTime, GameStartTimeout));
            if (!gameIsRunning && !timedOut) {
                // check if the launcher process failed to launch, or exited and returned an error
                if (_handleProcessExit()) {
                    _showErrorCode();
                    return DebugLaunchState.launcherError;
                }
            } else {
                break;
            }
        }

        if (cancellationToken.isCancellationRequested) {
            await this.tearDownAfterDebug();
            return DebugLaunchState.cancelled;
        }
        // we can't get the PID of the game from the launcher process because
        // both MO2 and the script extender loaders fork and deatch the game process
        const gamePIDs = await this.getGamePIDs();

        if (gamePIDs.length === 0) {
            return DebugLaunchState.gameFailedToStart;
        }

        if (gamePIDs.length > 1) {
            return DebugLaunchState.multipleGamesRunning;
        }
        this.gamePID = gamePIDs[0];

        // game has launched, now we wait for the port to open
        const connectionTimeout = 15000;
        startTime = new Date().getTime();
        // TODO: Remember to check for starfield only when we remove the skyrim/fallout 4 proxy
        let result = false;
        while (!cancellationToken.isCancellationRequested) {
            const gameIsRunning = await this.getGameIsRunning();
            const currentTime = new Date().getTime();
            const timedOut = currentTime > startTime + connectionTimeout;
            if (timedOut) {
                window.showErrorMessage(`Debugger failed to connect.`);
                return DebugLaunchState.gameFailedToStart;
            } else if (!gameIsRunning) {
                if (_handleProcessExit()) {
                    _showErrorCode();
                    return DebugLaunchState.launcherError;
                }
                return DebugLaunchState.gameFailedToStart;
            } else {
                // DAP server is interpreting the port probing as a connection, disabling for now
                result = (
                    await waitPort({
                        host: 'localhost',
                        port: port,
                        timeout: 1000,
                        interval: 1000,
                        output: 'silent',
                    })
                ).open;
                if (result) {
                    break;
                }
            }
        }
        return result ? DebugLaunchState.success : DebugLaunchState.gameFailedToStart;
    }
}
