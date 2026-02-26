import { readFileSync, writeFileSync, mkdirSync } from "fs";

const knowledge = readFileSync("data/knowledge.md", "utf-8");
mkdirSync("public/api", { recursive: true });
writeFileSync("public/api/knowledge.json", JSON.stringify({ content: knowledge }));
console.log("Knowledge base built successfully.");
