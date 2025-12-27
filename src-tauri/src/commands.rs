use crate::db::AppState;
use crate::email::{
    self, AttachmentContent, AttachmentInfo, BatchCheckResult, CheckResult, EmailAccount,
    ImportResult, MailRecord,
};
use tauri::State;

#[tauri::command]
/// 添加邮箱账号
pub async fn add_email(
    state: State<'_, AppState>,
    email: String,
    password: String,
    client_id: String,
    refresh_token: String,
    mail_type: Option<String>,
) -> Result<i64, String> {
    match email::add_email(
        &state.db,
        &email,
        &password,
        &client_id,
        &refresh_token,
        mail_type.as_deref(),
    )
    .await
    {
        Ok(id) => Ok(id),
        Err(e) => Err(format!("添加邮箱失败: {}", e)),
    }
}

#[tauri::command]
/// 批量导入邮箱
pub async fn import_emails(
    state: State<'_, AppState>,
    input: String,
) -> Result<ImportResult, String> {
    match email::import_emails_batch(&state.db, &input).await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("批量导入邮箱失败: {}", e)),
    }
}

#[tauri::command]
/// 获取邮箱列表
pub async fn get_emails(state: State<'_, AppState>) -> Result<Vec<EmailAccount>, String> {
    match email::get_emails(&state.db).await {
        Ok(emails) => Ok(emails),
        Err(e) => Err(format!("获取邮箱列表失败: {}", e)),
    }
}

#[tauri::command]
/// 删除邮箱
pub async fn delete_email(state: State<'_, AppState>, email_id: i64) -> Result<bool, String> {
    match email::delete_email(&state.db, email_id).await {
        Ok(success) => Ok(success),
        Err(e) => Err(format!("删除邮箱失败: {}", e)),
    }
}

#[tauri::command]
/// Outlook 单邮箱收件
pub async fn check_outlook_email(
    state: State<'_, AppState>,
    email_id: i64,
    folder: Option<String>,
) -> Result<CheckResult, String> {
    let folder = folder.unwrap_or_else(|| "INBOX".to_string());
    match email::check_outlook_email(&state.db, email_id, &folder).await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("收件失败: {}", e)),
    }
}

#[tauri::command]
/// Outlook 批量收件
pub async fn batch_check_outlook_emails(
    state: State<'_, AppState>,
    email_ids: Vec<i64>,
    folder: Option<String>,
) -> Result<BatchCheckResult, String> {
    let folder = folder.unwrap_or_else(|| "INBOX".to_string());
    match email::batch_check_outlook_emails(&state.db, email_ids, &folder).await {
        Ok(result) => Ok(result),
        Err(e) => Err(format!("批量收件失败: {}", e)),
    }
}

#[tauri::command]
/// 获取邮件记录
pub async fn get_mail_records(
    state: State<'_, AppState>,
    email_id: i64,
) -> Result<Vec<MailRecord>, String> {
    match email::get_mail_records(&state.db, email_id).await {
        Ok(records) => Ok(records),
        Err(e) => Err(format!("获取邮件记录失败: {}", e)),
    }
}

#[tauri::command]
/// 获取附件列表
pub async fn get_attachments(
    state: State<'_, AppState>,
    mail_id: i64,
) -> Result<Vec<AttachmentInfo>, String> {
    match email::get_attachments(&state.db, mail_id).await {
        Ok(attachments) => Ok(attachments),
        Err(e) => Err(format!("获取附件列表失败: {}", e)),
    }
}

#[tauri::command]
/// 获取附件内容
pub async fn get_attachment_content(
    state: State<'_, AppState>,
    attachment_id: i64,
) -> Result<AttachmentContent, String> {
    match email::get_attachment_content(&state.db, attachment_id).await {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("获取附件内容失败: {}", e)),
    }
}
