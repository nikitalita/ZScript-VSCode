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
import { DEFAULT_PORT } from './GZDoomGame';
import path from 'path';
import { WorkspaceFileAccessor } from './IDEImplementation';

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
					projectPath: '${workspaceFolder}',
					projectArchive: 'project.pk3'
				},
				{
					type: 'gzdoom',
					name: 'gzdoom Launch',
					request: 'launch',
					gzdoomPath: "C:/Program Files/GZDoom/gzdoom.exe",
					cwd: '${workspaceFolder}',
					port: DEFAULT_PORT,
					projectPath: '${workspaceFolder}',
					projectArchive: 'project.pk3',
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
				config.projectPath = '${workspaceFolder}';
				config.projectArchive = 'project.pk3';
			}
		}
		if (!config.projectArchive) {
			throw new Error("'projectArchive' is required");
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
		const options = _session.configuration as GZDoomDebugAdapterProxyOptions;
		if (!options.projectPath) {
			options.projectPath = _session.workspaceFolder?.uri.fsPath;
		}
		options.startNow = true;
		options.consoleLogLevel = 'info';
		let launched: DebugLaunchState = DebugLaunchState.success;
		if (options.request === 'launch') {
			// check relative path
			if (!path.isAbsolute(options.projectArchive)) {
				options.projectArchive = path.join(options.cwd, options.projectArchive);
			}
			// check if options.projectArchive exists
			if (!await workspaceFileAccessor.readFile(options.projectArchive)) {
				vscode.window.showErrorMessage(`Project archive path '${options.projectArchive}' does not exist.`);
				_session.configuration.noop = true;
				return noopExecutable;
			}
			const launchCommand = debugLauncherService.getLaunchCommand(
				options.gzdoomPath,
				options.iwad,
				[options.projectArchive],
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

		var config = options as GZDoomDebugAdapterProxyOptions;
		config.launcherProcess = debugLauncherService.launcherProcess;

		return new vscode.DebugAdapterInlineImplementation(
			new GZDoomDebugAdapterProxy(_session.configuration as GZDoomDebugAdapterProxyOptions)
		);
	}
}
