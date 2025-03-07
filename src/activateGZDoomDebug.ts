/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * activategzdoomDebug.ts containes the shared extension code that can be executed both in node.js and the browser.
 */

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { GZDoomDebugAdapterProxy, GZDoomDebugAdapterProxyOptions } from './GZDoomDebugAdapterProxy';
import { DebugLauncherService, DebugLaunchState } from './DebugLauncherService';
import { DEFAULT_PORT, ProjectItem } from './GZDoomGame';
import path from 'path';
import { VSCodeFileAccessor as WorkspaceFileAccessor } from './VSCodeInterface';

const debugLauncherService = new DebugLauncherService();
const workspaceFileAccessor = new WorkspaceFileAccessor();

export function activateGZDoomDebug(context: vscode.ExtensionContext) {
	// register a configuration provider for 'gzdoom' debug type
	const provider = new gzdoomConfigurationProvider();
	const factory = new InlineDebugAdapterFactory();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('gzdoom', provider));

	// register a dynamic configuration provider for 'gzdoom' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('gzdoom', {
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
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

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

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && (editor.document.languageId === 'zscript' || editor.document.languageId === 'acs' || editor?.document.languageId === 'decorate')) {
				config.type = 'gzdoom';
				config.name = 'Attach';
				config.request = 'attach';
				config.port = DEFAULT_PORT;
                config.projects = ['${workspaceFolder}'];
			}
        }
		return config;
	}
}


const noopExecutable = new vscode.DebugAdapterExecutable('node', ['-e', '""']);

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	async ensureGameRunning() {
		if (!(await debugLauncherService.getGameIsRunning())) {
			const selectedGameRunningOption = await vscode.window.showWarningMessage(
				`Make sure that gzdoom is running and is either in-game or at the main menu.`,
				'Continue',
				'Cancel'
			);

			if (selectedGameRunningOption !== 'Continue') {
				return false;
			}
		}

		return true;
	}

	async createDebugAdapterDescriptor(_session: vscode.DebugSession): Promise<vscode.DebugAdapterDescriptor> {
        let options = _session.configuration as GZDoomDebugAdapterProxyOptions;
        if (!_session.configuration.projects) {
            if (!_session.workspaceFolder) {
                throw new Error('No project path provided.');
            }
            options.projects = [
                {
                    path: _session.workspaceFolder?.uri.fsPath,
                    archive: _session.workspaceFolder?.uri.fsPath
                }
            ]
        }
        if (!options.cwd) {
            options.cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        }

        let projects: ProjectItem[] = options.projects?.map(project => {
            if (typeof project === 'string') {
                project = { path: project, archive: project };
            }
            if (!project.archive) {
                project.archive = project.path;
            }
            // if the archive is relative, make it absolute
            if (!path.isAbsolute(project.archive) && project.archive != options.cwd) {
                project.archive = path.join(options.cwd, project.archive);
            }
            // check if it exists
            return project;
        });
        if (!projects || projects.length === 0) {
            throw new Error('No project path provided.');
        }
		options.startNow = true;
        options.consoleLogLevel = 'info';
		let launched: DebugLaunchState = DebugLaunchState.success;
		if (options.request === 'launch') {
			// check relative path
            for (let project of projects) {
                if (!await workspaceFileAccessor.isDirectory(project?.archive || '') && !await workspaceFileAccessor.isFile(project?.archive || '')) {
                    vscode.window.showErrorMessage(`Project archive path '${project.archive}' does not exist.`);
                    _session.configuration.noop = true;
                    return noopExecutable;
                }

            }
			const launchCommand = debugLauncherService.getLaunchCommand(
				options.gzdoomPath,
				options.iwad,
                projects.map(p => typeof p === 'string' ? p : (p.archive || '')),
				options.port,
				options.map,
				options.configPath,
				options.additionalArgs,
				options.cwd
			);
			const cancellationSource = new vscode.CancellationTokenSource();
			const cancellationToken = cancellationSource.token;
			const port = options.port || DEFAULT_PORT;
			const wait_message = vscode.window.setStatusBarMessage(
				`Waiting for gzdoom to start...`,
				30000
			);
			await debugLauncherService.runLauncher(launchCommand, port, cancellationToken);
			wait_message.dispose();
		}
		if (launched != DebugLaunchState.success) {
			if (launched === DebugLaunchState.cancelled) {
				_session.configuration.noop = true;
				return noopExecutable;
			}
			if (launched === DebugLaunchState.multipleGamesRunning) {
				const errMessage = `Multiple gzdoom instances are running, shut them down and try again.`;
				vscode.window.showErrorMessage(errMessage);
			}
			// throw an error indicating the launch failed
			throw new Error(`'gzdoom' failed to launch.`);
			// attach
		} else if (!(await this.ensureGameRunning())) {
			_session.configuration.noop = true;
			return noopExecutable;
		}
        options.projects = projects;
		var config = options as GZDoomDebugAdapterProxyOptions;
		config.launcherProcess = debugLauncherService.launcherProcess;

        for (let project of config.projects) {
            if (typeof project === 'string' || !project.archive) {
                throw new Error('Project archive path is required.');
            }
            let isProjectArchiveDirectory = project.archive == project.path || await workspaceFileAccessor.isDirectory(project.archive);
            if (isProjectArchiveDirectory) {
                project.archive = project.archive;
                if (!project.archive.endsWith('/')) {
                    project.archive += '/';
                }
            } else {
                project.archive = path.basename(project.archive);
            }
        }
		return new vscode.DebugAdapterInlineImplementation(
            new GZDoomDebugAdapterProxy(workspaceFileAccessor, config)
		);
	}
}
