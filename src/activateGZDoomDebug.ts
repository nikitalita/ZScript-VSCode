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
export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}


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
					port: 19021,
					projectPath: '${workspaceFolder}',
					projectArchive: 'project.pk3'
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
				config.port = 19021;
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

export const workspaceFileAccessor: FileAccessor = {
	isWindows: typeof process !== 'undefined' && process.platform === 'win32',
	async readFile(path: string): Promise<Uint8Array> {
		let uri: vscode.Uri;
		try {
			uri = pathToUri(path);
		} catch (e) {
			return new TextEncoder().encode(`cannot read '${path}'`);
		}

		return await vscode.workspace.fs.readFile(uri);
	},
	async writeFile(path: string, contents: Uint8Array) {
		await vscode.workspace.fs.writeFile(pathToUri(path), contents);
	}
};

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		const options = _session.configuration as GZDoomDebugAdapterProxyOptions;
		if (!options.projectPath) {
			options.projectPath = _session.workspaceFolder?.uri.fsPath;
		}
		options.startNow = true;
		options.consoleLogLevel = 'info';
		return new vscode.DebugAdapterInlineImplementation(
			new GZDoomDebugAdapterProxy(_session.configuration as GZDoomDebugAdapterProxyOptions)
		);
	}
}
