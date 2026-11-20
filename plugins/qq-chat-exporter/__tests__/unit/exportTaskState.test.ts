import test from "node:test"
import assert from "node:assert/strict"

import {
    mergeExportTaskResync,
    mergeExportTaskUpdate,
    mergeRemoteExportTasks,
} from "../../../../qce-v4-tool/lib/export-task-state.js"
import type { ExportTask } from "../../../../qce-v4-tool/types/api.js"

function task(status: ExportTask["status"], progress = 50): ExportTask {
    return {
        id: "task-1",
        peer: { chatType: 2, peerUid: "group-1", guildId: "" },
        sessionName: "测试群",
        status,
        progress,
        format: "HTML",
        createdAt: "2026-07-13T00:00:00.000Z",
    }
}

test("cancelled task ignores late running and completed progress", () => {
    const cancelled = task("cancelled")
    assert.equal(
        mergeExportTaskUpdate(cancelled, {
            taskId: cancelled.id,
            progress: 80,
            status: "running",
        }),
        cancelled,
    )
    assert.equal(
        mergeExportTaskUpdate(cancelled, {
            taskId: cancelled.id,
            progress: 100,
            status: "completed",
        }),
        cancelled,
    )
})

test("stale polling response cannot revive a locally cancelled task", () => {
    const cancelled = task("cancelled")
    const merged = mergeRemoteExportTasks(
        [cancelled],
        [{ ...cancelled, status: "running", progress: 75 }],
    )
    assert.equal(merged[0], cancelled)
})

test("a new attempt resumes the failed task and rejects updates from the previous attempt", () => {
    const failed: ExportTask = { ...task("failed"), canResume: true, error: "读取超时" }
    const resumed = mergeExportTaskUpdate(failed, {
        taskId: failed.id,
        attempt: 1,
        status: "running",
        messageCount: 12,
    })

    assert.equal(resumed.id, failed.id)
    assert.equal(resumed.status, "running")
    assert.equal(resumed.messageCount, 12)
    assert.equal(resumed.error, undefined)
    assert.equal(mergeRemoteExportTasks([resumed], [failed])[0], resumed)
    assert.equal(mergeExportTaskResync(resumed, {
        taskId: failed.id,
        status: "failed",
        error: failed.error,
        progress: 50,
        messageCount: 12,
    }), resumed)
})
