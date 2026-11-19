// 豆瓣热门推荐（重构版）：双分区同屏 + 防盗链封面加载链 + 骨架屏
// 分区：热门电影 / 热门剧集，各自独立标签与“换一批”
// 封面加载链：代理URL(网页版经 server.mjs 自动附加豆瓣 Referer) → 原图(no-referrer) → 占位图
// APK 环境：ProxyAuth 改写器把代理 URL 还原为直连，WebView 层拦截豆瓣图片请求附加 Referer

// ---------- 标签 ----------
const DB_DEFAULT_MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
const DB_DEFAULT_TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

function loadUserTags() {
    try {
        const m = localStorage.getItem('userMovieTags');
        const t = localStorage.getItem('userTvTags');
        return {
            movie: m ? JSON.parse(m) : [...DB_DEFAULT_MOVIE_TAGS],
            tv: t ? JSON.parse(t) : [...DB_DEFAULT_TV_TAGS],
        };
    } catch (e) {
        return { movie: [...DB_DEFAULT_MOVIE_TAGS], tv: [...DB_DEFAULT_TV_TAGS] };
    }
}

// ---------- 分区状态 ----------
const DB_PAGE_SIZE = 12; // 每分区每屏数量（纵向更整齐，适配双分区布局）
const doubanState = {
    movie: { tag: '热门', pageStart: 0, loading: false },
    tv: { tag: '热门', pageStart: 0, loading: false },
};
let doubanTags = loadUserTags();

// ---------- 数据获取 ----------
async function fetchDoubanData(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url)) :
            PROXY_URL + encodeURIComponent(url);
        const response = await fetch(proxiedUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn('豆瓣主路径失败，尝试 allorigins 备用：', err.message || err);
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const fbController = new AbortController();
        const fbTimer = setTimeout(() => fbController.abort(), 12000);
        try {
            const fallbackResponse = await fetch(fallbackUrl, { signal: fbController.signal });
            clearTimeout(fbTimer);
            if (!fallbackResponse.ok) throw new Error(`备用API失败: ${fallbackResponse.status}`);
            const data = await fallbackResponse.json();
            if (data && data.contents) return JSON.parse(data.contents);
            throw new Error('备用API无有效数据');
        } finally {
            clearTimeout(fbTimer);
        }
    }
}

// 生成防盗链封面 URL（同一代码路径适配网页/APK）
async function doubanCoverUrl(originalUrl) {
    try {
        return await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(originalUrl)) :
            PROXY_URL + encodeURIComponent(originalUrl);
    } catch { return originalUrl; }
}

// ---------- 渲染 ----------
function rateClass(rate) {
    const r = parseFloat(rate);
    if (isNaN(r)) return 'text-gray-300';
    if (r >= 8.5) return 'text-yellow-300';
    if (r >= 7.5) return 'text-yellow-400';
    if (r >= 6) return 'text-green-400';
    return 'text-gray-300';
}

const PLACEHOLDER_POSTER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="100%" height="100%" fill="#1a1a24"/><text x="50%" y="46%" fill="#4a4a5a" font-size="40" text-anchor="middle">🎬</text><text x="50%" y="58%" fill="#4a4a5a" font-size="14" text-anchor="middle">暂无封面</text></svg>'
);

