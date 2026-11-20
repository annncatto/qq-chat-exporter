use axum::extract::{Extension, Path, State};
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    apply_task_patch, estimate_fetch_progress, generate_download_url, has_export_queue_capacity,
    prepare_export_request, reserve_export_file_name, run_export_task, standalone_guard_with,
    ExportInput, ExportMode,
};
use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::routes::tasks::normalize_task_for_frontend;
use crate::api::state::SharedState;
use crate::fetcher::BatchFetchResult;

/// Cursor and durable spool length after the last successful history page.
/// Kept in the task database and removed from API and WebSocket responses.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct HistoryCheckpoint {
    pub account_uid: String,
    pub byte_len: u64,
    pub message_count: usize,
    pub next_seq: Option<String>,
    pub next_message_id: Option<String>,
    pub start_time_ms: i64,
    pub end_time_ms: i64,
    pub batch_size: i64,
    pub batch_count: i64,
    pub max_seq_seen: Option<i64>,
    pub min_seq_seen: Option<i64>,
}

impl HistoryCheckpoint {
    pub(super) fn previous_batch(&self) -> BatchFetchResult {
        BatchFetchResult {
            has_more: true,
            next_seq: self.next_seq.clone(),
            next_message_id: self.next_message_id.clone(),
            ..BatchFetchResult::default()
        }
    }

    pub(super) fn progress(&self) -> i64 {
        estimate_fetch_progress(self.max_seq_seen, self.min_seq_seen, self.batch_count)
    }
}

pub(super) async fn current_account_uid(state: &SharedState) -> Option<String> {
    let account = state.napcat.self_info().await.ok()?;
    if account.get("online").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    account
        .get("uid")
        .and_then(Value::as_str)
        .filter(|uid| !uid.is_empty())
        .map(str::to_owned)
}

fn resumable_checkpoint(task: &Value) -> Option<HistoryCheckpoint> {
    if task.get("status").and_then(Value::as_str) != Some("failed")
        || task.get("format").and_then(Value::as_str) != Some("STREAMING_ZIP")
    {
        return None;
    }
    let checkpoint: HistoryCheckpoint =
        serde_json::from_value(task.get("historyCheckpoint")?.clone()).ok()?;
    (checkpoint.byte_len > 0
        && checkpoint.message_count > 0
        && (checkpoint.next_seq.is_some() || checkpoint.next_message_id.is_some()))
    .then_some(checkpoint)
}

fn not_resumable() -> ApiError {
    ApiError::new(
        ErrorType::Api,
        "该任务没有可用的续跑断点",
        "EXPORT_NOT_RESUMABLE",
    )
    .with_status(axum::http::StatusCode::CONFLICT)
}

/// `POST /api/tasks/:taskId/resume` — continue a failed streaming ZIP export.
pub async fn resume_streaming_zip(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Path(task_id): Path<String>,
) -> Response {
    match queue_resume(&state, task_id).await {
        Ok(task) => response::success(task, &request_id),
        Err(error) => response::error(&error, &request_id),
    }
}

async fn queue_resume(state: &SharedState, task_id: String) -> Result<Value, ApiError> {
    if let Some(error) = standalone_guard_with(state, "继续导出聊天记录") {
        return Err(error);
    }
    let task = state
        .export_tasks
        .lock()
        .await
        .get(&task_id)
        .cloned()
        .ok_or_else(|| ApiError::not_found("任务不存在", "TASK_NOT_FOUND"))?;
    let checkpoint = resumable_checkpoint(&task).ok_or_else(not_resumable)?;
    let path = state
        .path_manager
        .export_checkpoint_path(&task_id)
        .ok_or_else(not_resumable)?;
    let stats = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|_| not_resumable())?;
    if !stats.is_file() || stats.len() < checkpoint.byte_len {
        return Err(not_resumable());
    }
    if current_account_uid(state).await.as_deref() != Some(checkpoint.account_uid.as_str()) {
        return Err(ApiError::validation(
            "请登录开始该导出时使用的 QQ 账号",
            "EXPORT_ACCOUNT_MISMATCH",
        ));
    }
    let req = prepare_export_request(state, &task).await?;
    let old_name = task
        .get("fileName")
        .and_then(Value::as_str)
        .filter(|name| name.ends_with(".zip") && !name.contains(['/', '\\', ':']))
        .ok_or_else(not_resumable)?;
    let previous_attempt = task.get("attempt").and_then(Value::as_u64).unwrap_or(0);
    let (queued, file_name) = {
        let mut tasks = state.export_tasks.lock().await;
        if !has_export_queue_capacity(&tasks) {
            return Err(ApiError::new(
                ErrorType::Api,
                "排队中的导出任务已达到上限",
                "EXPORT_TASK_LIMIT_REACHED",
            )
            .with_status(axum::http::StatusCode::TOO_MANY_REQUESTS));
        }
        let current = tasks.get_mut(&task_id).ok_or_else(not_resumable)?;
        // Recheck after bridge/filesystem I/O. Only one caller may enqueue this attempt.
        if resumable_checkpoint(current).is_none()
            || current.get("attempt").and_then(Value::as_u64).unwrap_or(0) != previous_attempt
            || state
                .running_export_cancel_flags
                .lock()
                .await
                .contains_key(&task_id)
        {
            return Err(not_resumable());
        }
        let file_name = reserve_export_file_name(&req.output_dir, old_name);
        let download_url = generate_download_url(
            &req.output_dir.join(&file_name),
            &file_name,
            &req.custom_output_dir,
            "/downloads/",
        );
        let queued = apply_task_patch(
            Some(current),
            &json!({
                "attempt": previous_attempt + 1,
                "status": "queued",
                "message": format!("等待继续导出，已保存 {} 条消息", checkpoint.message_count),
                "progress": checkpoint.progress(),
                "messageCount": checkpoint.message_count,
                "fileName": file_name,
                "downloadUrl": download_url,
                "error": null,
                "errorCode": null,
                "errorHttpStatus": null,
                "completedAt": null,
            }),
        )
        .expect("the checked task is failed and can be updated");
        if let Err(error) = state.db.save_task(&queued, &queued, true).await {
            tracing::warn!("[ApiServer] 保存续跑任务失败: {error}");
        }
        let view = normalize_task_for_frontend(&queued);
        state.broadcast_ws(&json!({ "type": "export_progress", "data": view }));
        (view, file_name)
    };

    let state = state.clone();
    tokio::spawn(run_export_task(
        state,
        task_id,
        req,
        "STREAMING_ZIP".to_string(),
        file_name,
        ExportMode::StreamingZip,
        ExportInput::Resume(checkpoint),
    ));
    Ok(queued)
}
