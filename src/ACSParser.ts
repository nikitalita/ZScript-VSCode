
// below is an example of an ACS script that is parsed by the ACSParser
// This one will be compiled into a single ACS module called "ZETAACS.o"
/**
#library "ZETAACS"
#include "zcommon.acs"

script "__ZetaBot_enter" ENTER
{
    GiveInventory("BotName", 1);
}

script "__ZetaBot_respawn" RESPAWN
{
    GiveInventory("BotName", 1);
}

script "__ZetaBot_endlevelDM" (void)
{
    Exit_Normal(0);
}
 */

// here is another example:
// this one doesn't have a library directive at the top, so it can only be included in another script that eventually gets compiled into a module
// note that it includes other ACS files, which will be included in the final module as well
/**
 * 
//**************************************************************************
//**
//** zcommon.acs
//**
//**************************************************************************

// If you are not using the -h command line switch and do not want to use
// WadAuthor's error checker, you can uncomment the following line to shave
// a few bytes off the size of compiled scripts.
//#nowadauthor

#include "zspecial.acs"
#include "zdefs.acs"
#include "zwvars.acs"
 */

import * as fs from 'fs';

export interface ACSScript {
    path: string;
    name: string;
    is_main: boolean;
    library_name: string;
    includes: ACSScript[];
}

export interface ACSModule {
    name: string;
    compiled_path: string;
    main_script: ACSScript;
}


export class ACSParser {
    private isModule(path): boolean {
        // we are checking if the script is a module by looking for the #library directive
        const data = fs.readFileSync(path, 'utf8');
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('#library')) {
                return true;
            }
        }
        return false;
    }

    private findScript(project_path: string, scriptName: string): string {
        // check in STDAACS first
        const stdaacs = fs.readdirSync(`${project_path}/STDAACS`);
        for (const file of stdaacs) {
            if (file === scriptName) {
                return `${project_path}/STDAACS/${file}`;
            }
        }
        // otherwise, recursively check the project_path directories to try and find it
        const dirs = fs.readdirSync(project_path);
        for (const dir of dirs) {
            if (fs.statSync(`${project_path}/${dir}`).isDirectory()) {
                return this.findScript(`${project_path}/${dir}`, scriptName);
            }
        }
        return '';
    }

    private parseScript(project_path, path, lastScript = ""): ACSScript {
        // we are parsing the script into an object
        let is_module_main = false;
        let library_name = '';
        let name = '';
        const contents = fs.readFileSync(path, 'utf8');
        const fLines = contents.split('\n');
        const includes: ACSScript[] = [];
        for (const line of fLines) {
            if (line.trim().startsWith('#library')) {
                library_name = line.split('"')[1];
                is_module_main = true;
            }
            if (line.trim().startsWith('#include')) {
                const include = line.split('"')[1];
                // try and find the directory that this include is in
                const include_path = this.findScript(project_path, include);
                includes.push(this.parseScript(fs.readFileSync(include_path, 'utf8').split('\n'), include_path));
            }
        }
        const script: ACSScript = {
            path,
            name: lastScript,
            is_main: is_module_main,
            library_name,
            includes
        };
        return script;
    }

    private parseModule(project_path: string, path: string): ACSModule {
        const script = this.parseScript(project_path, path);
        const module: ACSModule = {
            name: script.library_name,
            compiled_path: `${project_path}/ACS/${script.library_name}.o`,
            main_script: script
        };
        return module;
    }


    public parse(project_path: string, paths: string[]): ACSModule[] {
        // we are parsing all the paths to ACS files and organizing them into modules
        const scripts: ACSModule[] = [];
        for (const path of paths) {
            // read the contents of the file
            const contents = fs.readFileSync(path, 'utf8');
            // first, we try and find all the module main scripts
            const is_module = this.isModule(contents.split('\n'));
            if (is_module) {
                const module = this.parseModule(project_path, path);
                scripts.push(module);
            }

        }
        return scripts;
    }
}