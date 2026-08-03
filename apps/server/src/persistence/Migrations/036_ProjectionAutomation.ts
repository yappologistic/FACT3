import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (!projectColumns.some((column) => column.name === "automation_policy_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN automation_policy_json TEXT
    `;
  }

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "automation_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN automation_json TEXT
    `;
  }
});
