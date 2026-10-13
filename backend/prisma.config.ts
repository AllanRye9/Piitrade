import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: [".env.local", ".env", "../.env"] });

const configuredUrl = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;
const localUrl = new URL("postgresql://localhost:55432/marketplace_db?schema=public");
localUrl.username = process.env.POSTGRES_USER ?? "marketplace";
localUrl.password = process.env.POSTGRES_PASSWORD ?? "marketplace_secret";
localUrl.pathname = `/${process.env.POSTGRES_DB ?? "marketplace_db"}`;
const datasourceUrl = configuredUrl ?? localUrl.toString();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});