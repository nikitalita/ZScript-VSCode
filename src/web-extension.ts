
import * as vscode from 'vscode';
import { activateDehackedFoldingProvider } from './dehackedFoldingProvider';
// import { activateGZDoomDebug } from './activateGZDoomDebug';

export function activate(context: vscode.ExtensionContext) {
    activateDehackedFoldingProvider(context);
}

export function deactivate() {
	// nothing to do
}
