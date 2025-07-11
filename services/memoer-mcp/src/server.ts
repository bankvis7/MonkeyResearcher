import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, "../prisma/schema.prisma");

function setupPrismaDatabase(userDbPath?: string): string {
  const rawPath =
    userDbPath ||
    (process.env.DATABASE_URL
      ? process.env.DATABASE_URL.replace(/^file:/, "")
      : undefined) ||
    "./memoer.db";

  const absPath = path.resolve(rawPath);
  process.env.DATABASE_URL = `file:${absPath}`;
  console.error(`[MCP] Using DATABASE_URL: ${process.env.DATABASE_URL}`);

  // Defer the db push: don't block MCP startup
  setTimeout(() => {
    try {
      execSync(`npx prisma db push --schema=${schemaPath}`, {
        stdio: ["ignore", "ignore", "inherit"] // prevent stdout interference
      });
    } catch (e) {
      console.error("[MCP] Failed to run prisma db push:", e);
    }
  }, 100); // give MCP a head start

  return absPath;
}

async function registerTools(server: McpServer, prisma: PrismaClient) {
  // Define tool for creating a new memory
  server.tool(
    "createMemory",
    {
      content: z
        .string()
        .describe("the content/memory to store into memoer-mcp local storage"),
      appName: z.string().describe("the name of the app/agent you are")
    },
    async ({ content, appName }) => {
      try {
        const formattedAppId = appName.toLowerCase().replace(/\s+/g, "_");

        await prisma.app.upsert({
          where: { name: formattedAppId },
          update: {},
          create: {
            name: formattedAppId,
            owner: {
              connectOrCreate: {
                where: { name: "default-user" },
                create: {
                  id: randomUUID(),
                  name: "default-user"
                }
              }
            }
          }
        });

        const memory = await prisma.memory.create({
          data: {
            content,
            app: {
              connect: { name: formattedAppId }
            },
            user: {
              connect: { name: "default-user" }
            }
          }
        });

        return {
          content: [
            {
              type: "text",
              text: `Memory created successfully with ID: ${memory.id}`
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating memory: ${JSON.stringify(
                error,
                Object.getOwnPropertyNames(error),
                2
              )}`
            }
          ]
        };
      }
    }
  );

  // Define tool for retrieving memories
  server.tool(
    "getMemories",
    {
      appName: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().optional()
    },
    async ({ appName, category, limit = 10 }) => {
      try {
        const memories = await prisma.memory.findMany({
          where: {
            ...(appName && {
              app: {
                name: appName
              }
            }),
            ...(category && {
              categories: {
                some: {
                  category: {
                    name: category
                  }
                }
              }
            })
          },
          include: {
            categories: {
              include: { category: true }
            }
          },
          take: limit,
          orderBy: {
            createdAt: "desc"
          }
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(memories, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving memories: ${
                error.message ?? "Unknown error"
              }`
            }
          ]
        };
      }
    }
  );

  // Define tool for creating research memory
  server.tool(
    "createResearchMemory",
    {
      content: z
        .string()
        .describe("the research content to store"),
      researchTopic: z
        .string()
        .describe("the main research topic"),
      memoryType: z
        .enum(["research_summary", "search_query", "web_results", "final_report"])
        .describe("type of research memory"),
      sourceReliability: z
        .enum(["high", "medium", "low"])
        .optional()
        .describe("reliability of the source"),
      sourceType: z
        .enum(["academic", "web", "technical"])
        .optional()
        .describe("type of source"),
      researchLoopCount: z
        .number()
        .optional()
        .describe("number of research loops"),
      metadata: z
        .string()
        .optional()
        .describe("additional metadata as JSON string"),
      appName: z
        .string()
        .default("local-deep-researcher")
        .describe("the name of the research app")
    },
    async ({ content, researchTopic, memoryType, sourceReliability, sourceType, researchLoopCount, metadata, appName }) => {
      try {
        const formattedAppId = appName.toLowerCase().replace(/\s+/g, "_");

        await prisma.app.upsert({
          where: { name: formattedAppId },
          update: {},
          create: {
            name: formattedAppId,
            owner: {
              connectOrCreate: {
                where: { name: "default-user" },
                create: {
                  id: randomUUID(),
                  name: "default-user"
                }
              }
            }
          }
        });

        const memory = await prisma.memory.create({
          data: {
            content,
            researchTopic,
            memoryType,
            sourceReliability,
            sourceType,
            researchLoopCount,
            metadata,
            app: {
              connect: { name: formattedAppId }
            },
            user: {
              connect: { name: "default-user" }
            }
          }
        });

        return {
          content: [
            {
              type: "text",
              text: `Research memory created successfully with ID: ${memory.id}, Topic: ${researchTopic}, Type: ${memoryType}`
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating research memory: ${JSON.stringify(
                error,
                Object.getOwnPropertyNames(error),
                2
              )}`
            }
          ]
        };
      }
    }
  );

  // Define tool for retrieving research memories
  server.tool(
    "getResearchMemories",
    {
      researchTopic: z.string().optional(),
      memoryType: z.string().optional(),
      sourceType: z.string().optional(),
      limit: z.number().optional()
    },
    async ({ researchTopic, memoryType, sourceType, limit = 10 }) => {
      try {
        const memories = await prisma.memory.findMany({
          where: {
            ...(researchTopic && {
              researchTopic: {
                contains: researchTopic
              }
            }),
            ...(memoryType && {
              memoryType: memoryType
            }),
            ...(sourceType && {
              sourceType: sourceType
            })
          },
          include: {
            categories: {
              include: { category: true }
            }
          },
          take: limit,
          orderBy: {
            createdAt: "desc"
          }
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(memories, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving research memories: ${
                error.message ?? "Unknown error"
              }`
            }
          ]
        };
      }
    }
  );
}

async function main() {
  setupPrismaDatabase(); // fire-and-forget: no blocking

  const prisma = new PrismaClient();

  const server = new McpServer({
    name: "memoer-mcp",
    version: "1.0.0"
  });

  await registerTools(server, prisma);

  const transport = new StdioServerTransport();
  await server.connect(transport); // 🚀 Send server_info immediately

  // Optional: do upsert AFTER connection
  await prisma.user.upsert({
    where: { name: "default-user" },
    update: { name: "default-user" },
    create: {
      id: randomUUID(),
      name: "default-user"
    }
  });
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
