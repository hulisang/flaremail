export interface User {
    id: number;
    username: string;
}

export interface EmailAccount {
    id: number;
    email: string;
    // 邮箱密码（仅前端显示/复制使用）
    password: string;
    mail_type: string;
    client_id: string;
    refresh_token: string;
    last_check_time?: string;
}

export interface MailRecord {
    id: number;
    email_id: number;
    subject?: string;
    sender?: string;
    received_time?: string;
    content?: string;
    folder?: string;
    has_attachments: number;
}

export interface AttachmentInfo {
    id: number;
    mail_id: number;
    filename?: string;
    content_type?: string;
    size?: number;
}

export interface AttachmentContent {
    id: number;
    filename?: string;
    content_type?: string;
    content_base64: string;
}

export interface CheckResult {
    email_id: number;
    success: boolean;
    fetched: number;
    saved: number;
    message: string;
}

export interface BatchCheckResult {
    success_count: number;
    failed_count: number;
    results: CheckResult[];
}

export interface ImportResult {
    success_count: number;
    failed_count: number;
    failed_lines: string[];
}
