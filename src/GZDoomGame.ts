
export const DEFAULT_PORT = 19021;


export interface ProjectItem {
    path: string;
    archive: string;
}

export const WAD_EXTENSIONS = ['wad', 'zip', 'pk3', 'pk7', 'deh', 'bex', "iwad", "pwad", "ipk3", "ipk7"];

export const BUILTIN_PK3_FILES = [
    "gzdoom.pk3",
    "brightmaps.pk3",
    "lights.pk3",
    "game_support.pk3",
    "game_widescreen_gfx.pk3"
]

export function isBuiltinPK3File(path: string) {
    return BUILTIN_PK3_FILES.some(builtin => path.toLowerCase().trim().endsWith(builtin.toLowerCase()));
}

export function isWad(path: string) {
    return WAD_EXTENSIONS.some(ext => path.endsWith(ext));
}

export function normalizePath(path: string) {
    // basically like path.normalize but always converts \\ to /
    path = path.replace(/\\/g, '/');
    let parts = path.split('/');
    let result: string[] = [];
    for (let part of parts) {
        if (part == '.') continue;
        if (part == '..') result.pop();
        else result.push(part);
    }
    return result.join('/');
}
