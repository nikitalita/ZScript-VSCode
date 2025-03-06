import * as vscode from 'vscode';
import { FileAccessor } from './IDEInterface';

function pathToUri(path: string) {
    try {
        return vscode.Uri.file(path);
    } catch (e) {
        return vscode.Uri.parse(path);
    }
}
export class VSCodeFileAccessor implements FileAccessor {
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

    async findFiles(include: string, exclude?: string, maxResults?: number, roots?: string[]): Promise<string[]> {
        let thing = await vscode.workspace.findFiles(include, exclude, maxResults, undefined);
        if (roots) {
            thing = thing.filter(uri => roots.some(root => uri.fsPath.startsWith(root)));
        }
        return thing.map(uri => uri.fsPath);
    }
}
