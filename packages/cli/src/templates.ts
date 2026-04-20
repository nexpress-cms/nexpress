import type { ProjectConfig } from "./prompts.js";

type TemplateConfig = ProjectConfig & {
  secret: string;
};

export function getProjectFiles(config: TemplateConfig): Record<string, string> {
  const files: Record<string, string> = {
    ".env.example": envExampleTemplate(config),
    ".env": envTemplate(config),
    ".gitignore": gitignoreTemplate(),
    "README.md": readmeTemplate(config),
    "next.config.ts": nextConfigTemplate(),
    "package.json": packageJsonTemplate(config),
    "postcss.config.mjs": postcssConfigTemplate(),
    "tsconfig.json": tsconfigTemplate(),
    "next-env.d.ts": nextEnvTemplate(),
    "public/media/.gitkeep": "",
    "src/nexpress.config.ts": nexpressConfigTemplate(config),
    "src/collections/posts.ts": postsCollectionTemplate(),
    "src/collections/pages.ts": pagesCollectionTemplate(),
    "src/app/layout.tsx": rootLayoutTemplate(config),
    "src/app/globals.css": globalsCssTemplate(),
    "src/app/(site)/layout.tsx": siteLayoutTemplate(config),
    "src/app/(site)/page.tsx": homePageTemplate(config),
    "src/app/(site)/[[...slug]]/page.tsx": slugPageTemplate(config),
    "src/app/(admin)/admin/[[...path]]/page.tsx": adminPageTemplate(config),
    "src/app/api/health/route.ts": healthRouteTemplate(),
  };

  if (config.dockerSetup) {
    files["docker/Dockerfile"] = dockerfileTemplate();
    files["docker/docker-compose.yml"] = dockerComposeTemplate();
  }

  return files;
}

function packageJsonTemplate(config: TemplateConfig): string {
  return JSON.stringify(
    {
      name: config.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
      },
      dependencies: {
        "@nexpress/core": "latest",
        "@nexpress/admin": "latest",
        "@nexpress/editor": "latest",
        "@nexpress/blocks": "latest",
        "@nexpress/theme": "latest",
        "@nexpress/plugin-sdk": "latest",
        next: "^15.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@tailwindcss/postcss": "^4.0.0",
        "@types/node": "^22.0.0",
        "@types/react": "^19.0.0",
        postcss: "^8.5.0",
        tailwindcss: "^4.0.0",
        typescript: "^5.8.0",
      },
    },
    null,
    2,
  );
}

function nexpressConfigTemplate(config: TemplateConfig): string {
  const imports = config.includeExampleContent
    ? 'import { postsCollection } from "./collections/posts";\nimport { pagesCollection } from "./collections/pages";\n\n'
    : "";
  const collections = config.includeExampleContent
    ? "[postsCollection, pagesCollection]"
    : "[]";
  const storageConfig =
    config.storageMode === "s3"
      ? `  storage: {\n    adapter: "s3",\n    s3: {\n      bucket: process.env.S3_BUCKET || "nexpress-media",\n      region: process.env.S3_REGION || "us-east-1",\n      endpoint: process.env.S3_ENDPOINT || undefined,\n    },\n  },`
      : `  storage: {\n    adapter: "local",\n    local: { directory: "./public/media", baseUrl: "/media" },\n  },`;

  return `import { defineConfig } from "@nexpress/core";\n${imports}export default defineConfig({\n  site: {\n    name: "${config.projectName}",\n    url: process.env.SITE_URL || "http://localhost:3000",\n  },\n  db: {\n    connectionString: process.env.DATABASE_URL!,\n  },\n${storageConfig}\n  collections: ${collections},\n  auth: {\n    secret: process.env.NX_SECRET!,\n  },\n  plugins: [],\n});\n`;
}

