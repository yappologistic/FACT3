import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "subagent_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN subagent_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    WITH subagent_ids AS (
      SELECT activity.thread_id, receiver.value AS subagent_id
      FROM projection_thread_activities AS activity,
        json_each(COALESCE(json_extract(activity.payload_json, '$.collab.receiverThreadIds'), '[]'))
          AS receiver
      WHERE json_extract(activity.payload_json, '$.itemType') = 'collab_agent_tool_call'

      UNION

      SELECT activity.thread_id, receiver.value AS subagent_id
      FROM projection_thread_activities AS activity,
        json_each(
          COALESCE(json_extract(activity.payload_json, '$.data.item.receiverThreadIds'), '[]')
        ) AS receiver
      WHERE json_extract(activity.payload_json, '$.itemType') = 'collab_agent_tool_call'

      UNION

      SELECT activity.thread_id, receiver.value AS subagent_id
      FROM projection_thread_activities AS activity,
        json_each(COALESCE(json_extract(activity.payload_json, '$.data.receiverThreadIds'), '[]'))
          AS receiver
      WHERE json_extract(activity.payload_json, '$.itemType') = 'collab_agent_tool_call'

      UNION

      SELECT
        activity.thread_id,
        COALESCE(
          json_extract(activity.payload_json, '$.data.item.agentThreadId'),
          json_extract(activity.payload_json, '$.data.agentThreadId')
        ) AS subagent_id
      FROM projection_thread_activities AS activity
      WHERE json_extract(activity.payload_json, '$.itemType') = 'collab_agent_tool_call'
        AND COALESCE(
          json_extract(activity.payload_json, '$.data.item.agentPath'),
          json_extract(activity.payload_json, '$.data.agentPath')
        ) != '/root'
        AND COALESCE(
          json_extract(activity.payload_json, '$.data.item.agentThreadId'),
          json_extract(activity.payload_json, '$.data.agentThreadId')
        ) IS NOT NULL
    )
    UPDATE projection_threads
    SET subagent_count = COALESCE((
      SELECT COUNT(DISTINCT subagent_ids.subagent_id)
      FROM subagent_ids
      WHERE subagent_ids.thread_id = projection_threads.thread_id
        AND subagent_ids.subagent_id IS NOT NULL
        AND trim(CAST(subagent_ids.subagent_id AS TEXT)) != ''
    ), 0)
  `;
});
