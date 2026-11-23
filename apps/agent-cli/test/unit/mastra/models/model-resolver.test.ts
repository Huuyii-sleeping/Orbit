import { expect, it } from "vitest";
import { ModelCatalog } from "../../../../src/mastra/models/model-catalog.js";
import { resolveMastraModel } from "../../../../src/mastra/models/model-resolver.js";

it("连接缓存隔离供应商、地址、模型和凭据，不序列化 SDK 私有状态", async () => {
  const catalog = (key: string, baseUrl = "https://one.example/v1") =>
    new ModelCatalog({
      env: { TEST_KEY: key },
      config: {
        providers: { test: { provider: "openai-compatible", baseUrl, apiKeyEnv: "TEST_KEY" } },
      },
    });
  const first = await resolveMastraModel("test/model", catalog("secret-one"));
  expect((await resolveMastraModel("test/model", catalog("secret-one"))).modelConfigKey).toBe(
    first.modelConfigKey,
  );
  expect((await resolveMastraModel("test/model", catalog("secret-two"))).modelConfigKey).not.toBe(
    first.modelConfigKey,
  );
  expect(
    (await resolveMastraModel("test/model", catalog("secret-one", "https://two.example/v1")))
      .modelConfigKey,
  ).not.toBe(first.modelConfigKey);
  expect((await resolveMastraModel("test/another", catalog("secret-one"))).modelConfigKey).not.toBe(
    first.modelConfigKey,
  );
  expect(first.modelConfigKey).not.toContain("secret-one");
});
