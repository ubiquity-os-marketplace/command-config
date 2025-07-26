import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

async function fetchAndUpdateModels(): Promise<void> {
  try {
    console.log("Fetching available models from OpenRouter...");

    const response = await fetch("https://openrouter.ai/api/v1/models");
    const data = (await response.json()) as OpenRouterResponse;

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid response format from OpenRouter API");
    }

    const modelIds = data.data.map((model: OpenRouterModel) => model.id).sort((a, b) => a.localeCompare(b));
    console.log(`Found ${modelIds.length} models`);

    const modelsFilePath = path.join(dirname, "../.models.json");
    fs.writeFileSync(modelsFilePath, JSON.stringify(modelIds, null, 2));
    console.log(`Models saved to ${modelsFilePath}`);

    const pluginInputPath = path.join(dirname, "../src/types/plugin-input.ts");
    let pluginInputContent = fs.readFileSync(pluginInputPath, "utf8");

    const examplesRegex = /examples:\s*\[[\s\S]*?\]/;
    const newExamples = `examples: [
        // cspell:disable
${modelIds.map((model) => `"${model}"`).join(",\n")},
        // cspell:enable
      ]`;

    if (examplesRegex.test(pluginInputContent)) {
      pluginInputContent = pluginInputContent.replace(examplesRegex, newExamples);
      fs.writeFileSync(pluginInputPath, pluginInputContent);
      console.log(`Updated model examples in plugin-input.ts with ${modelIds.length} models`);
    } else {
      console.warn("Could not find examples section in plugin-input.ts");
    }
  } catch (error) {
    console.error("Error updating models:", (error as Error).message);
    process.exit(1);
  }
}

fetchAndUpdateModels().catch((error) => {
  console.error("Failed to update models:", error);
  process.exit(1);
});
