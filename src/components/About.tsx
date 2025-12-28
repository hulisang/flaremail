import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Github, Info, RefreshCw, Heart, Download, X } from 'lucide-react';
import logoImage from '../assets/logo.png';

// GitHub API 响应类型
interface GitHubRelease {
    tag_name: string;
    html_url: string;
}

// 新版本信息接口
interface UpdateInfo {
    version: string;
    downloadUrl: string;
}

// 比较版本号（v1.2.3 格式）
function compareVersions(current: string, latest: string): number {
    const normalize = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const curr = normalize(current);
    const lat = normalize(latest);
    for (let i = 0; i < Math.max(curr.length, lat.length); i++) {
        const c = curr[i] || 0;
        const l = lat[i] || 0;
        if (l > c) return 1;   // latest 更新
        if (l < c) return -1;  // current 更新
    }
    return 0; // 相同版本
}

export default function About() {
    const [version, setVersion] = useState<string>('加载中...');
    const [checking, setChecking] = useState(false);
    // Toast 状态
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [toastId, setToastId] = useState(0);
    const toastTimerRef = useRef<number | null>(null);
    // 新版本信息（用于显示下载按钮）
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    useEffect(() => {
        getVersion().then(setVersion).catch(console.error);
    }, []);

    // 清理 toast 定时器
    useEffect(() => {
        return () => {
            if (toastTimerRef.current) {
                window.clearTimeout(toastTimerRef.current);
            }
        };
    }, []);

    // 显示 toast（duration 为 0 表示不自动消失）
    const showToast = (message: string, duration: number = 3000) => {
        setToastMessage(message);
        setToastId((prev) => prev + 1);
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
        }
        if (duration > 0) {
            toastTimerRef.current = window.setTimeout(() => {
                setToastMessage(null);
                setUpdateInfo(null);
                toastTimerRef.current = null;
            }, duration);
        }
    };

    // 关闭 toast
    const dismissToast = () => {
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
        }
        setToastMessage(null);
        setUpdateInfo(null);
    };

    // 使用 GitHub API 检查更新
    const handleCheckUpdate = async () => {
        setChecking(true);
        try {
            // 获取当前版本（确保已加载）
            const currentVersion = version === '加载中...' ? await getVersion() : version;

            // 调用 GitHub API 获取最新 release
            const response = await fetch('https://api.github.com/repos/hulisang/flaremail/releases/latest');

            if (!response.ok) {
                if (response.status === 404) {
                    showToast('暂无发布版本');
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
                return;
            }

            const release: GitHubRelease = await response.json();
            const latestVersion = release.tag_name;

            // 比较版本
            const cmp = compareVersions(currentVersion, latestVersion);

            if (cmp > 0) {
                // 有新版本
                setUpdateInfo({
                    version: latestVersion,
                    downloadUrl: release.html_url
                });
                showToast(`发现新版本 ${latestVersion}`, 0);
            } else {
                showToast('当前已是最新版本 ✓');
            }
        } catch (error) {
            console.error('检查更新失败', error);
            showToast('检查更新失败，请检查网络连接');
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center text-center space-y-6">
                {/* Logo 显示 */}
                <div className="w-24 h-24 flex items-center justify-center mb-4">
                    <img src={logoImage} alt="FlareMail Logo" className="w-full h-full object-contain" />
                </div>

                <div className="space-y-2">
                    <h1 className="text-4xl font-extrabold tracking-tight">FlareMail</h1>
                    <p className="text-muted-foreground font-medium">极简、高效的桌面邮件客户端</p>
                </div>

                <div className="flex items-center space-x-2 bg-secondary/50 px-4 py-1.5 rounded-full text-sm font-semibold border">
                    <Info size={14} />
                    <span>版本 {version}</span>
                </div>

                <div className="grid grid-cols-1 gap-4 w-full pt-4">
                    <button
                        onClick={handleCheckUpdate}
                        disabled={checking}
                        className="flex items-center justify-center space-x-2 w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
                    >
                        <RefreshCw size={18} className={checking ? "animate-spin" : ""} />
                        <span>{checking ? '正在检查更新...' : '检查更新'}</span>
                    </button>

                    <button
                        onClick={() => openUrl('https://github.com/hulisang/flaremail')}
                        className="flex items-center justify-center space-x-2 w-full py-3 bg-secondary text-secondary-foreground rounded-xl font-bold hover:bg-secondary/80 transition-all border"
                    >
                        <Github size={18} />
                        <span>项目源码</span>
                    </button>
                </div>

                <div className="pt-8 w-full">
                    <div className="p-6 rounded-2xl border bg-card/50 backdrop-blur-sm space-y-4 text-left">
                        <div className="flex items-center space-x-2 text-sm font-bold opacity-70">
                            <Heart size={14} className="text-red-500" />
                            <span>关于作者</span>
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            FlareMail 由开源社区开发者维护，旨在提供一个纯净、无广告且完全隐私的邮件阅览体验。灵感源自对简洁工具的热爱。
                        </p>
                    </div>
                </div>

                <div className="pt-4 text-center">
                    <p className="text-[11px] text-muted-foreground opacity-50 uppercase tracking-widest font-bold">
                        Licensed under MIT License
                    </p>
                    <p className="text-[11px] text-muted-foreground opacity-40 mt-1">
                        Copyright © 2025 FlareMail Contributors. All rights reserved.
                    </p>
                </div>
            </div>

            {/* Toast 提示 */}
            {toastMessage && createPortal(
                <div className="toast-container" role="status" aria-live="polite">
                    <div key={toastId} className="toast update-toast">
                        <div className="flex items-center gap-3">
                            <span>{toastMessage}</span>
                            {updateInfo && (
                                <button
                                    onClick={() => openUrl(updateInfo.downloadUrl)}
                                    className="flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                                >
                                    <Download size={14} />
                                    <span>前往下载</span>
                                </button>
                            )}
                            <button
                                onClick={dismissToast}
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
