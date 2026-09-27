import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when required env vars are missing", () => {
    delete process.env.SECRET_WORD;
    delete process.env.PROVIDER;
    delete process.env.PROVIDER_API_KEY;
    delete process.env.PROVIDER_MODEL_ID;

    expect(() => loadConfig()).toThrow(/SECRET_WORD/);
  });

  it("loads config with valid values and sensible defaults", () => {
    process.env.SECRET_WORD = "my-secret-123";
    process.env.PROVIDER = "opencode-go";
    process.env.PROVIDER_API_KEY = "oc_test_key";
    process.env.PROVIDER_MODEL_ID = "claude-3-7-sonnet";

    const config = loadConfig();

    expect(config.secretWord).toBe("my-secret-123");
    expect(config.provider).toBe("opencode-go");
    expect(config.providerApiKey).toBe("oc_test_key");
    expect(config.providerModelId).toBe("claude-3-7-sonnet");
    expect(config.dataDir).toBe("/data");
    expect(config.tz).toBe("UTC");
    expect(config.logLevel).toBe("info");
    expect(config.thinkingLevel).toBe("medium");
    expect(config.minScheduleIntervalSeconds).toBe(60);
    expect(config.maxSchedulesPerSession).toBe(25);
    expect(config.qrHttpPort).toBeUndefined();
  });

  it("respects custom optional env vars", () => {
    process.env.SECRET_WORD = "custom-secret";
    process.env.PROVIDER = "custom-provider";
    process.env.PROVIDER_API_KEY = "custom_key";
    process.env.PROVIDER_MODEL_ID = "custom-model";
    process.env.DATA_DIR = "./local-data";
    process.env.TZ = "America/New_York";
    process.env.LOG_LEVEL = "debug";
    process.env.THINKING_LEVEL = "high";
    process.env.MIN_SCHEDULE_INTERVAL_SECONDS = "120";
    process.env.MAX_SCHEDULES_PER_SESSION = "50";
    process.env.QR_HTTP_PORT = "8080";

    const config = loadConfig();

    expect(config.dataDir).toBe("./local-data");
    expect(config.tz).toBe("America/New_York");
    expect(config.logLevel).toBe("debug");
    expect(config.thinkingLevel).toBe("high");
    expect(config.minScheduleIntervalSeconds).toBe(120);
    expect(config.maxSchedulesPerSession).toBe(50);
    expect(config.qrHttpPort).toBe(8080);
  });
});
