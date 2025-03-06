import * as vscode from 'vscode';
import { EventEmitter, FileAccessor, WorkspaceFolder } from './IDEInterface';

function pathToUri(path: string) {
    try {
        return vscode.Uri.file(path);
    } catch (e) {
        return vscode.Uri.parse(path);
    }
}

export class WorkspaceFileAccessor implements FileAccessor {
    isWindows: boolean = typeof process !== 'undefined' && process.platform === 'win32';

    async isDirectory(path: string): Promise<boolean> {
        let uri: vscode.Uri;
        try {
            uri = pathToUri(path);
        } catch (e) {
            return false;
        }

        return await vscode.workspace.fs.stat(uri).then(stat => stat.type === vscode.FileType.Directory);
    }

    async isFile(path: string): Promise<boolean> {
        let uri: vscode.Uri;
        try {
            uri = pathToUri(path);
        } catch (e) {
            return false;
        }
        return await vscode.workspace.fs.stat(uri).then(stat => stat.type === vscode.FileType.File);
    }

    async readDirectory(path: string): Promise<[string, vscode.FileType][]> {
        return await vscode.workspace.fs.readDirectory(pathToUri(path));
    }

    async readFile(path: string): Promise<Uint8Array> {
        return await vscode.workspace.fs.readFile(pathToUri(path));
    }

    async writeFile(path: string, contents: Uint8Array) {
        await vscode.workspace.fs.writeFile(pathToUri(path), contents);
    }

    async findFiles(include: string, exclude?: string, maxResults?: number): Promise<string[]> {
        let thing = await vscode.workspace.findFiles(include, exclude, 1000, undefined);
        return thing.map(uri => uri.fsPath);
    }

    getWorkspaceRoot(): string {
        return vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    getWorkspaceFolders(): WorkspaceFolder[] {
        if (!vscode.workspace.workspaceFolders) {
            return [];
        }
        let ret: WorkspaceFolder[] = [];
        for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {
            // workspaceFolders is readonly, so we need to create a new object
            ret.push({
                uri: {
                    fsPath: vscode.workspace.workspaceFolders?.[i].uri.fsPath,
                    uri: vscode.workspace.workspaceFolders?.[i].uri.toString(),
                    path: vscode.workspace.workspaceFolders?.[i].uri.path,
                    scheme: vscode.workspace.workspaceFolders?.[i].uri.scheme,
                    authority: vscode.workspace.workspaceFolders?.[i].uri.authority,
                    query: vscode.workspace.workspaceFolders?.[i].uri.query,
                    fragment: vscode.workspace.workspaceFolders?.[i].uri.fragment
                },
                name: vscode.workspace.workspaceFolders?.[i].name,
                index: i,
            } as WorkspaceFolder);
        }
        return ret;
    }
    constructor(workspaceFolders?: string[]) { }
}

export function VSCodeEventEmitterFactory<T>(): EventEmitter<T> {
    return new vscode.EventEmitter<T>();
}
