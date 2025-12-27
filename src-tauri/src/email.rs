use anyhow::{anyhow, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{DateTime, Utc};
use imap::Authenticator;
use mailparse::{DispositionType, MailHeaderMap, ParsedMail};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::graph_api;
use crate::proxy::{create_http_client, ProxyConfig};
use crate::token_cache;

/// API 模式
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiMode {
    /// 自动选择：根据 Token 权限自动判断使用 Graph API 还是 IMAP
    Auto,
    /// 强制使用 IMAP 协议
    Imap,
    /// 强制使用 Graph API
    Graph,
}

impl Default for ApiMode {
    fn default() -> Self {
        // 默认为自动选择模式
        ApiMode::Auto
    }
}

impl From<Option<String>> for ApiMode {
    fn from(s: Option<String>) -> Self {
        match s.as_deref() {
            Some("graph") => ApiMode::Graph,
            Some("imap") => ApiMode::Imap,
            Some("auto") => ApiMode::Auto,
            _ => ApiMode::Auto, // 默认自动选择
        }
    }
}

/// 邮箱账号信息
#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct EmailAccount {
    pub id: i64,
    pub email: String,
    /// 邮箱密码（前端显示/复制使用）
    pub password: String,
    pub mail_type: String,
    pub client_id: String,
    pub refresh_token: String,
    pub last_check_time: Option<String>,
    pub api_mode: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_url: Option<String>,
    pub default_folder: Option<String>,
}

/// 邮件记录
#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct MailRecord {
    pub id: i64,
    pub email_id: i64,
    pub subject: Option<String>,
    pub sender: Option<String>,
    pub received_time: Option<String>,
    pub content: Option<String>,
    pub folder: Option<String>,
    pub has_attachments: i64,
}

/// 附件信息
#[derive(Debug, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct AttachmentInfo {
    pub id: i64,
    pub mail_id: i64,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub size: Option<i64>,
}

/// 附件内容
#[derive(Debug, serde::Serialize)]
pub struct AttachmentContent {
    pub id: i64,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub content_base64: String,
}

/// 收件结果
#[derive(Debug, serde::Serialize)]
pub struct CheckResult {
    pub email_id: i64,
    pub success: bool,
    pub fetched: usize,
    pub saved: usize,
    pub message: String,
}

/// 批量收件结果
#[derive(Debug, serde::Serialize)]
pub struct BatchCheckResult {
    pub success_count: usize,
    pub failed_count: usize,
    pub results: Vec<CheckResult>,
}

/// 批量导入结果
#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub success_count: usize,
    pub failed_count: usize,
    pub failed_lines: Vec<String>,
}

/// Outlook OAuth2 认证器
struct OutlookAuthenticator {
    user: String,
    access_token: String,
}

impl Authenticator for OutlookAuthenticator {
    type Response = String;

    fn process(&self, _: &[u8]) -> Self::Response {
        format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            self.user, self.access_token
        )
    }
}

/// Outlook 令牌响应
#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Token 刷新结果（包含权限信息）
#[derive(Debug)]
pub struct TokenRefreshResult {
    pub access_token: String,
    pub expires_in: i64,
    pub supports_graph: bool,
}

/// 收件用邮箱信息
#[allow(dead_code)]
#[derive(sqlx::FromRow)]
struct OutlookAccount {
    id: i64,
    email: String,
    mail_type: Option<String>,
    client_id: String,
    refresh_token: String,
    last_check_time: Option<String>,
    api_mode: Option<String>,
    proxy_type: Option<String>,
    proxy_url: Option<String>,
    default_folder: Option<String>,
}

/// 附件输入数据
struct AttachmentInput {
    filename: String,
    content_type: String,
    content: Vec<u8>,
}

/// 抓取到的邮件记录
struct MailFetchRecord {
    subject: Option<String>,
    sender: Option<String>,
    received_time: Option<String>,
    content: String,
    folder: String,
    attachments: Vec<AttachmentInput>,
}

