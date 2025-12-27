import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Github, Info, RefreshCw, Heart } from 'lucide-react';

export default function About() {
    const [version, setVersion] = useState<string>('加载中...');
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        getVersion().then(setVersion).catch(console.error);
    }, []);

    const handleCheckUpdate = async () => {
        setChecking(true);
        try {
            const update = await check();
            if (update) {
                console.log(`发现新版本: ${update.version}`);
                // 执行下载和安装
                // 注意：在打包版本中，这将触发正式的下载流程
                await update.downloadAndInstall();
                // 下载安装完毕后提示用户手动重启
                alert('更新已安装，请重启应用以应用新版本。');
            } else {
                alert('当前已是最新版本');
            }
        } catch (error) {
            console.error('检查更新失败', error);
            // 开发环境下如果没有配置正确的 endpoints 或没有发布 release，通常会走到这里
            alert('检查更新失败：未发现可用的更新服务器或网络连接异常');
        } finally {
            setChecking(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center text-center space-y-6">
                {/* Logo 显示 */}
                <div className="w-24 h-24 flex items-center justify-center mb-4">
                    <img src="/src/assets/logo.png" alt="FlareMail Logo" className="w-full h-full object-contain" />
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
        </div>
    );
}
