/**
 * A workspace folder is one of potentially many roots opened by the editor. All workspace folders
 * are equal which means there is no notion of an active or primary workspace folder.
 */
export interface WorkspaceFolder {

    /**
     * The associated uri for this workspace folder.
     *
     * *Note:* The {@link Uri}-type was intentionally chosen such that future releases of the editor can support
     * workspace folders that are not stored on the local disk, e.g. `ftp://server/workspaces/foo`.
     */
    readonly uri: Uri;

    /**
     * The name of this workspace folder. Defaults to
     * the basename of its {@link Uri.path uri-path}
     */
    readonly name: string;

    /**
     * The ordinal number of this workspace folder.
     */
    readonly index: number;
}

export enum FileType {
    /**
     * The file type is unknown.
     */
    Unknown = 0,
    /**
     * A regular file.
     */
    File = 1,
    /**
     * A directory.
     */
    Directory = 2,
    /**
     * A symbolic link to a file.
     */
    SymbolicLink = 64
}


export interface Event<T> {
    /**
     * A function that represents an event to which you subscribe by calling it with
     * a listener function as argument.
     *
     * @param listener The listener function will be called when the event happens.
     * @param thisArgs The `this`-argument which will be used when calling the event listener.
     * @param disposables An array to which a {@link Disposable} will be added.
     * @returns A disposable which unsubscribes the event listener.
     */
    (listener: (e: T) => any, thisArgs?: any, disposables?: any[]): any;
}

export interface EventEmitter<T> {
    /**
     * The event listeners can subscribe to.
     */
    event: Event<T>;

    /**
     * Notify all subscribers of the {@link EventEmitter.event event}. Failure
     * of one or more listener will not fail this function call.
     *
     * @param data The event object.
     */
    fire(data: T): void;

    /**
     * Dispose this object and free resources.
     */
    dispose(): void;
}

export interface Uri {

    /**
     * Scheme is the `http` part of `http://www.example.com/some/path?query#fragment`.
     * The part before the first colon.
     */
    readonly scheme: string;

    /**
     * Authority is the `www.example.com` part of `http://www.example.com/some/path?query#fragment`.
     * The part between the first double slashes and the next slash.
     */
    readonly authority: string;

    /**
     * Path is the `/some/path` part of `http://www.example.com/some/path?query#fragment`.
     */
    readonly path: string;

    /**
     * Query is the `query` part of `http://www.example.com/some/path?query#fragment`.
     */
    readonly query: string;

    /**
     * Fragment is the `fragment` part of `http://www.example.com/some/path?query#fragment`.
     */
    readonly fragment: string;

    /**
     * The string representing the corresponding file system path of this Uri.
     *
     * Will handle UNC paths and normalize windows drive letters to lower-case. Also
     * uses the platform specific path separator.
     *
     * * Will *not* validate the path for invalid characters and semantics.
     * * Will *not* look at the scheme of this Uri.
     * * The resulting string shall *not* be used for display purposes but
     * for disk operations, like `readFile` et al.
     *
     * The *difference* to the {@linkcode Uri.path path}-property is the use of the platform specific
     * path separator and the handling of UNC paths. The sample below outlines the difference:
     * ```ts
     * const u = URI.parse('file://server/c$/folder/file.txt')
     * u.authority === 'server'
     * u.path === '/c$/folder/file.txt'
     * u.fsPath === '\\server\c$\folder\file.txt'
     * ```
     */
    readonly fsPath: string;

}

export interface FileAccessor {
    isWindows: boolean;
    getWorkspaceRoot(): string;
    getWorkspaceFolders(): WorkspaceFolder[];
    isDirectory(path: string): Promise<boolean>;
    isFile(path: string): Promise<boolean>;
    findFiles(include: string, exclude: string, maxResults: number): Promise<string[]>;
    readDirectory(path: string): Promise<[string, FileType][]>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export interface EventEmitterFactory<T> {
    (): EventEmitter<T>;
}