/// 添加邮箱账号
pub async fn add_email(
    pool: &Pool<Sqlite>,
    email: &str,
    password: &str,
    client_id: &str,
    refresh_token: &str,
    mail_type: Option<&str>,
) -> Result<i64> {
    let mail_type = mail_type.unwrap_or("outlook");

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO emails (email, password, client_id, refresh_token, mail_type) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(email)
    .bind(password)
    .bind(client_id)
    .bind(refresh_token)
    .bind(mail_type)
    .fetch_one(pool)
    .await?;

    Ok(id)
}

/// 添加或覆盖邮箱账号
pub async fn add_or_update_email(
    pool: &Pool<Sqlite>,
    email: &str,
    password: &str,
    client_id: &str,
    refresh_token: &str,
    mail_type: Option<&str>,
) -> Result<i64> {
    let mail_type = mail_type.unwrap_or("outlook");

    let id: i64 = sqlx::query_scalar(
        r#"INSERT INTO emails (email, password, client_id, refresh_token, mail_type)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(email) DO UPDATE
SET password = excluded.password,
    client_id = excluded.client_id,
    refresh_token = excluded.refresh_token,
    mail_type = excluded.mail_type,
    updated_at = CURRENT_TIMESTAMP
RETURNING id"#,
    )
    .bind(email)
    .bind(password)
    .bind(client_id)
    .bind(refresh_token)
    .bind(mail_type)
    .fetch_one(pool)
    .await?;

    Ok(id)
}

/// 批量导入邮箱
pub async fn import_emails_batch(pool: &Pool<Sqlite>, input: &str) -> Result<ImportResult> {
    let mut success_count = 0;
    let mut failed_count = 0;
    let mut failed_lines = Vec::new();

    for (line_no, line) in input.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split("----").collect();
        if parts.len() != 4 {
            failed_count += 1;
            failed_lines.push(format!(
                "第 {} 行: 格式错误 (期望 4 段，实际 {})",
                line_no + 1,
                parts.len()
            ));
            continue;
        }

        let email = parts[0].trim();
        let password = parts[1].trim();
        let client_id = parts[2].trim();
        let refresh_token = parts[3].trim();

        if email.is_empty()
            || password.is_empty()
            || client_id.is_empty()
            || refresh_token.is_empty()
        {
            failed_count += 1;
            failed_lines.push(format!("第 {} 行: 存在空字段", line_no + 1));
            continue;
        }

        match add_or_update_email(pool, email, password, client_id, refresh_token, None).await {
            Ok(_) => {
                log::info!("成功导入或覆盖邮箱: {}", email);
                success_count += 1;
            }
            Err(e) => {
                log::error!("导入邮箱失败: {} - 错误: {}", email, e);
                failed_count += 1;
                failed_lines.push(format!("第 {} 行: {}", line_no + 1, e));
            }
        }
    }

    Ok(ImportResult {
        success_count,
        failed_count,
        failed_lines,
    })
}

