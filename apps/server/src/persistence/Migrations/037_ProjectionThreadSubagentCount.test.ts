import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("037_ProjectionThreadSubagentCount", (it) => {
  it.effect("backfills distinct sub-agents into the lightweight thread shell summary", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        ) VALUES (
          'thread-subagents',
          'project-subagents',
          'Sub-agent task',
          '{"instanceId":"codex","model":"gpt-5.6-sol"}',
          'full-access',
          'default',
          '2026-08-03T00:00:00.000Z',
          '2026-08-03T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        ) VALUES
          (
            'activity-spawn',
            'thread-subagents',
            'turn-1',
            'info',
            'tool.started',
            'Spawn agents',
            '{"itemType":"collab_agent_tool_call","collab":{"receiverThreadIds":["agent-1","agent-2"]}}',
            1,
            '2026-08-03T00:00:01.000Z'
          ),
          (
            'activity-update',
            'thread-subagents',
            'turn-1',
            'info',
            'tool.updated',
            'Update agent',
            '{"itemType":"collab_agent_tool_call","data":{"item":{"agentThreadId":"agent-1","agentPath":"/root/reviewer"}}}',
            2,
            '2026-08-03T00:00:02.000Z'
          ),
          (
            'activity-root',
            'thread-subagents',
            'turn-1',
            'info',
            'tool.updated',
            'Root state',
            '{"itemType":"collab_agent_tool_call","data":{"item":{"agentThreadId":"root-agent","agentPath":"/root"}}}',
            3,
            '2026-08-03T00:00:03.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 37 });

      const rows = yield* sql<{ readonly subagentCount: number }>`
        SELECT subagent_count AS "subagentCount"
        FROM projection_threads
        WHERE thread_id = 'thread-subagents'
      `;
      assert.deepEqual(rows, [{ subagentCount: 2 }]);
    }),
  );
});
