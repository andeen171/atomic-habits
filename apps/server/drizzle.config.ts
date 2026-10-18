import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs on Node, which does not load .env files by itself.
config({ quiet: true });

export default defineConfig({
	schema: "./src/db/schema/index.ts",
	out: "./src/db/migrations",
	dialect: "turso",
	dbCredentials: {
		url: process.env.DATABASE_URL || "file:./local.db",
		authToken: process.env.DATABASE_AUTH_TOKEN,
	},
});