/// 获取邮箱列表
pub async fn get_emails(pool: &Pool<Sqlite>) -> Result<Vec<EmailAccount>> {
    let emails = sqlx::query_as::<_, EmailAccount>(
        "SELECT id, email, password, mail_type, client_id, refresh_token, last_check_time, api_mode, proxy_type, proxy_url, default_folder FROM emails ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(emails)
}

/// 删除邮箱
pub async fn delete_email(pool: &Pool<Sqlite>, email_id: i64) -> Result<bool> {
    let result = sqlx::query("DELETE FROM emails WHERE id = ?")
        .bind(email_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// 获取邮件记录
pub async fn get_mail_records(pool: &Pool<Sqlite>, email_id: i64) -> Result<Vec<MailRecord>> {
    let records = sqlx::query_as::<_, MailRecord>(
        "SELECT id, email_id, subject, sender, received_time, content, folder, has_attachments FROM mail_records WHERE email_id = ? ORDER BY received_time DESC",
    )
    .bind(email_id)
    .fetch_all(pool)
    .await?;

    Ok(records)
}

/// 获取附件列表
pub async fn get_attachments(pool: &Pool<Sqlite>, mail_id: i64) -> Result<Vec<AttachmentInfo>> {
    let attachments = sqlx::query_as::<_, AttachmentInfo>(
        "SELECT id, mail_id, filename, content_type, size FROM attachments WHERE mail_id = ? ORDER BY id DESC",
    )
    .bind(mail_id)
    .fetch_all(pool)
    .await?;

    Ok(attachments)
}

/// 获取附件内容
pub async fn get_attachment_content(
    pool: &Pool<Sqlite>,
    attachment_id: i64,
) -> Result<AttachmentContent> {
    let row = sqlx::query_as::<_, (i64, Option<String>, Option<String>, Vec<u8>)>(
        "SELECT id, filename, content_type, content FROM attachments WHERE id = ?",
    )
    .bind(attachment_id)
    .fetch_one(pool)
    .await?;

    Ok(AttachmentContent {
        id: row.0,
        filename: row.1,
        content_type: row.2,
        content_base64: STANDARD.encode(row.3),
    })
}

/// Outlook 单邮箱收件（增强版：支持 Token 缓存、代理、Graph API）
pub async fn check_outlook_email(
    pool: &Pool<Sqlite>,
    email_id: i64,
    folder: &str,
) -> Result<CheckResult> {
    let account = get_outlook_account(pool, email_id).await?;
    let mail_type = account
        .mail_type
        .clone()
        .unwrap_or_else(|| "outlook".to_string());
    if mail_type != "outlook" {
        return Err(anyhow!("仅支持 outlook 收件"));
    }

    // 构建代理配置
    let proxy_config = ProxyConfig::from_db(account.proxy_type.clone(), account.proxy_url.clone());

    // 获取配置的 API 模式
    let configured_mode = ApiMode::from(account.api_mode.clone());

    // 使用传入的 folder 参数
    let folder = folder.to_string();

    // 尝试从缓存获取 Token，如果没有则刷新并检测权限
    let (access_token, api_mode) = match token_cache::get_valid_token(pool, email_id).await? {
        Some(token) => {
            // 缓存命中，使用配置的模式
            (token, configured_mode)
        }
        None => {
            // 刷新 Token 并检测 Graph API 权限
            let result = refresh_outlook_access_token_with_proxy(
                &account.client_id,
                &account.refresh_token,
                &proxy_config,
            )
            .await?;

            // 缓存 Token
            token_cache::cache_token(pool, email_id, &result.access_token, result.expires_in)
                .await?;
            update_email_token(pool, account.id, &result.access_token).await?;

            // 根据权限自动选择协议（借鉴 MS_OAuth2API_Next）
            let actual_mode = if result.supports_graph {
                log::info!("检测到 Mail.Read 权限，自动使用 Graph API 模式");
                ApiMode::Graph
            } else {
                log::info!("未检测到 Mail.Read 权限，自动使用 IMAP 模式");
                ApiMode::Imap
            };
            update_email_api_mode(pool, account.id, actual_mode).await?;

            (result.access_token, actual_mode)
        }
    };

    let mut fetched = 0usize;
    let mut saved = 0usize;

    // 根据 API 模式选择收件方式
    let used_mode = match api_mode {
        ApiMode::Graph => {
            // 使用 Graph API 收件，失败时回退到 IMAP
            match graph_api::fetch_via_graph(&access_token, &folder, 100, &proxy_config).await {
                Ok(records) => {
                    for record in records {
                        fetched += 1;

                        // 构建兼容的记录用于去重检查
                        let fetch_record = MailFetchRecord {
                            subject: record.subject.clone(),
                            sender: record.sender.clone(),
                            received_time: record.received_time.clone(),
                            content: record.content.clone(),
                            folder: record.folder.clone(),
                            attachments: record
                                .attachments
                                .iter()
                                .map(|a| AttachmentInput {
                                    filename: a.filename.clone(),
                                    content_type: a.content_type.clone(),
                                    content: a.content.clone(),
                                })
                                .collect(),
                        };

                        if mail_record_exists(pool, email_id, &fetch_record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &fetch_record).await?;
                        saved += 1;

                        if !fetch_record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &fetch_record.attachments).await?;
                        }
                    }

                    ApiMode::Graph
                }
                Err(graph_err) => {
                    // Graph API 失败，回退到 IMAP
                    log::warn!("Graph API 失败，回退到 IMAP: {}", graph_err);
                    let last_check_time = account.last_check_time.clone();
                    let email_address = account.email.clone();
                    let folder_clone = folder.clone();
                    let access_token_clone = access_token.clone();
                    let fetch_result = tokio::task::spawn_blocking(move || {
                        fetch_outlook_emails(
                            &email_address,
                            &access_token_clone,
                            &folder_clone,
                            last_check_time,
                        )
                    })
                    .await?;

                    for record in fetch_result? {
                        fetched += 1;
                        if mail_record_exists(pool, email_id, &record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &record).await?;
                        saved += 1;

                        if !record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &record.attachments).await?;
                        }
                    }

                    // 更新为 IMAP 模式
                    update_email_api_mode(pool, email_id, ApiMode::Imap).await?;
                    ApiMode::Imap
                }
            }
        }
        ApiMode::Imap => {
            // 使用 IMAP 收件
            let last_check_time = account.last_check_time.clone();
            let email_address = account.email.clone();
            let folder_clone = folder.clone();
            let access_token_clone = access_token.clone();
            let fetch_result = tokio::task::spawn_blocking(move || {
                fetch_outlook_emails(
                    &email_address,
                    &access_token_clone,
                    &folder_clone,
                    last_check_time,
                )
            })
            .await?;

            match fetch_result {
                Ok(records) => {
                    for record in records {
                        fetched += 1;
                        if mail_record_exists(pool, email_id, &record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &record).await?;
                        saved += 1;

                        if !record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &record.attachments).await?;
                        }
                    }

                    ApiMode::Imap
                }
                Err(err) => {
                    let err_msg = err.to_string();
                    let is_auth_failed = err_msg.to_lowercase().contains("authenticate");
                    if !is_auth_failed {
                        return Err(err);
                    }

                    // IMAP 认证失败时，回退到 Graph API 收件
                    log::warn!("IMAP 认证失败，回退到 Graph API: {}", err_msg);
                    let records =
                        graph_api::fetch_via_graph(&access_token, &folder, 100, &proxy_config)
                            .await?;

                    for record in records {
                        fetched += 1;

                        let fetch_record = MailFetchRecord {
                            subject: record.subject.clone(),
                            sender: record.sender.clone(),
                            received_time: record.received_time.clone(),
                            content: record.content.clone(),
                            folder: record.folder.clone(),
                            attachments: record
                                .attachments
                                .iter()
                                .map(|a| AttachmentInput {
                                    filename: a.filename.clone(),
                                    content_type: a.content_type.clone(),
                                    content: a.content.clone(),
                                })
                                .collect(),
                        };

                        if mail_record_exists(pool, email_id, &fetch_record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &fetch_record).await?;
                        saved += 1;

                        if !fetch_record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &fetch_record.attachments).await?;
                        }
                    }

                    update_email_api_mode(pool, email_id, ApiMode::Graph).await?;
                    ApiMode::Graph
                }
            }
        }
        ApiMode::Auto => {
            // 缓存命中时 Auto 模式，优先尝试 Graph API
            log::info!("缓存命中但模式为 Auto，优先尝试 Graph API");

            match graph_api::fetch_via_graph(&access_token, &folder, 100, &proxy_config).await {
                Ok(records) => {
                    for record in records {
                        fetched += 1;

                        let fetch_record = MailFetchRecord {
                            subject: record.subject.clone(),
                            sender: record.sender.clone(),
                            received_time: record.received_time.clone(),
                            content: record.content.clone(),
                            folder: record.folder.clone(),
                            attachments: record
                                .attachments
                                .iter()
                                .map(|a| AttachmentInput {
                                    filename: a.filename.clone(),
                                    content_type: a.content_type.clone(),
                                    content: a.content.clone(),
                                })
                                .collect(),
                        };

                        if mail_record_exists(pool, email_id, &fetch_record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &fetch_record).await?;
                        saved += 1;

                        if !fetch_record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &fetch_record.attachments).await?;
                        }
                    }

                    // Graph API 成功，更新模式
                    update_email_api_mode(pool, email_id, ApiMode::Graph).await?;
                    ApiMode::Graph
                }
                Err(graph_err) => {
                    // Graph API 失败，回退到 IMAP
                    log::warn!("Graph API 失败，回退到 IMAP: {}", graph_err);
                    let last_check_time = account.last_check_time.clone();
                    let email_address = account.email.clone();
                    let folder_clone = folder.clone();
                    let access_token_clone = access_token.clone();
                    let fetch_result = tokio::task::spawn_blocking(move || {
                        fetch_outlook_emails(
                            &email_address,
                            &access_token_clone,
                            &folder_clone,
                            last_check_time,
                        )
                    })
                    .await?;

                    for record in fetch_result? {
                        fetched += 1;
                        if mail_record_exists(pool, email_id, &record).await? {
                            continue;
                        }

                        let mail_id = insert_mail_record(pool, email_id, &record).await?;
                        saved += 1;

                        if !record.attachments.is_empty() {
                            insert_attachments(pool, mail_id, &record.attachments).await?;
                        }
                    }

                    // IMAP 成功，更新模式
                    update_email_api_mode(pool, email_id, ApiMode::Imap).await?;
                    ApiMode::Imap
                }
            }
        }
    };

    update_last_check_time(pool, email_id).await?;

    Ok(CheckResult {
        email_id,
        success: true,
        fetched,
        saved,
        message: format!(
            "成功获取 {fetched} 封邮件，新增 {saved} 封 (模式: {:?})",
            used_mode
        ),
    })
}

