import { getVersion } from '@tauri-apps/api/app';

// GitHub API 响应类型
interface GitHubRelease {
    tag_name: string;
    html_url: string;
}

// 新版本信息
export interface UpdateInfo {
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

/**
 * 检查是否有新版本
 * @returns UpdateInfo 如果有新版本，否则 null
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
    try {
        const currentVersion = await getVersion();

        const response = await fetch('https://api.github.com/repos/hulisang/flaremail/releases/latest');

        if (!response.ok) {
            return null;
        }

        const release: GitHubRelease = await response.json();
        const latestVersion = release.tag_name;

        // 比较版本
        if (compareVersions(currentVersion, latestVersion) > 0) {
            return {
                version: latestVersion,
                downloadUrl: release.html_url
            };
        }

        return null;
    } catch (error) {
        console.error('检查更新失败', error);
        return null;
    }
}
