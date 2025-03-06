import * as vscode from 'vscode';

if (vscode) {
    vscode;
} else {
    throw new Error('vscode is not defined');
}
// if vscode is defined, re-export the stuff in VSCodeInterface
export { WorkspaceFileAccessor, VSCodeEventEmitterFactory as EventEmitterFactory } from './VSCodeInterface';