/// Outlook 批量收件
pub async fn batch_check_outlook_emails(
    pool: &Pool<Sqlite>,
    email_ids: Vec<i64>,
    folder: &str,
) -> Result<BatchCheckResult> {
    let mut results = Vec::new();
    let mut success_count = 0usize;
    let mut failed_count = 0usize;

    for email_id in email_ids {
        match check_outlook_email(pool, email_id, folder).await {
            Ok(result) => {
                success_count += 1;
                results.push(result);
            }
            Err(e) => {
                failed_count += 1;
                results.push(CheckResult {
                    email_id,
                    success: false,
                    fetched: 0,
                    saved: 0,
                    message: format!("收件失败: {e}"),
                });
            }
        }
    }

    Ok(BatchCheckResult {
        success_count,
        failed_count,
        results,
    })
}

/// 获取 Outlook 邮箱信息
async fn get_outlook_account(pool: &Pool<Sqlite>, email_id: i64) -> Result<OutlookAccount> {
    let account = sqlx::query_as::<_, OutlookAccount>(
        "SELECT id, email, mail_type, client_id, refresh_token, last_check_time, api_mode, proxy_type, proxy_url, default_folder FROM emails WHERE id = ?",
    )
    .bind(email_id)
    .fetch_one(pool)
    .await?;

    Ok(account)
}

