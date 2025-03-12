'use strict';

import * as vscode from 'vscode';
import { activateGZDoomDebug } from './activateGZDoomDebug';

/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 * Please note: the test suite only supports 'external' mode.
 */

export function activate(context: vscode.ExtensionContext) {
	activateGZDoomDebug(context);
}

export function deactivate() {
	// nothing to do
}
