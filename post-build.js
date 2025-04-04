// simple script to copy the addon.node file to the dist folder
// it's in node_modules/@johnlindquist/node-window-manager/build/Release/addon.node
const fs = require("fs")
const path = require("path")

// mkdir dist if it doesn't exist
if (!fs.existsSync(path.resolve(__dirname, "dist"))) {
    fs.mkdirSync(path.resolve(__dirname, "dist"))
}

// get the path to the addon.node file
const addonPath = path.resolve(__dirname, "node_modules", "@johnlindquist", "node-window-manager", "build", "Release", "addon.node")

// copy the addon.node file to the dist folder
fs.copyFileSync(addonPath, path.resolve(__dirname, "dist", "addon.node"))