/// 刷新 Outlook 访问令牌（支持代理，自动检测 Graph API 权限）
///
/// 返回 TokenRefreshResult，其中 supports_graph 表示是否支持 Graph API（通过检测 scope 中是否包含 Mail.Read）
async fn refresh_outlook_access_token_with_proxy(
    client_id: &str,
    refresh_token: &str,
    proxy_config: &ProxyConfig,
) -> Result<TokenRefreshResult> {
    let client = create_http_client(proxy_config, 30)?;

    // 请求 Graph API scope，用于检测权限
    let response: TokenResponse = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", "https://graph.microsoft.com/.default"),
        ])
        .send()
        .await?
        .json()
        .await?;

    if let Some(token) = response.access_token {
        let expires_in = response.expires_in.unwrap_or(3600);

        // 检测 scope 是否包含 Mail.Read 权限
        // 如果包含，说明支持 Graph API
        let supports_graph = response
            .scope
            .map(|s| s.contains("Mail.Read"))
            .unwrap_or(false);

        return Ok(TokenRefreshResult {
            access_token: token,
            expires_in,
            supports_graph,
        });
    }

    let error = response.error.unwrap_or_else(|| "未知错误".to_string());
    let description = response
        .error_description
        .unwrap_or_else(|| "未知错误描述".to_string());
    Err(anyhow!("刷新令牌失败: {} - {}", error, description))
}

