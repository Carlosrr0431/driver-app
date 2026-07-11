const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Solo vigilar shared/ existente — no toda la carpeta raíz del monorepo.
// Incluir passenger-app/ en watchFolders causaba que Metro bundleara
// react-native-maps desde passenger-app/node_modules al seguir imports.
const sharedFolders = [
  path.resolve(projectRoot, 'shared'),
  path.resolve(monorepoRoot, 'shared'),
].filter((dir) => fs.existsSync(dir));
config.watchFolders = sharedFolders;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