function renderSkeleton(container, count) {
    const skeleton = Array.from({ length: count }, () => `
        <div class="rounded-lg overflow-hidden bg-[#141419] animate-pulse">
            <div class="w-full aspect-[2/3] bg-[#1e1e28]"></div>
            <div class="h-6 mx-2 my-2 rounded bg-[#1e1e28]"></div>
        </div>`).join('');
    container.innerHTML = skeleton;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function renderDoubanSection(kind) {
    const st = doubanState[kind];
    const container = document.getElementById(`douban-${kind}-results`);
    if (!container || st.loading) return;
    st.loading = true;
    renderSkeleton(container, DB_PAGE_SIZE);

    try {
        const target = `https://movie.douban.com/j/search_subjects?type=${kind}&tag=${encodeURIComponent(st.tag)}&sort=recommend&page_limit=${DB_PAGE_SIZE}&page_start=${st.pageStart}`;
        const data = await fetchDoubanData(target);

        if (!data.subjects || data.subjects.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-8 text-gray-500">这个分类暂时没有更多内容了，换个标签试试～</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const item of data.subjects) {
            const safeTitle = escapeHtml(item.title);
            const safeRate = escapeHtml(item.rate || '暂无');
            const originalCover = String(item.cover || '');
            const primaryCover = await doubanCoverUrl(originalCover);

            const card = document.createElement('div');
            card.className = 'group bg-[#111] hover:bg-[#1c1c26] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:-translate-y-1 hover:shadow-xl shadow-md';
            card.innerHTML = `
                <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer bg-[#1a1a24]" onclick="fillAndSearchWithDouban('${safeTitle}')">
                    <img src="${primaryCover}" alt="${safeTitle}"
                        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy" referrerpolicy="no-referrer"
                        onerror="if(this.dataset.r){this.onerror=null;this.src='${PLACEHOLDER_POSTER}';this.classList.add('object-contain');}else{this.dataset.r='1';this.src='${originalCover}';}">
                    <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>
                    ${String(item.is_new) === 'true' ? '<span class="absolute top-1.5 left-1.5 bg-pink-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm font-medium">NEW</span>' : ''}
                    <div class="absolute bottom-1.5 left-1.5 bg-black/70 backdrop-blur text-white text-xs px-2 py-0.5 rounded-md">
                        <span class="text-yellow-400 mr-0.5">★</span><span class="${rateClass(item.rate)} font-semibold">${safeRate}</span>
                    </div>
                    <div class="absolute inset-0 bg-pink-600/0 group-hover:bg-pink-600/10 transition-colors pointer-events-none"></div>
                </div>
                <button onclick="fillAndSearchWithDouban('${safeTitle}')"
                        class="text-sm font-medium text-gray-200 hover:text-pink-400 truncate px-2 py-2 transition w-full" title="${safeTitle}">
                    ${safeTitle}
                </button>`;
            fragment.appendChild(card);
        }
        container.innerHTML = '';
        container.appendChild(fragment);
    } catch (e) {
        console.error('豆瓣推荐加载失败：', e);
        container.innerHTML = `<div class="col-span-full text-center py-8 text-gray-500">推荐加载失败（网络波动），<button class="text-pink-400 hover:underline" onclick="renderDoubanSection('${kind}')">点此重试</button></div>`;
    } finally {
        st.loading = false;
    }
}

function renderDoubanTagsRow(kind) {
    const row = document.getElementById(`douban-${kind}-tags`);
    if (!row) return;
    const current = doubanState[kind].tag;
    row.innerHTML = doubanTags[kind].map(tag => {
        const active = tag === current;
        return `<button data-kind="${kind}" data-tag="${escapeHtml(tag)}"
                class="db-tag shrink-0 px-2.5 py-1 text-xs rounded-full transition ${active ? 'bg-pink-600 text-white' : 'bg-[#222] text-gray-400 hover:bg-[#333] hover:text-white'}">
                ${escapeHtml(tag)}</button>`;
    }).join('');
    row.querySelectorAll('.db-tag').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.kind;
            doubanState[k].tag = btn.dataset.tag;
            doubanState[k].pageStart = 0;
            renderDoubanTagsRow(k);
            renderDoubanSection(k);
        });
    });
}

// ---------- 交互：换一批 ----------
function setupDoubanRefreshBtns() {
    for (const kind of ['movie', 'tv']) {
        const btn = document.getElementById(`douban-${kind}-refresh`);
        if (!btn) continue;
        btn.addEventListener('click', () => {
            doubanState[kind].pageStart += DB_PAGE_SIZE;
            renderDoubanSection(kind);
        });
    }
}

// ---------- 搜索联动 ----------
async function fillAndSearchWithDouban(title) {
    if (!title) return;
    const safeTitle = String(title)
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        if (typeof search === 'function') await search();
        try {
            window.history.pushState({ search: safeTitle }, `搜索: ${safeTitle} - LibreTV`, `/s=${encodeURIComponent(safeTitle)}`);
            document.title = `搜索: ${safeTitle} - LibreTV`;
        } catch (e) { /* 忽略历史状态错误 */ }
        if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ---------- 可见性与初始化 ----------
function isDoubanEnabled() {
    const stored = localStorage.getItem('doubanEnabled');
    // app.js 的默认初始化晚于本文件执行：首次访问时 stored 为 null，按默认开启处理
    return stored === null ? true : stored === 'true';
}

function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;
    const isEnabled = isDoubanEnabled();
    doubanArea.classList.toggle('hidden', !isEnabled);
    if (isEnabled) {
        renderDoubanSection('movie');
        renderDoubanSection('tv');
    }
}

function initDouban() {
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = isDoubanEnabled();
        doubanToggle.checked = isEnabled;
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg ? toggleBg.nextElementSibling : null;
        toggleBg?.classList.toggle('bg-pink-600', isEnabled);
        toggleDot?.classList.toggle('translate-x-6', isEnabled);
        doubanToggle.addEventListener('change', e => {
            localStorage.setItem('doubanEnabled', e.target.checked);
            updateDoubanVisibility();
        });
    }

    doubanTags = loadUserTags();
    renderDoubanTagsRow('movie');
    renderDoubanTagsRow('tv');
    setupDoubanRefreshBtns();
    updateDoubanVisibility();
}

document.addEventListener('DOMContentLoaded', initDouban);