/// 更新邮箱访问令牌
async fn update_email_token(pool: &Pool<Sqlite>, email_id: i64, access_token: &str) -> Result<()> {
    sqlx::query("UPDATE emails SET access_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(access_token)
        .bind(email_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 更新邮箱使用的 API 模式
async fn update_email_api_mode(pool: &Pool<Sqlite>, email_id: i64, mode: ApiMode) -> Result<()> {
    let mode_value = match mode {
        ApiMode::Graph => "graph",
        ApiMode::Imap => "imap",
        ApiMode::Auto => "auto",
    };
    sqlx::query("UPDATE emails SET api_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(mode_value)
        .bind(email_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 更新邮箱最后检查时间
async fn update_last_check_time(pool: &Pool<Sqlite>, email_id: i64) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE emails SET last_check_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(now)
    .bind(email_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Outlook 收件（同步，支持多文件夹）
fn fetch_outlook_emails(
    email_address: &str,
    access_token: &str,
    folder: &str,
    last_check_time: Option<String>,
) -> Result<Vec<MailFetchRecord>> {
    // 使用更稳定的企业级 IMAP 服务器
    let tls = TlsConnector::builder().build()?;
    let addr = "outlook.office365.com:993"
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| anyhow!("无法解析 IMAP 服务器地址"))?;
    let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(30))?;
    let stream = tls.connect("outlook.office365.com", tcp)?;
    let client = imap::Client::new(stream);

    let authenticator = OutlookAuthenticator {
        user: email_address.to_string(),
        access_token: access_token.to_string(),
    };
    let mut session = client
        .authenticate("XOAUTH2", &authenticator)
        .map_err(|(err, _)| anyhow!(err))?;

    // 支持多文件夹
    session.select(folder)?;

    let criteria = match format_imap_since(&last_check_time) {
        Some(date) => format!("SINCE {}", date),
        None => "ALL".to_string(),
    };

    let mut ids: Vec<_> = session.search(criteria)?.into_iter().collect();
    ids.sort_unstable();
    if ids.len() > 100 {
        ids = ids[ids.len() - 100..].to_vec();
    }

    let mut records = Vec::new();
    for id in ids {
        let fetches = session.fetch(id.to_string(), "RFC822")?;
        for fetch in fetches.iter() {
            let raw = match fetch.body() {
                Some(body) => body,
                None => continue,
            };
            let parsed = match mailparse::parse_mail(raw) {
                Ok(mail) => mail,
                Err(_) => continue,
            };

            match build_mail_record(parsed, folder) {
                Ok(record) => records.push(record),
                Err(_) => continue,
            }
        }
    }

    session.logout()?;

    Ok(records)
}

/// 构建邮件记录
fn build_mail_record(parsed: ParsedMail, folder: &str) -> Result<MailFetchRecord> {
    let subject = decode_header_value(parsed.headers.get_first_value("Subject"));
    let sender = decode_header_value(parsed.headers.get_first_value("From"));
    let received_time = parse_received_time(parsed.headers.get_first_value("Date"));

    let (plain, html, attachments) = extract_content_and_attachments(&parsed)?;
    let content = plain.or(html).unwrap_or_default();

    Ok(MailFetchRecord {
        subject,
        sender,
        received_time,
        content,
        folder: folder.to_string(),
        attachments,
    })
}

/// 解析邮件头部
fn decode_header_value(value: Option<String>) -> Option<String> {
    value
}

/// 解析邮件日期
fn parse_received_time(value: Option<String>) -> Option<String> {
    let date_str = value?;
    let timestamp = mailparse::dateparse(&date_str).ok()?;
    let dt = DateTime::from_timestamp(timestamp, 0)?;
    Some(dt.to_rfc3339())
}

/// 计算 IMAP SINCE 日期
fn format_imap_since(last_check_time: &Option<String>) -> Option<String> {
    let raw = last_check_time.as_ref()?;
    let dt = DateTime::parse_from_rfc3339(raw).ok()?;
    Some(dt.format("%d-%b-%Y").to_string())
}

/// 提取正文与附件
fn extract_content_and_attachments(
    parsed: &ParsedMail,
) -> Result<(Option<String>, Option<String>, Vec<AttachmentInput>)> {
    let mut plain = None;
    let mut html = None;
    let mut attachments = Vec::new();

    walk_parts(parsed, &mut plain, &mut html, &mut attachments)?;

    Ok((plain, html, attachments))
}

/// 递归遍历 MIME 结构
fn walk_parts(
    part: &ParsedMail,
    plain: &mut Option<String>,
    html: &mut Option<String>,
    attachments: &mut Vec<AttachmentInput>,
) -> Result<()> {
    if part.subparts.is_empty() {
        let content_type = part.ctype.mimetype.to_lowercase();
        let filename = extract_filename(part);
        let disposition = part.get_content_disposition();
        let is_attachment =
            disposition.disposition == DispositionType::Attachment || filename.is_some();

        if is_attachment {
            let content = part.get_body_raw().unwrap_or_default();
            let name = filename.unwrap_or_else(|| "attachment".to_string());
            attachments.push(AttachmentInput {
                filename: name,
                content_type: part.ctype.mimetype.clone(),
                content,
            });
            return Ok(());
        }

        if content_type == "text/plain" && plain.is_none() {
            if let Ok(body) = part.get_body() {
                *plain = Some(body);
            }
        } else if content_type == "text/html" && html.is_none() {
            if let Ok(body) = part.get_body() {
                *html = Some(body);
            }
        }

        return Ok(());
    }

    for sub in &part.subparts {
        walk_parts(sub, plain, html, attachments)?;
    }

    Ok(())
}

/// 提取附件文件名
fn extract_filename(part: &ParsedMail) -> Option<String> {
    let disposition = part.get_content_disposition();
    if let Some(name) = disposition.params.get("filename") {
        return Some(name.clone());
    }

    if let Some(name) = part.ctype.params.get("name") {
        return Some(name.clone());
    }

    None
}

/// 检查邮件记录是否已存在
async fn mail_record_exists(
    pool: &Pool<Sqlite>,
    email_id: i64,
    record: &MailFetchRecord,
) -> Result<bool> {
    if let Some(received_time) = &record.received_time {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM mail_records WHERE email_id = ? AND subject IS ? AND sender IS ? AND received_time = ? LIMIT 1",
        )
        .bind(email_id)
        .bind(&record.subject)
        .bind(&record.sender)
        .bind(received_time)
        .fetch_optional(pool)
        .await?
        .is_some();
        return Ok(exists);
    }

    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM mail_records WHERE email_id = ? AND subject IS ? AND sender IS ? AND received_time IS NULL LIMIT 1",
    )
    .bind(email_id)
    .bind(&record.subject)
    .bind(&record.sender)
    .fetch_optional(pool)
    .await?
    .is_some();

    Ok(exists)
}

/// 新增邮件记录
async fn insert_mail_record(
    pool: &Pool<Sqlite>,
    email_id: i64,
    record: &MailFetchRecord,
) -> Result<i64> {
    let has_attachments = if record.attachments.is_empty() { 0 } else { 1 };
    let mail_id: i64 = sqlx::query_scalar(
        "INSERT INTO mail_records (email_id, subject, sender, received_time, content, folder, has_attachments) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(email_id)
    .bind(&record.subject)
    .bind(&record.sender)
    .bind(&record.received_time)
    .bind(&record.content)
    .bind(&record.folder)
    .bind(has_attachments)
    .fetch_one(pool)
    .await?;

    Ok(mail_id)
}

/// 新增附件记录
async fn insert_attachments(
    pool: &Pool<Sqlite>,
    mail_id: i64,
    attachments: &[AttachmentInput],
) -> Result<()> {
    for attachment in attachments {
        let size = attachment.content.len() as i64;
        sqlx::query(
            "INSERT INTO attachments (mail_id, filename, content_type, size, content) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(mail_id)
        .bind(&attachment.filename)
        .bind(&attachment.content_type)
        .bind(size)
        .bind(&attachment.content)
        .execute(pool)
        .await?;
    }

    Ok(())
}