function dockerComposeTemplate(): string {
  return `services:\n  db:\n    image: postgres:16-alpine\n    ports:\n      - "\${NEXPRESS_DB_PORT:-5433}:5432"\n    environment:\n      POSTGRES_DB: nexpress\n      POSTGRES_USER: nexpress\n      POSTGRES_PASSWORD: nexpress\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n  app:\n    build:\n      context: ..\n      dockerfile: docker/Dockerfile\n    ports:\n      - "3000:3000"\n    environment:\n      DATABASE_URL: postgres://nexpress:nexpress@db:5432/nexpress\n      NX_SECRET: \${NX_SECRET}\n    depends_on:\n      - db\n\nvolumes:\n  pgdata:\n`;
}

function dockerfileTemplate(): string {
  return `FROM node:22-alpine AS base\nRUN corepack enable\n\nFROM base AS deps\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN pnpm install --frozen-lockfile\n\nFROM base AS builder\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN pnpm build\n\nFROM base AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=builder /app/.next/standalone ./\nCOPY --from=builder /app/.next/static ./.next/static\nCOPY --from=builder /app/public ./public\nEXPOSE 3000\nCMD ["node", "server.js"]\n`;
}

function envExampleTemplate(config: TemplateConfig): string {
  const databaseUrl =
    config.databaseMode === "remote-url"
      ? "postgres://user:password@host:5432/database"
      : "postgres://nexpress:nexpress@localhost:5433/nexpress";
  const s3Lines =
    config.storageMode === "s3"
      ? "S3_BUCKET=nexpress-media\nS3_REGION=us-east-1\nS3_ENDPOINT=http://localhost:9000\n"
      : "";

  return `DATABASE_URL=${databaseUrl}\nNX_SECRET=change-me-to-a-random-string\nSITE_URL=http://localhost:3000\n${s3Lines}`;
}

function envTemplate(config: TemplateConfig): string {
  return envExampleTemplate(config).replace(
    "NX_SECRET=change-me-to-a-random-string",
    `NX_SECRET=${config.secret}`,
  );
}

function nextConfigTemplate(): string {
  return `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  output: "standalone",\n  transpilePackages: ["@nexpress/admin", "@nexpress/editor", "@nexpress/blocks", "@nexpress/theme", "@nexpress/plugin-sdk"],\n  serverExternalPackages: ["@nexpress/core"],\n};\n\nexport default nextConfig;\n`;
}

function tsconfigTemplate(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
}

function postcssConfigTemplate(): string {
  return `export default {\n  plugins: {\n    "@tailwindcss/postcss": {},\n  },\n};\n`;
}

function gitignoreTemplate(): string {
  return `node_modules/\n.next/\ndist/\n.env\n*.generated.ts\n`;
}

function nextEnvTemplate(): string {
  return `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`;
}

function rootLayoutTemplate(config: TemplateConfig): string {
  return `import type { ReactNode } from "react";\n\nimport "./globals.css";\n\nexport const metadata = {\n  title: "${config.projectName}",\n  description: "A NexPress project scaffolded with create-nexpress.",\n};\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`;
}

function globalsCssTemplate(): string {
  return `@import "tailwindcss";\n\n:root {\n  color-scheme: light;\n  --background: #ffffff;\n  --foreground: #111827;\n}\n\nbody {\n  margin: 0;\n  min-height: 100vh;\n  background: var(--background);\n  color: var(--foreground);\n  font-family: Arial, Helvetica, sans-serif;\n}\n\na {\n  color: inherit;\n  text-decoration: none;\n}\n`;
}

function siteLayoutTemplate(config: TemplateConfig): string {
  return `import type { ReactNode } from "react";\n\nexport default function SiteLayout({ children }: { children: ReactNode }) {\n  return (\n    <div className="min-h-screen bg-white text-slate-900">\n      <header className="border-b border-slate-200 px-6 py-4">\n        <div className="mx-auto max-w-5xl text-lg font-semibold">${config.projectName}</div>\n      </header>\n      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>\n    </div>\n  );\n}\n`;
}

