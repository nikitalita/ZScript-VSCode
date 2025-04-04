
'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { GZDoomDebugAdapterProxy, GZDoomDebugAdapterProxyOptions } from './GZDoomDebugAdapterProxy';
import { DebugLauncherService, DebugLaunchState, LaunchCommand } from './DebugLauncherService';
import { BUILTIN_PK3_FILES, DEFAULT_PORT, isBuiltinPK3File, normalizePath, ProjectItem } from './GZDoomGame';
import path from 'path';
import { VSCodeFileAccessor as WorkspaceFileAccessor } from './VSCodeInterface';
import { WadFileSystemProvider } from './wad-provider/WadFileSystemProvider';
import { Pk3FSProvider } from './pk3-provider/Pk3FSProvider';
import { activate as activatePk3Provider } from './pk3-provider/index';
import { activate as activateWadProvider } from './wad-provider/index';
import { windowManager } from "./WindowManager";

const debugLauncherService = new DebugLauncherService();
const workspaceFileAccessor = new WorkspaceFileAccessor();
let wadFileSystemProvider: WadFileSystemProvider | null = null;
let pk3FileSystemProvider: Pk3FSProvider | null = null;
const foldingRegionStart = /^\s*(?:(?:\[(CODEPTR|PARS|STRINGS|SPRITES|SOUNDS|MUSIC|HELPER)\])|(?:Text \d+ \d+)|(?:(Pointer|Thing|Frame|Sprite|Sound|Ammo|Weapon|Cheat|Misc|Text)\s+(\d+)(?:\s*\((.+)\))?))(\s*(?:#|\/\/).*)?\s*$/i;
export function activateGZDoomDebug(context: vscode.ExtensionContext) {
	// register a configuration provider for 'gzdoom' debug type
	const provider = new gzdoomConfigurationProvider();
	const factory = new InlineDebugAdapterFactory();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('gzdoom', provider));

    // register a dynamic configuration provider for 'gzdoom' debug type
    wadFileSystemProvider = activateWadProvider(context);
    pk3FileSystemProvider = activatePk3Provider(context);
    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider('dehacked', {
        provideFoldingRanges(document, context, token) {
            //console.log('folding range invoked'); // comes here on every character edit
            let sectionStart = 0, FR: vscode.FoldingRange[] = [];  // regex to detect start of region

            for (let i = 0; i < document.lineCount; i++) {

                if (foldingRegionStart.test(document.lineAt(i).text)) {
                    if (sectionStart > 0) {
                        var extra = document.lineAt(i - 1).text.trim() == '' ? 1 : 0;
                        FR.push(new vscode.FoldingRange(sectionStart, i - (1 + extra), vscode.FoldingRangeKind.Region));
                    }
                    sectionStart = i;
                }
            }
            if (sectionStart > 0) { FR.push(new vscode.FoldingRange(sectionStart, document.lineCount - 1, vscode.FoldingRangeKind.Region)); }

            return FR;
        }
    }));

	if (!factory) {
		throw new Error('No debug adapter factory');
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('gzdoom', factory));
	if ('dispose' in factory && typeof factory.dispose === 'function') {
        // @ts-ignore
		context.subscriptions.push(factory);
	}

}

class gzdoomConfigurationProvider implements vscode.DebugConfigurationProvider {

    async fixProjects(projects, workspaceFolder: string | undefined): Promise<ProjectItem[]> {
        let new_projects: ProjectItem[] = [];
        for (let project of projects) {
            if (typeof project === 'string') {
                project = { path: project, archive: project };
            }
            if (!project.archive) {
                project.archive = project.path;
            }

            // if project.path or project.archive is not absolute, make it absolute
            if (workspaceFolder) {
                if (!path.isAbsolute(project.path)) {
                    project.path = path.join(workspaceFolder, project.path);
                }
                if (!path.isAbsolute(project.archive) && !isBuiltinPK3File(project.archive)) {
                    project.archive = path.join(workspaceFolder, project.archive);
                }
            }
            project.archive = normalizePath(project.archive);
            if (!project.archive.endsWith('/') && await workspaceFileAccessor.isDirectory(project.archive)) {
                project.archive += '/';
            }
            new_projects.push(project);
        }
        return new_projects;
    }
	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
    async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration> {
		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && (editor.document.languageId === 'zscript' || editor.document.languageId === 'acs' || editor?.document.languageId === 'decorate')) {
				config.type = 'gzdoom';
				config.name = 'Attach';
				config.request = 'attach';
                config.port = DEFAULT_PORT;
            }
        }
        if (!config.projects && folder) {
            config.projects = [folder];
        }
        if (!config.port) {
            config.port = DEFAULT_PORT;
        }
        return config;
    }

    // called directly after resolveDebugConfiguration
    async resolveDebugConfigurationWithSubstitutedVariables(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration> {
        config.projects = await this.fixProjects(config.projects, folder?.uri.fsPath);
        return config;
    }

    provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
        return [
            {
                type: 'gzdoom',
                name: 'gzdoom Attach',
                request: 'attach',
                port: DEFAULT_PORT,
                projects: ['${workspaceFolder}'],
            },
            {
                type: 'gzdoom',
                name: 'gzdoom Launch',
                request: 'launch',
                gzdoomPath: "C:/Program Files/GZDoom/gzdoom.exe",
                cwd: '${workspaceFolder}',
                port: DEFAULT_PORT,
                projects: ['${workspaceFolder}'],
                iwad: 'doom2.wad',
                configPath: '',
                map: '',
                additionalArgs: []
            }

        ];
    }

}

