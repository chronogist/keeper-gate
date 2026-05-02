import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    "getting-started",
    "concepts",
    {
      type: "category",
      label: "Integrations",
      items: [
        "integrations/elizaos",
        "integrations/langchain",
        "integrations/openclaw",
      ],
    },
    "api-reference",
  ],
};

export default sidebars;
