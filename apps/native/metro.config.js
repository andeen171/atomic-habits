// Expo's default config already understands Bun/Turborepo monorepos.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
