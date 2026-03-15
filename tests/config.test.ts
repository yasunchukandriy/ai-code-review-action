import * as core from "@actions/core";
import { getConfig } from "../src/config";

jest.mock("@actions/core");

const mockedCore = jest.mocked(core);

function setupInputs(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    "anthropic-api-key": "sk-ant-test-key",
    "github-token": "ghp_test_token",
    model: "",
    "max-files": "",
    "review-scope": "",
    language: "",
    concurrency: "",
    ...overrides,
  };

  mockedCore.getInput.mockImplementation((name: string) => {
    return defaults[name] ?? "";
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getConfig", () => {
  it("returns correct config with all inputs present", () => {
    setupInputs({
      model: "claude-opus-4-20250514",
      "max-files": "30",
      "review-scope": "bugs,security",
      language: "de",
    });

    const config = getConfig();

    expect(config.anthropicApiKey).toBe("sk-ant-test-key");
    expect(config.githubToken).toBe("ghp_test_token");
    expect(config.model).toBe("claude-opus-4-20250514");
    expect(config.maxFiles).toBe(30);
    expect(config.reviewScope).toEqual(["bugs", "security"]);
    expect(config.language).toBe("de");
  });

  it("uses default model when input is empty", () => {
    setupInputs();
    const config = getConfig();
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("uses default maxFiles when input is empty", () => {
    setupInputs();
    const config = getConfig();
    expect(config.maxFiles).toBe(20);
  });

  it("uses default language when input is empty", () => {
    setupInputs();
    const config = getConfig();
    expect(config.language).toBe("en");
  });

  it("uses default review scope when input is empty", () => {
    setupInputs();
    const config = getConfig();
    expect(config.reviewScope).toEqual(["bugs", "solid", "security", "performance"]);
  });

  it("defaults maxFiles to 20 and warns when value is NaN", () => {
    setupInputs({ "max-files": "abc" });
    const config = getConfig();
    expect(config.maxFiles).toBe(20);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid max-files value, using default of 20");
  });

  it("defaults maxFiles to 20 and warns when value is < 1", () => {
    setupInputs({ "max-files": "0" });
    const config = getConfig();
    expect(config.maxFiles).toBe(20);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid max-files value, using default of 20");
  });

  it("filters out invalid scopes", () => {
    setupInputs({ "review-scope": "bugs,invalid,security,nonsense" });
    const config = getConfig();
    expect(config.reviewScope).toEqual(["bugs", "security"]);
  });

  it("falls back to defaults and warns when all scopes are invalid", () => {
    setupInputs({ "review-scope": "foo,bar,baz" });
    const config = getConfig();
    expect(config.reviewScope).toEqual(["bugs", "solid", "security", "performance"]);
    expect(mockedCore.warning).toHaveBeenCalledWith(expect.stringContaining("No valid review scopes"));
  });

  it("calls setSecret with the API key", () => {
    setupInputs();
    getConfig();
    expect(mockedCore.setSecret).toHaveBeenCalledWith("sk-ant-test-key");
  });

  it("trims and lowercases scope values", () => {
    setupInputs({ "review-scope": " Bugs , SECURITY , Style " });
    const config = getConfig();
    expect(config.reviewScope).toEqual(["bugs", "security", "style"]);
  });

  it("defaults concurrency to 5 when input is empty", () => {
    setupInputs();
    const config = getConfig();
    expect(config.concurrency).toBe(5);
  });

  it("parses concurrency from input", () => {
    setupInputs({ concurrency: "10" });
    const config = getConfig();
    expect(config.concurrency).toBe(10);
  });

  it("rejects NaN concurrency with warning", () => {
    setupInputs({ concurrency: "abc" });
    const config = getConfig();
    expect(config.concurrency).toBe(5);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid concurrency value, using default of 5");
  });

  it("caps concurrency at 20", () => {
    setupInputs({ concurrency: "50" });
    const config = getConfig();
    expect(config.concurrency).toBe(5);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid concurrency value, using default of 5");
  });

  it("rejects zero concurrency", () => {
    setupInputs({ concurrency: "0" });
    const config = getConfig();
    expect(config.concurrency).toBe(5);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid concurrency value, using default of 5");
  });

  it("caps maxFiles at 100", () => {
    setupInputs({ "max-files": "200" });
    const config = getConfig();
    expect(config.maxFiles).toBe(20);
    expect(mockedCore.warning).toHaveBeenCalledWith("Invalid max-files value, using default of 20");
  });

  it("throws on whitespace-only API key", () => {
    setupInputs({ "anthropic-api-key": "   " });
    expect(() => getConfig()).toThrow("anthropic-api-key must not be empty or whitespace-only");
  });

  it("masks API key before validation runs", () => {
    setupInputs({ "max-files": "abc" });
    getConfig();
    expect(mockedCore.setSecret).toHaveBeenCalledWith("sk-ant-test-key");
  });
});