function homePageTemplate(config: TemplateConfig): string {
  const description = config.includeExampleContent
    ? "Start by editing the example collections or wiring your own content model."
    : "Start by defining your collections in src/nexpress.config.ts.";

  return `export default function HomePage() {\n  return (\n    <section className="space-y-4">\n      <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">NexPress</p>\n      <h1 className="text-4xl font-bold tracking-tight">Welcome to ${config.projectName}</h1>\n      <p className="max-w-2xl text-lg text-slate-600">${description}</p>\n    </section>\n  );\n}\n`;
}

function slugPageTemplate(config: TemplateConfig): string {
  const body = config.includeExampleContent
    ? "This catch-all route is ready for page rendering once you connect your collections."
    : "This catch-all route is ready for your custom page rendering logic.";

  return `export default function SitePage() {\n  return (\n    <section className="space-y-3">\n      <h1 className="text-3xl font-semibold">Dynamic page route</h1>\n      <p className="text-slate-600">${body}</p>\n    </section>\n  );\n}\n`;
}

function adminPageTemplate(config: TemplateConfig): string {
  return `export default function AdminPage() {\n  return (\n    <section className="space-y-3 p-6">\n      <h1 className="text-3xl font-semibold">${config.projectName} admin</h1>\n      <p className="text-slate-600">Install your dependencies, start the app, and connect the NexPress admin experience here.</p>\n    </section>\n  );\n}\n`;
}

function healthRouteTemplate(): string {
  return `export function GET(): Response {\n  return Response.json({ status: "ok" });\n}\n`;
}

function postsCollectionTemplate(): string {
  return `import { defineCollection } from "@nexpress/core";\n\nexport const postsCollection = defineCollection({\n  slug: "posts",\n  labels: { singular: "Post", plural: "Posts" },\n  slugField: { useField: "title", unique: true },\n  admin: {\n    defaultSort: "-publishedAt",\n    listColumns: ["title", "status", "publishedAt"],\n  },\n  versions: { drafts: true },\n  fields: [\n    {\n      name: "title",\n      type: "text",\n      required: true,\n    },\n    {\n      name: "excerpt",\n      type: "textarea",\n    },\n    {\n      name: "content",\n      type: "richText",\n      required: true,\n    },\n    {\n      name: "status",\n      type: "select",\n      defaultValue: "draft",\n      options: [\n        { label: "Draft", value: "draft" },\n        { label: "Published", value: "published" },\n      ],\n    },\n    {\n      name: "publishedAt",\n      type: "date",\n    },\n  ],\n});\n`;
}

function pagesCollectionTemplate(): string {
  return `import { defineCollection } from "@nexpress/core";\n\nexport const pagesCollection = defineCollection({\n  slug: "pages",\n  labels: { singular: "Page", plural: "Pages" },\n  slugField: { useField: "title", unique: true },\n  admin: {\n    defaultSort: "title",\n    listColumns: ["title", "updatedAt"],\n  },\n  versions: { drafts: true },\n  fields: [\n    {\n      name: "title",\n      type: "text",\n      required: true,\n    },\n    {\n      name: "heroTitle",\n      type: "text",\n    },\n    {\n      name: "summary",\n      type: "textarea",\n    },\n    {\n      name: "content",\n      type: "richText",\n      required: true,\n    },\n  ],\n});\n`;
}

function readmeTemplate(config: TemplateConfig): string {
  const dockerStep = config.dockerSetup
    ? "docker compose -f docker/docker-compose.yml up -d db\npnpm dev"
    : "pnpm dev";
  const storage = config.storageMode === "s3" ? "S3/MinIO" : "Local filesystem";
  const database =
    config.databaseMode === "remote-url" ? "Remote PostgreSQL URL" : "Local Docker PostgreSQL";

  return `# ${config.projectName}\n\nScaffolded with create-nexpress.\n\n## Selected options\n\n- Database: ${database}\n- Storage: ${storage}\n- Example content: ${config.includeExampleContent ? "Yes" : "No"}\n- Docker setup: ${config.dockerSetup ? "Yes" : "No"}\n\n## Getting started\n\n\`\`\`bash\n${dockerStep}\n\`\`\`\n\nAdmin: http://localhost:3000/admin\n`;
}
