
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
    Upload, FileText, Trash2, Inbox, Trash,
    Download, Clipboard, RefreshCw, X,
    Eye, EyeOff, Paperclip
} from 'lucide-react';
import { useAppStore } from '../store/app';
import MailDetailModal from './MailDetailModal';
import type { EmailAccount, MailRecord } from '../types';

type MailFolder = 'INBOX' | 'JUNK';

// 清理 HTML 标签，提取纯文本
const stripHtml = (html: string | null | undefined): string => {
    if (!html) return '';
    // 移除 HTML 标签
    let text = html.replace(/<[^>]*>/g, ' ');
    // 解码 HTML 实体
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
    // 压缩多余空白
    text = text.replace(/\s+/g, ' ').trim();
    return text;
};

// 获取发件人名称首字母
const getInitials = (sender: string | null | undefined): string => {
    if (!sender) return '?';
    // 尝试提取 <email> 之前的名称部分
    const nameMatch = sender.match(/^([^<]+)/);
    const name = nameMatch ? nameMatch[1].trim() : sender;
    // 获取首字母
    const words = name.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
};

// 格式化日期为友好格式
const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return '昨天';
    } else if (diffDays < 7) {
        return date.toLocaleDateString('zh-CN', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
};

export default function EmailManagement() {
    const { t } = useAppStore();

    // 状态
    const [emails, setEmails] = useState<EmailAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 密码显示状态（默认隐藏）
    const [showPasswords, setShowPasswords] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    // 通过更新 key 重新触发 toast 动画，避免同文案时不显示
    const [toastId, setToastId] = useState(0);
    const toastTimerRef = useRef<number | null>(null);

    // 导入/导出状态
    const [separator, setSeparator] = useState('----');
    const [searchQuery, setSearchQuery] = useState('');
    const [importResult, setImportResult] = useState<string | null>(null);

    // 粘贴导入模态框状态
    const [showPasteModal, setShowPasteModal] = useState(false);
    const [pasteContent, setPasteContent] = useState('');
    const [mailViewerOpen, setMailViewerOpen] = useState(false);
    const [mailViewerEmail, setMailViewerEmail] = useState<EmailAccount | null>(null);
    const [mailViewerFolder, setMailViewerFolder] = useState<MailFolder>('INBOX');
    const [mailViewerRecords, setMailViewerRecords] = useState<MailRecord[]>([]);
    const [mailViewerLoading, setMailViewerLoading] = useState(false);
    const [selectedMail, setSelectedMail] = useState<MailRecord | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // 处理拖拽导入的回调（需要 useCallback 保持引用稳定）
    const handleDropImport = useCallback(async (paths: string[]) => {
        if (!paths || paths.length === 0) return;

        const txtPath = paths.find(p => p.toLowerCase().endsWith('.txt'));
        if (!txtPath) {
            alert('请拖拽 .txt 文件');
            return;
        }

        try {
            const content = await readTextFile(txtPath);
            handleBatchImport(content);
        } catch (error) {
            console.error('读取拖拽文件失败:', error);
            alert('读取文件失败');
        }
    }, []);

    useEffect(() => {
        loadEmails();
    }, []);

    // 监听 Tauri drag-drop 事件获取文件路径
    useEffect(() => {
        let unlisten: UnlistenFn | null = null;

        const setup = async () => {
            unlisten = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
                handleDropImport(event.payload.paths);
            });
        };

        setup();
        return () => { unlisten?.(); };
    }, [handleDropImport]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) {
                window.clearTimeout(toastTimerRef.current);
                toastTimerRef.current = null;
            }
        };
    }, []);

    const loadEmails = async () => {
        setLoading(true);
        try {
            const list = await invoke<EmailAccount[]>('get_emails');
            setEmails(list);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const resolveDialogPath = (picked: unknown) => {
        if (typeof picked === 'string') {
            return picked;
        }

        if (picked && typeof picked === 'object' && 'path' in picked) {
            const pathValue = (picked as { path?: string }).path;
            if (typeof pathValue === 'string' && pathValue.length > 0) {
                return pathValue;
            }
        }

        return null;
    };

    const handleSelectFile = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Text',
                    extensions: ['txt']
                }]
            });

            if (!selected) {
                return;
            }

            const picked = Array.isArray(selected) ? selected[0] : selected;
            const filePath = resolveDialogPath(picked);

            if (!filePath) {
                alert('未获取到文件路径');
                return;
            }

            const content = await readTextFile(filePath);
            handleBatchImport(content);
        } catch (err) {
            console.error(err);
            alert('读取文件失败');
        }
    };

    const handleBatchImport = async (content: string) => {
        setLoading(true);
        setImportResult(null);
        try {
            const response: any = await invoke('import_emails', { input: content });
            if (response.failed_count === 0) {
                setImportResult(t.import.successMsg.replace('{count}', String(response.success_count)));
            } else {
                // 显示详细错误信息
                const failedDetails = response.failed_lines && response.failed_lines.length > 0
                    ? `\n失败详情:\n${response.failed_lines.join('\n')}`
                    : '';
                setImportResult(`成功: ${response.success_count}, 失败: ${response.failed_count}${failedDetails}`);
            }
            loadEmails();
        } catch (error) {
            setImportResult(`导入失败: ${error}`);
        } finally {
            setLoading(false);
        }
    };

    // 打开粘贴导入模态框
    const handlePasteImport = () => {
        setPasteContent('');
        setShowPasteModal(true);
    };

    // 提交粘贴导入
    const handlePasteSubmit = () => {
        if (pasteContent.trim()) {
            handleBatchImport(pasteContent);
            setShowPasteModal(false);
            setPasteContent('');
        }
    };

    // 关闭模态框
    const handleClosePasteModal = () => {
        setShowPasteModal(false);
        setPasteContent('');
    };

    const normalizeFolder = (folder?: string): MailFolder => {
        if (!folder) {
            return 'INBOX';
        }

        const normalized = folder.trim().toLowerCase();
        // 匹配垃圾邮件文件夹（Junk/Spam）
        if (normalized.includes('junk') || normalized.includes('spam') || normalized.includes('垃圾')) {
            return 'JUNK';
        }

        return 'INBOX';
    };

    const filterMailRecordsByFolder = (records: MailRecord[], folder: MailFolder) =>
        records.filter((record) => normalizeFolder(record.folder) === folder);

    const loadMailViewerRecords = async (emailId: number, folder: MailFolder) => {
        setMailViewerLoading(true);
        try {
            const records = await invoke<MailRecord[]>('get_mail_records', { emailId });
            setMailViewerRecords(filterMailRecordsByFolder(records, folder));
        } catch (error) {
            console.error(error);
            setMailViewerRecords([]);
        } finally {
            setMailViewerLoading(false);
        }
    };

    const handleOpenMailbox = async (account: EmailAccount, folder: MailFolder) => {
        setMailViewerEmail(account);
        setMailViewerFolder(folder);
        setMailViewerRecords([]);
        setMailViewerOpen(true);
        setMailViewerLoading(true);

        try {
            // 先触发收件操作，传递文件夹参数
            await invoke('check_outlook_email', { emailId: account.id, folder });
        } catch (error) {
            console.error('收件失败:', error);
            // 收件失败不阻止查看已有邮件
        }

        // 加载邮件记录
        loadMailViewerRecords(account.id, folder);
    };

    const handleCloseMailbox = () => {
        setMailViewerOpen(false);
        setMailViewerEmail(null);
        setMailViewerRecords([]);
        setSelectedMail(null);
        setIsDetailOpen(false);
    };

    const handleViewMailDetail = (mail: MailRecord) => {
        setSelectedMail(mail);
        setIsDetailOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('确定删除此邮箱吗？')) return;
        try {
            await invoke('delete_email', { emailId: id });
            loadEmails();
        } catch (error) {
            alert(`删除失败: ${error}`);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.length === 0) return;
        if (!confirm(`确定删除选中的 ${selectedIds.length} 个邮箱吗？`)) return;

        // 目前后端好像没有批量删除接口，循环调用（后续可优化）
        for (const id of selectedIds) {
            await invoke('delete_email', { emailId: id }).catch(console.error);
        }
        setSelectedIds([]);
        loadEmails();
    };

    const handleSelectAll = (checked: boolean, ids: number[]) => {
        if (ids.length === 0) {
            return;
        }

        if (checked) {
            setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
            return;
        }

        setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    };

    const toggleSelect = (id: number) => {
        if (selectedIds.includes(id)) {
            setSelectedIds(selectedIds.filter(i => i !== id));
        } else {
            setSelectedIds([...selectedIds, id]);
        }
    };

    const showToast = (message: string) => {
        setToastMessage(message);
        setToastId((prev) => prev + 1);
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(() => {
            setToastMessage(null);
            toastTimerRef.current = null;
        }, 2000);
    };

    // 复制字段值到剪贴板（成功 toast，失败 alert）
    const handleCopyValue = async (value: string, displayValue: string = value) => {
        if (!navigator?.clipboard) {
            alert('当前环境不支持剪贴板复制');
            return;
        }

        try {
            await navigator.clipboard.writeText(value);
            showToast(`${displayValue}已复制`);
        } catch (error) {
            console.error(error);
            alert('复制失败');
        }
    };

    const filteredEmails = emails.filter(e => e.email.toLowerCase().includes(searchQuery.toLowerCase()));
    const totalPages = Math.max(1, Math.ceil(filteredEmails.length / pageSize));
    const pageStart = (currentPage - 1) * pageSize;
    const paginatedEmails = filteredEmails.slice(pageStart, pageStart + pageSize);
    const pageEmailIds = paginatedEmails.map((email) => email.id);
    const allPageSelected = pageEmailIds.length > 0
        && pageEmailIds.every((id) => selectedIds.includes(id));

    const buildPageItems = (total: number, current: number): Array<number | 'ellipsis'> => {
        if (total <= 7) {
            return Array.from({ length: total }, (_, index) => index + 1);
        }

        if (current <= 3) {
            return [1, 2, 3, 4, 'ellipsis', total];
        }

        if (current >= total - 2) {
            return [1, 'ellipsis', total - 3, total - 2, total - 1, total];
        }

        return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
    };

    const pageItems = buildPageItems(totalPages, currentPage);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, pageSize]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    return (
        <div className="management-content animate-in">
            {/* 顶部标题 */}
            <div className="page-header-inline">
                <h1 className="page-title">邮箱管理</h1>
                <span className="page-separator">—</span>
                <span className="page-subtitle-inline">导入、管理和查看您的邮箱账号</span>
            </div>

            {toastMessage && createPortal(
                <div className="toast-container" role="status" aria-live="polite">
                    <div key={toastId} className="toast">{toastMessage}</div>
                </div>,
                document.body
            )}

            {/* 导入/导出管理卡片 */}
            <section className="management-section">
                <div className="section-title">
                    <FileText size={20} className="section-icon" />
                    <span>邮箱导入/导出管理</span>
                </div>

                <div className="management-content">
                    <div className="toolbar-row">
                        <div className="toolbar-left">
                            <div className="form-field w-small">
                                <label>分隔符</label>
                                <input
                                    type="text"
                                    value={separator}
                                    onChange={(e) => setSeparator(e.target.value)}
                                    className="separator-input"
                                />
                            </div>
                            <div className="form-field flex-grow">
                                <label>搜索邮箱</label>
                                <input
                                    type="text"
                                    placeholder="输入邮箱地址搜索"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="search-email-input"
                                />
                            </div>
                        </div>

                        <div className="actions-toolbar">
                            <button className="btn btn-secondary" onClick={handleSelectFile} type="button">
                                <Upload size={16} className="btn-icon-space" />
                                选择文件
                            </button>
                            <button className="btn btn-purple" type="button">
                                <Upload size={16} className="btn-icon-space" />
                                导入邮箱
                            </button>
                            <button className="btn btn-green" type="button">
                                <Download size={16} className="btn-icon-space" />
                                导出邮箱
                            </button>
                            <button
                                className="btn btn-orange"
                                onClick={handleBatchDelete}
                                disabled={selectedIds.length === 0}
                                type="button"
                            >
                                <Trash2 size={16} className="btn-icon-space" />
                                批量删除
                            </button>
                            <button className="btn btn-pink" type="button">
                                <Trash2 size={16} className="btn-icon-space" />
                                删除全部
                            </button>
                            <button className="btn btn-violet" onClick={handlePasteImport} type="button">
                                <Clipboard size={16} className="btn-icon-space" />
                                粘贴导入
                            </button>
                        </div>
                    </div>

                    <div
                        className={`upload-area transition-all duration-200 ${isDragging ? 'border-primary bg-primary/10 scale-[1.02]' : ''}`}
                        onClick={handleSelectFile}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            // 实际文件处理由 tauri://drag-drop 事件监听器完成
                        }}
                    >
                        <Upload size={16} className={`transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span>点击选择文件 或 将TXT文件拖拽至此</span>
                        <span className="text-muted-foreground">| 格式: 邮箱----密码----client_id----refresh_token</span>
                    </div>

                    {importResult && (
                        <div className={`result-box ${importResult.includes('失败') ? 'error' : 'success'}`}>
                            {importResult}
                        </div>
                    )}
                </div>
            </section>

            {/* 邮箱账号列表卡片 */}
            <section className="management-section">
                <div className="section-title">
                    <RefreshCw size={20} className="section-icon" />
                    <span>邮箱账号列表</span>
                </div>

                <div className="data-table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: '40px' }}>
                                    <input
                                        type="checkbox"
                                        className="row-checkbox"
                                        checked={allPageSelected}
                                        onChange={(e) => handleSelectAll(e.target.checked, pageEmailIds)}
                                    />
                                </th>
                                <th style={{ width: '60px' }}>#</th>
                                <th>邮箱地址</th>
                                <th>
                                    <div className="flex items-center gap-2">
                                        <span>密码</span>
                                        <button
                                            className="btn-icon-action password-toggle"
                                            onClick={() => setShowPasswords((prev) => !prev)}
                                            title={showPasswords ? '隐藏密码' : '显示密码'}
                                            aria-label={showPasswords ? '隐藏密码' : '显示密码'}
                                            type="button"
                                        >
                                            {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </th>
                                <th>客户端ID</th>
                                <th>刷新令牌</th>
                                <th style={{ width: '160px' }}>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="status-cell">加载中...</td>
                                </tr>
                            ) : filteredEmails.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="status-cell">
                                        <div className="empty-state">
                                            <div className="empty-icon-box">
                                                <FileText size={32} />
                                            </div>
                                            <span>暂无邮箱数据</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedEmails.map((email, index) => (
                                    <tr key={email.id}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                className="row-checkbox"
                                                checked={selectedIds.includes(email.id)}
                                                onChange={() => toggleSelect(email.id)}
                                            />
                                        </td>
                                        <td>{pageStart + index + 1}</td>
                                        <td
                                            className="copyable-cell"
                                            title="点击复制"
                                            onClick={() => handleCopyValue(email.email)}
                                        >
                                            {email.email}
                                        </td>
                                        <td
                                            className={`mono copyable-cell ${showPasswords ? '' : 'disabled'}`}
                                            title={showPasswords ? '点击复制' : '显示后可复制'}
                                            onClick={showPasswords ? () => handleCopyValue(email.password) : undefined}
                                        >
                                            {showPasswords ? email.password : '******'}
                                        </td>
                                        <td
                                            className="mono text-muted truncate copyable-cell"
                                            title={`${email.client_id}（点击复制）`}
                                            onClick={() => handleCopyValue(email.client_id)}
                                        >
                                            {email.client_id}
                                        </td>
                                        <td
                                            className="mono text-muted truncate copyable-cell"
                                            title={`${email.refresh_token}（点击复制）`}
                                            onClick={() => handleCopyValue(email.refresh_token, `${email.refresh_token.substring(0, 20)}...`)}
                                        >
                                            {email.refresh_token.substring(0, 20)}...
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    className="btn-icon-action"
                                                    onClick={() => handleOpenMailbox(email, 'INBOX')}
                                                    title={t.menu.inbox}
                                                    type="button"
                                                >
                                                    <Inbox size={16} />
                                                </button>
                                                <button
                                                    className="btn-icon-action"
                                                    onClick={() => handleOpenMailbox(email, 'JUNK')}
                                                    title={t.menu.trash}
                                                    type="button"
                                                >
                                                    <Trash size={16} />
                                                </button>
                                                <button
                                                    className="btn-icon-action delete"
                                                    onClick={() => handleDelete(email.id)}
                                                    title="删除"
                                                    type="button"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {filteredEmails.length > 0 && (
                    <div className="pagination-bar">
                        <div className="pagination-pages">
                            <button
                                className="pagination-btn wide"
                                type="button"
                                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                            >
                                上一页
                            </button>
                            {pageItems.map((item, index) => {
                                if (item === 'ellipsis') {
                                    return (
                                        <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
                                            ...
                                        </span>
                                    );
                                }

                                return (
                                    <button
                                        className={`pagination-btn ${item === currentPage ? 'active' : ''}`}
                                        type="button"
                                        key={item}
                                        onClick={() => setCurrentPage(item)}
                                    >
                                        {item}
                                    </button>
                                );
                            })}
                            <button
                                className="pagination-btn wide"
                                type="button"
                                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                            >
                                下一页
                            </button>
                        </div>
                        <div className="pagination-size">
                            <select
                                className="pagination-select"
                                value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}
                            >
                                {[10, 20, 50].map((size) => (
                                    <option key={size} value={size}>
                                        {size} 条/页
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}
            </section>

            {mailViewerOpen && mailViewerEmail && (
                <div className="modal-overlay-content-area" onClick={handleCloseMailbox}>
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{ minWidth: '760px', maxWidth: '980px' }}
                    >
                        <div className="modal-header">
                            <div>
                                <h3>{mailViewerEmail.email}</h3>
                                <p className="text-xs text-muted-foreground">
                                    {mailViewerFolder === 'INBOX' ? t.menu.inbox : t.menu.trash}
                                </p>
                            </div>
                            <button
                                className="modal-close-btn"
                                onClick={handleCloseMailbox}
                                type="button"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            {mailViewerLoading ? (
                                <div className="loading-state">
                                    <RefreshCw size={32} className="spinning text-muted-foreground" />
                                    <p className="text-muted">加载中...</p>
                                </div>
                            ) : mailViewerRecords.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-icon-box">
                                        <FileText size={32} />
                                    </div>
                                    <span>{t.empty.title}</span>
                                </div>
                            ) : (
                                <div className="mail-records-list">
                                    {mailViewerRecords.map((mail) => (
                                        <div
                                            key={mail.id}
                                            className="mail-record-item"
                                            onClick={() => handleViewMailDetail(mail)}
                                        >
                                            <div className="mail-avatar">
                                                {getInitials(mail.sender)}
                                            </div>
                                            <div className="mail-content-wrap">
                                                <div className="mail-record-header">
                                                    <span className="mail-sender">{mail.sender?.split('<')[0]?.trim() || 'Unknown'}</span>
                                                    <span className="mail-date">
                                                        {formatDate(mail.received_time)}
                                                    </span>
                                                </div>
                                                <div className="mail-subject">
                                                    {mail.has_attachments === 1 && <Paperclip size={14} className="mail-attachment-icon" />}
                                                    {mail.subject || '(无主题)'}
                                                </div>
                                                <div className="mail-preview">
                                                    {stripHtml(mail.content)?.substring(0, 120) || '-'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={handleCloseMailbox} type="button">
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {selectedMail && (
                <MailDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => {
                        setIsDetailOpen(false);
                        setSelectedMail(null);
                    }}
                    mail={selectedMail}
                />
            )}

            {/* 粘贴导入模态框 */}
            {showPasteModal && (
                <div className="modal-overlay" onClick={handleClosePasteModal}>
                    <div className="modal-content paste-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>粘贴导入邮箱</h3>
                            <button
                                className="modal-close-btn"
                                onClick={handleClosePasteModal}
                                type="button"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p className="modal-hint">请在下方文本框中粘贴邮箱数据，每行一个邮箱</p>
                            <p className="modal-hint-format">格式: 邮箱----密码----client_id----refresh_token</p>
                            <textarea
                                className="paste-textarea"
                                placeholder="粘贴邮箱数据，每行一个..."
                                value={pasteContent}
                                onChange={(e) => setPasteContent(e.target.value)}
                                rows={12}
                            />
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={handleClosePasteModal}
                                type="button"
                            >
                                取消
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handlePasteSubmit}
                                disabled={!pasteContent.trim()}
                                type="button"
                            >
                                导入
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
