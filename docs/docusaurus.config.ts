import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "KeeperGate",
  tagline: "Drop KeeperHub on-chain execution into any agent framework in 3 lines.",
  favicon: "img/favicon.ico",

  url: "https://chronogist.github.io",
  baseUrl: "/",

  organizationName: "chronogist",
  projectName: "keeper-gate",

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "KeeperGate",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/chronogist/keeper-gate",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/" },
            { label: "Getting Started", to: "/getting-started" },
            { label: "Core Concepts", to: "/concepts" },
          ],
        },
        {
          title: "Integrations",
          items: [
            { label: "ElizaOS", to: "/integrations/elizaos" },
            { label: "LangChain", to: "/integrations/langchain" },
            { label: "OpenClaw", to: "/integrations/openclaw" },
          ],
        },
        {
          title: "Links",
          items: [
            { label: "GitHub", href: "https://github.com/chronogist/keeper-gate" },
            { label: "KeeperHub", href: "https://keeperhub.com" },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} chronogist. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
