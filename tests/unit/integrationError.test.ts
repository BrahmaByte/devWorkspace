import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { connectionErrorMessage } from "../../src/application/services/integrationError";

void describe("Integration connection errors", () => {
  void it("maps authentication and endpoint failures to actionable messages", () => {
    assert.match(connectionErrorMessage("jira", { status: 401 }), /rejected/u);
    assert.match(
      connectionErrorMessage("confluence", { status: 403 }),
      /permissions/u,
    );
    assert.match(connectionErrorMessage("jira", { status: 404 }), /base URL/u);
  });

  void it("never exposes raw network errors or credentials", () => {
    const secret = "fake-sensitive-token-value";
    const message = connectionErrorMessage(
      "confluence",
      new Error(`request failed with ${secret}`),
    );
    assert.doesNotMatch(message, new RegExp(secret, "u"));
    assert.match(message, /network access/u);
  });

  void it("explains invalid URL and missing-token configuration", () => {
    assert.match(
      connectionErrorMessage("jira", new Error("Jira URL must use HTTPS.")),
      /valid HTTPS/u,
    );
    assert.match(
      connectionErrorMessage(
        "confluence",
        new Error("A personal access token is required."),
      ),
      /required/u,
    );
  });
});