const sleep = (time: number) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, time);
    });
}



function cancellableWindow(title: string, timeout: number, timeoutMessage?: string, ourCancellationToken?: CancellationToken) {
    return vscode.window.withProgress({
        title: title,
        location: vscode.ProgressLocation.Notification,
        cancellable: !!ourCancellationToken
    },
        async (progress, token) => {
            return new Promise((async (resolve) => {
                let cancel_func = () => {
                    if (timeoutMessage) {
                        vscode.window.showInformationMessage(timeoutMessage);
                    }
                    resolve(false);
                    return;
                }
                token.onCancellationRequested(cancel_func);
                ourCancellationToken?.onCancellationRequested(cancel_func);
                const seconds = timeout;
                for (let i = 0; i < seconds; i++) {
                    await sleep(100);
                }
                resolve(true);
            }));
        });
}

const noopExecutable = new vscode.DebugAdapterExecutable('node', ['-e', '""']);

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    // map of session id to previous command
    private previousCmd: Map<string, LaunchCommand> = new Map();

    async ensureGameRunning(port: number) {
        if (!(await debugLauncherService.getGameIsRunning()) || !(await debugLauncherService.waitForPort(port, 1000))) {


            let cancellationSource = new vscode.CancellationTokenSource();
            let cancellationToken = cancellationSource.token;

            let resolved = false;
            cancellableWindow(
                `Make sure that gzdoom is running and is either in-game or at the main menu.`,
                65000,
                undefined,
                cancellationToken
            ).then((result) => {
                resolved = true;
            });
            let result = false;
            // now while the user is deciding, keep checking if the game is running
            result = await debugLauncherService.waitForPort(port, 60000, () => {
                return !resolved;
            });
            // i.e. the user didn't cancel the window
            if (!resolved) {
                cancellationSource.cancel();
                return result;
            }
            return false;
        }
        // sleep(1000);
        return true;
    }

    async resolveProjects(projects: ProjectItem[]) {
        for (let project of projects) {
            if (!project.archive) {
                throw new Error(`Project archive for '${project.path}' does not exist.`);
            }
            if (!await workspaceFileAccessor.isDirectory(project.archive) && !await workspaceFileAccessor.isFile(project.archive) && !isBuiltinPK3File(project.archive)) {
                throw new Error(`Project archive '${project.archive}' could not be found.`);
            }
        }
    }

	async createDebugAdapterDescriptor(_session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor> {
        // macos requires accessibility permission for re-focusing the window after execution resumes
        // no need to check for platform, windowManager.requestAccessibility() is a no-op on non-macos
        windowManager.requestAccessibility();

        let options = _session.configuration as GZDoomDebugAdapterProxyOptions;
        if (!_session.configuration.projects) {
            if (!_session.workspaceFolder) {
                throw new Error('No project path provided.');
            }
        }
        options.consoleLogLevel = 'debug';
		let launched: DebugLaunchState = DebugLaunchState.success;
        let launchCommand: LaunchCommand | undefined = undefined;
        let reattach = false;
        let pid = 0;
        try {
            if (options.request === 'attach' && this.previousCmd.has(_session.id)) {
                reattach = true;
                launchCommand = this.previousCmd.get(_session.id);
            } else if (options.request === 'launch') {
                if (!options.cwd) {
                    options.cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                }
                launchCommand = debugLauncherService.getLaunchCommand(
                    options.gzdoomPath,
                    options.iwad,
                    options.projects.map(p => p.archive),
                    options.port,
                    options.map,
                    options.configPath,
                    options.additionalArgs,
                    options.cwd
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error resolving projects: ${error}`);
            _session.configuration.noop = true;
            return noopExecutable;
        }
        await this.resolveProjects(options.projects);

        if (options.request === 'launch' || reattach) {
			const cancellationSource = new vscode.CancellationTokenSource();
			const cancellationToken = cancellationSource.token;
			const port = options.port || DEFAULT_PORT;
			const wait_message = vscode.window.setStatusBarMessage(
				`Waiting for gzdoom to start...`,
				30000
			);
            launched = await debugLauncherService.runLauncher(launchCommand!, port, cancellationToken);
			wait_message.dispose();
            pid = debugLauncherService.launcherProcess?.pid || 0;
		}
		if (launched != DebugLaunchState.success) {
			if (launched === DebugLaunchState.cancelled) {
				_session.configuration.noop = true;
				return noopExecutable;
			}
            let errMessage = `'gzdoom' failed to launch.`;
			if (launched === DebugLaunchState.multipleGamesRunning) {
                errMessage = `Multiple gzdoom instances are running, shut them down and try again.`;
            }
            throw new Error(errMessage);
        } else { // attach
            if (!(await this.ensureGameRunning(options.port))) {
                _session.configuration.noop = true;
                return noopExecutable;
            } else if (options.request === 'attach') {
                pid = debugLauncherService.getGamePIDs()[0];
                let launchCommand = await debugLauncherService.getLaunchCommandFromRunningProcess(options.port);
                if (launchCommand) {
                    this.previousCmd.set(_session.id, launchCommand);
                }
            }
        }
		var config = options as GZDoomDebugAdapterProxyOptions;
		config.launcherProcess = debugLauncherService.launcherProcess;
        config.pid = pid;


        config.startNow = false;
        let proxy = new GZDoomDebugAdapterProxy(workspaceFileAccessor, config);
        proxy.start();
		return new vscode.DebugAdapterInlineImplementation(
            proxy
		);
	}
}
