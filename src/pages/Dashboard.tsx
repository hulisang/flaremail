import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Users, Download, X } from 'lucide-react';
import EmailManagement from '../components/EmailManagement';
import About from '../components/About';
import { ModeToggle } from '../components/mode-toggle';
import { checkForUpdate, type UpdateInfo } from '../utils/updateChecker';
import type { EmailAccount } from '../types';

export default function Dashboard() {
    const [view, setView] = useState<'dashboard' | 'management' | 'about'>('dashboard');
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);

    // 更新提示 toast 状态
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [showUpdateToast, setShowUpdateToast] = useState(false);
    const hasCheckedUpdate = useRef(false);

    // 首次加载时自动检查更新
    useEffect(() => {
        if (hasCheckedUpdate.current) return;
        hasCheckedUpdate.current = true;

        checkForUpdate().then(info => {
            if (info) {
                setUpdateInfo(info);
                setShowUpdateToast(true);
            }
        });
    }, []);

    // 关闭更新提示
    const dismissUpdateToast = () => {
        setShowUpdateToast(false);
    };

    useEffect(() => {
        // 切换到仪表盘视图时加载邮箱列表
        if (view !== 'dashboard') return;

        const loadAccounts = async () => {
            try {
                const list = await invoke<EmailAccount[]>('get_emails');
                setAccounts(list);
            } catch (error) {
                console.error('获取邮箱列表失败', error);
            }
        };

        loadAccounts();
    }, [view]);

    const accountCount = accounts.length;

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {/* 顶部导航 */}
            <header className="top-header">
                <div className="header-logo">
                    FlareMail
                </div>

                <nav className="pill-nav-container">
                    <button
                        className={`pill-nav-item ${view === 'dashboard' ? 'active' : ''}`}
                        onClick={() => setView('dashboard')}
                        type="button"
                    >
                        仪表盘
                    </button>
                    <button
                        className={`pill-nav-item ${view === 'management' ? 'active' : ''}`}
                        onClick={() => setView('management')}
                        type="button"
                    >
                        账号管理
                    </button>
                    <button
                        className={`pill-nav-item ${view === 'about' ? 'active' : ''}`}
                        onClick={() => setView('about')}
                        type="button"
                    >
                        关于
                    </button>
                </nav>

                <div className="header-right-actions">
                    <ModeToggle />
                </div>
            </header>

            {/* 主内容 */}
            <main className="flex-1 pt-16 h-full overflow-auto">
                {view === 'dashboard' ? (
                    <div className="container mx-auto p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <h1 className="text-3xl font-bold tracking-tight mb-6">仪表盘</h1>

                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <div className="p-6 rounded-xl border bg-card text-card-foreground shadow-sm">
                                <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <div className="text-sm font-medium">邮箱账号总数</div>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="text-2xl font-bold">{accountCount}</div>
                                <p className="text-xs text-muted-foreground mt-1">已导入系统的所有邮箱账号</p>
                            </div>
                        </div>
                    </div>
                ) : view === 'management' ? (
                    <div className="h-full overflow-auto p-6">
                        <EmailManagement />
                    </div>
                ) : (
                    <div className="h-full overflow-auto p-6">
                        <About />
                    </div>
                )}
            </main>

            {/* 自动更新检查 Toast */}
            {showUpdateToast && updateInfo && createPortal(
                <div className="toast-container" role="status" aria-live="polite">
                    <div className="toast update-toast">
                        <div className="flex items-center gap-3">
                            <span>发现新版本 {updateInfo.version}</span>
                            <button
                                onClick={() => openUrl(updateInfo.downloadUrl)}
                                className="flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                            >
                                <Download size={14} />
                                <span>前往下载</span>
                            </button>
                            <button
                                onClick={dismissUpdateToast}
                                className="ml-2 p-1 hover:bg-secondary/50 rounded transition-colors"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
