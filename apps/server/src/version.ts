import pkg from "../package.json" with { type: "json" };

/** This server's version (`ServerInfo.version`, `/healthz`). */
export const SERVER_VERSION: string = pkg.version;
