'use strict';

import * as vscode from 'vscode';
import { activateGZDoomDebug } from './activateGZDoomDebug';
import { activateDehackedFoldingProvider } from './dehackedFoldingProvider';

/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 * Please note: the test suite only supports 'external' mode.
 */

export function activate(context: vscode.ExtensionContext) {
	activateDehackedFoldingProvider(context);
	activateGZDoomDebug(context);
}

export function deactivate() {
	// nothing to do
}
