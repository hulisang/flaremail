import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Users } from 'lucide-react';
import EmailManagement from '../components/EmailManagement';
import About from '../components/About';
import { ModeToggle } from '../components/mode-toggle';
import type { EmailAccount } from '../types';

export default function Dashboard() {
    const [view, setView] = useState<'dashboard' | 'management' | 'about'>('dashboard');
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);

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
        </div>
    );
}
