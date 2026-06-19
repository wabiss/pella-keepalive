// pella_renew.js
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// ── 配置参数 ────────────────────────────────────────────────
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');
const TIMEOUT = 120000;

// ── 广告拦截脚本（注入网页以屏蔽各种弹窗，确保能正常跳转） ───────────
const AD_BLOCK_SCRIPT = `
(function() {
    'use strict';
    const blockedScriptDomains = ['madurird.com', 'crn77.com', 'fqjiujafk.com'];
    new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.tagName === 'SCRIPT' && node.src) {
                    if (blockedScriptDomains.some(d => node.src.includes(d))) {
                        node.remove();
                        console.log('[AdBlock] 已拦截广告脚本:', node.src);
                    }
                }
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });

    function init() {
        window.open = () => null;
        document.addEventListener('click', e => {
            const a = e.target.closest('a');
            if (!a) return;
            const href = a.href || '';
            if (
                href.includes('crn77.com') ||
                href.includes('madurird.com') ||
                href.includes('tinyurl.com') ||
                href.includes('popads') ||
                href.includes('avnsgames.com') ||
                href.includes('fqjiujafk.com')
            ) {
                e.stopPropagation();
                e.preventDefault();
                console.log('[AdBlock] 拦截广告链接:', href);
            }
        }, true);

        function removeAds() {
            document.querySelector('#continue')?.removeAttribute('onclick');
            document.querySelector('#submit-button')?.removeAttribute('onclick');
            document.querySelector('#getnewlink')?.removeAttribute('onclick');
            document.querySelectorAll('[onclick*="crn77"],[onclick*="madurird"]').forEach(el => el.removeAttribute('onclick'));

            document.querySelectorAll([
                'a[href*="crn77.com"]',
                'a[href*="madurird.com"]',
                'a[href*="tinyurl.com"]',
                'a[href*="avnsgames.com"]',
                'a[href*="popads"]',
                'script[src*="madurird.com"]',
                'script[src*="fqjiujafk.com"]',
            ].join(',')).forEach(el => el.remove());

            document.querySelectorAll([
                'iframe[id*="netpub"]',
                'div[id*="netpub_ins"]',
                'div[id*="netpub_banner"]',
                'div[class*="eldhywa"]',
                'iframe[height="0"]',
                'iframe[style*="display: none"]'
            ].join(',')).forEach(el => el.remove());
        }
        removeAds();
        new MutationObserver(removeAds).observe(document.documentElement, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
`;

// ── CF Turnstile 监控及辅助函数 ──────────────────────────────
const CF_TOKEN_LISTENER_JS = `
(function() {
    if (window.__cf_token_listener_injected__) return;
    window.__cf_token_listener_injected__ = true;
    window.__cf_turnstile_token__ = '';
    window.addEventListener('message', function(e) {
        if (!e.origin || !e.origin.includes('cloudflare.com')) return;
        var d = e.data;
        if (!d || d.event !== 'complete' || !d.token) return;
        window.__cf_turnstile_token__ = d.token;
    });
})();
`;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function sendTG(result, extra = '') {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }
        const lines = [
            `🎮 Pella 续期通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: Pella Free`,
            `📊 续期结果: ${result}`,
        ];
        if (extra) lines.push(extra);
        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: lines.join('\n') });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            console.log(res.statusCode === 200 ? '📨 TG 推送成功' : `⚠️ TG 推送失败：HTTP ${res.statusCode}`);
            resolve();
        });
        req.on('error', e => { console.log(`⚠️ TG 推送异常：${e.message}`); resolve(); });
        req.setTimeout(15000, () => { console.log('⚠️ TG 推送超时'); req.destroy(); resolve(); });
        req.write(body);
        req.end();
    });
}

function xdotoolClick(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    try {
        const wids = execSync('xdotool search --onlyvisible --class chrome', { timeout: 3000 })
            .toString().trim().split('\n').filter(Boolean);
        if (wids.length > 0) {
            execSync(`xdotool windowactivate ${wids[wids.length - 1]}`, { timeout: 2000, stdio: 'ignore' });
            execSync('sleep 0.2', { stdio: 'ignore' });
        }
        execSync(`xdotool mousemove ${x} ${y}`, { timeout: 2000 });
        execSync('sleep 0.15', { stdio: 'ignore' });
        execSync('xdotool click 1', { timeout: 2000 });
        console.log(`📐 xdotool 点击成功: (${x}, ${y})`);
        return true;
    } catch (e) {
        console.log(`⚠️ xdotool 点击失败：${e.message}`);
        return false;
    }
}

async function getWindowOffset(page) {
    try {
        const wids = execSync('xdotool search --onlyvisible --class chrome', { timeout: 3000 })
            .toString().trim().split('\n').filter(Boolean);
        if (wids.length > 0) {
            const geo = execSync(`xdotool getwindowgeometry --shell ${wids[wids.length - 1]}`, { timeout: 3000 }).toString();
            const geoDict = {};
            geo.trim().split('\n').forEach(line => {
                const [k, v] = line.split('=');
                if (k && v) geoDict[k.trim()] = parseInt(v.trim());
            });
            const winX = geoDict['X'] || 0;
            const winY = geoDict['Y'] || 0;
            const info = await page.evaluate('(function(){ return { outer: window.outerHeight, inner: window.innerHeight }; })()');
            let toolbar = info.outer - info.inner;
            if (toolbar < 30 || toolbar > 200) toolbar = 87;
            return { winX, winY, toolbar };
        }
    } catch (e) {}
    const info = await page.evaluate('(function(){ return { screenX: window.screenX||0, screenY: window.screenY||0, outer: window.outerHeight, inner: window.innerHeight }; })()');
    let toolbar = info.outer - info.inner;
    if (toolbar < 30 || toolbar > 200) toolbar = 87;
    return { winX: info.screenX, winY: info.screenY, toolbar };
}

async function getTurnstileCoords(page) {
    return await page.evaluate(`
        (function(){
            var container = document.querySelector('.cf-turnstile');
            if (container) {
                var rect = container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return { click_x: Math.round(rect.x + 368), click_y: Math.round(rect.y + rect.height / 2) };
                }
            }
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                var src = iframes[i].src || '';
                if (src.includes('cloudflare') || src.includes('turnstile')) {
                    var rect = iframes[i].getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return { click_x: Math.round(rect.x + 30), click_y: Math.round(rect.y + rect.height / 2) };
                    }
                }
            }
            return null;
        })()
    `);
}

async function checkCFToken(page) {
    try {
        const inputOk = await page.evaluate(`
            (function(){
                var input = document.querySelector('input[name="cf-turnstile-response"]');
                return input && input.value && input.value.length > 20;
            })()
        `);
        if (inputOk) return true;
    } catch (e) {}
    try {
        const token = await page.evaluate('window.__cf_turnstile_token__ || ""');
        if (token && token.length > 20) return true;
    } catch (e) {}
    return false;
}

async function solveTurnstile(page) {
    await page.evaluate(`
        (function() {
            var turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');
            if (!turnstileInput) return;
            var el = turnstileInput;
            for (var i = 0; i < 20; i++) {
                el = el.parentElement;
                if (!el) break;
                var style = window.getComputedStyle(el);
                if (style.overflow === 'hidden') el.style.overflow = 'visible';
                el.style.minWidth = 'max-content';
            }
        })()
    `);

    await page.evaluate(CF_TOKEN_LISTENER_JS);
    console.log('📡 开始监控 Cloudflare Turnstile Token...');

    if (await checkCFToken(page)) {
        console.log('✅ 验证已自动通过');
        return true;
    }

    await page.evaluate(`
        var c = document.querySelector('.cf-turnstile');
        if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    `);
    await sleep(1500);

    const coords = await getTurnstileCoords(page);
    if (!coords) {
        console.log('❌ 验证坐标获取失败');
        await page.screenshot({ path: 'turnstile_no_coords.png' });
        return false;
    }

    const { winX, winY, toolbar } = await getWindowOffset(page);
    const absX = coords.click_x + winX;
    const absY = coords.click_y + winY + toolbar;
    console.log('📐 坐标计算完成');
    xdotoolClick(absX, absY);

    for (let i = 0; i < 60; i++) {
        await sleep(500);
        if (await checkCFToken(page)) {
            const token = await page.evaluate('window.__cf_turnstile_token__ || ""');
            console.log(`✅ Cloudflare Turnstile 验证通过！token：${token.substring(0, 50)}...`);
            return true;
        }
    }

    console.log('❌ 人机验证超时');
    await page.screenshot({ path: 'turnstile_fail.png' });
    return false;
}

async function handleFitnesstipz(page) {
    console.log(`  📄 fitnesstipz 中转页: ${page.url()}`);
    try {
        await page.waitForSelector('p.getmylink', { timeout: 10000 });
        await page.click('p.getmylink');
        console.log('  ✅ 已点击 Continue... 触发倒计时');
    } catch (e) {
        console.log(`  ⚠️ getmylink 未找到：${e.message}`);
    }

    console.log('  ⏳ 等待倒计时结束...');
    for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const timerVisible = await page.evaluate(`
            (function(){
                var el = document.querySelector('#newtimer');
                if (!el) return false;
                var style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })()
        `);
        if (!timerVisible) {
            console.log('  ✅ 倒计时结束');
            break;
        }
    }

    await sleep(1000);

    try {
        await page.click('span.wp2continuelink');
        console.log('  ✅ 已点击 wp2continuelink');
        await sleep(1500);
    } catch (e) {
        console.log(`  ⚠️ wp2continuelink 未找到：${e.message}`);
    }

    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(1000);

    try {
        await page.waitForSelector('#getnewlink', { timeout: 10000 });
        await page.click('#getnewlink');
        console.log('  ✅ 已点击 Get Link');
    } catch (e) {
        console.log(`  ❌ getnewlink 未找到：${e.message}`);
        await page.screenshot({ path: 'fitnesstipz_fail.png' });
        return false;
    }
    return true;
}

// ── 核心逻辑 ────────────────────────────────────────────────
(async () => {
    // ── 代理检测 ─────────────────────────────────────────────
    let proxyConfig = undefined;
    if (process.env.GOST_PROXY) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.request(
                    { host: '127.0.0.1', port: 8080, path: '/', method: 'GET', timeout: 3000 },
                    () => resolve()
                );
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.end();
            });
            proxyConfig = { server: 'http://127.0.0.1:8080' };
            console.log('🛡️ 本地代理连通，使用 GOST 转发');
        } catch {
            console.log('⚠️ 本地代理不可达，降级为直连');
        }
    }

    // ── 启动浏览器 ───────────────────────────────────────────
    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({
        headless: false, // 配合 xvfb 运行有头模式
        proxy: proxyConfig,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    await context.addInitScript(AD_BLOCK_SCRIPT);

    // ── 彻底重构的 Cookie 净化器 (安全绕过 Playwright 及 Clerk 严苛属性校验) ──
    const rawInput = process.env.PELLA_COOKIES_JSON || process.env.PELLA_COOKIES_RAW;
    if (rawInput) {
        try {
            const trimmed = rawInput.trim();
            if (trimmed.startsWith('[')) {
                // 如果是以 [ 开头，表明是用 Cookie-Editor 导出的完美 JSON 格式
                const rawCookies = JSON.parse(trimmed);
                const formattedCookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
                
                // 重点：清洗组装全新合规对象，彻底剥离 Falsy 值及冗余属性（如 hostOnly, session, storeId）以防崩溃
                const cleanCookies = formattedCookies.map(cookie => {
                    const clean = {
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain || '.pella.app',
                        path: cookie.path || '/'
                    };

                    // 规范化 httpOnly
                    if (typeof cookie.httpOnly === 'boolean') {
                        clean.httpOnly = cookie.httpOnly;
                    }

                    // 规范化 secure
                    if (typeof cookie.secure === 'boolean') {
                        clean.secure = cookie.secure;
                    }

                    // 规范化过期时间 (自动兼容并在 Playwright 下正确应用 expires)
                    if (typeof cookie.expires === 'number') {
                        clean.expires = cookie.expires;
                    } else if (typeof cookie.expirationDate === 'number') {
                        clean.expires = cookie.expirationDate;
                    }

                    // 100% 严密解决 sameSite 格式导致的 Playwright 校验崩溃
                    if (typeof cookie.sameSite === 'string' && cookie.sameSite.trim() !== '') {
                        const s = cookie.sameSite.trim().toLowerCase();
                        if (s === 'no_restriction' || s === 'none') {
                            clean.sameSite = 'None';
                        } else if (s === 'lax') {
                            clean.sameSite = 'Lax';
                        } else if (s === 'strict') {
                            clean.sameSite = 'Strict';
                        }
                        // 遇到 unspecified 等其他非标准词，在这里直接不设置 sameSite 属性
                    }
                    // 遇到 null、undefined、空字符串等，直接不复制 sameSite 属性以防报错

                    return clean;
                });

                await context.addCookies(cleanCookies);
                console.log(`🍪 成功注入经安全净化后的 ${cleanCookies.length} 个 JSON Cookie！`);
            } else {
                // 如果是 F12 请求头中直接复制出来的原始文本
                console.log('⚠️ 检测到您使用的是 F12 原始 Cookie。由于缺少 httpOnly/secure 等关键安全属性，Clerk 会话极易在 60 秒内失效。');
                const formattedCookies = trimmed.split(';').map(pair => {
                    const cookieTrim = pair.trim();
                    if (!cookieTrim) return null;
                    const eqIdx = cookieTrim.indexOf('=');
                    if (eqIdx === -1) return null;
                    return {
                        name: cookieTrim.substring(0, eqIdx),
                        value: cookieTrim.substring(eqIdx + 1),
                        domain: '.pella.app',
                        path: '/'
                    };
                }).filter(Boolean);

                await context.addCookies(formattedCookies);
                console.log(`🍪 成功解析并注入 ${formattedCookies.length} 个原始 Cookie！`);
            }
        } catch (e) {
            console.log('❌ 载入或解析 Cookie 失败：', e.message);
        }
    } else {
        console.log('⚠️ 未检测到 PELLA_COOKIES_JSON 或 PELLA_COOKIES_RAW 环境变量，尝试直连中。');
    }

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);
    console.log('🚀 浏览器已就绪！');

    try {
        // 出口 IP 验证
        console.log('🌐 验证出口 IP...');
        try {
            const res = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded' });
            const body = await res.text();
            console.log(`✅ 出口 IP 确认：${JSON.parse(body).ip || body}`);
        } catch {
            console.log('⚠️ IP 验证超时，跳过');
        }

        // 使用注入的 Cookie 直接进入后台
        console.log('🔑 访问 Pella 页面...');
        await page.goto('https://www.pella.app/dashboard', { waitUntil: 'domcontentloaded' });
        await sleep(3000);

        // ── 严格的 Clerk 登录会话判定 ──
        console.log('⏳ 等待 Clerk session...');
        let isSessionReady = false;
        for (let i = 0; i < 30; i++) {
            isSessionReady = await page.evaluate('!!(window.Clerk && window.Clerk.session)');
            if (isSessionReady) break;
            await sleep(500);
        }

        if (isSessionReady) {
            console.log('🎉 免密直接登录成功！已成功载入 Clerk 会话。');
        } else {
            await page.screenshot({ path: 'login_fail.png' }).catch(() => {});
            throw new Error('❌ Cookie 注入失效，Clerk 会话未能建立。可能您的长效 Cookie 已过期，请重新使用 Cookie-Editor 插件获取最新的 JSON 格式 Cookie。');
        }

        // 获取 JWT Token
        console.log('🔑 获取 JWT token...');
        const token = await page.evaluate('window.Clerk.session.getToken()');
        if (!token) throw new Error('❌ 无法获取 Clerk token');
        console.log('✅ Token 获取成功');

        // 请求 API 获取服务器列表及续期链接
        console.log('🔍 获取服务器续期链接...');
        const serversRes = await page.evaluate(async (t) => {
            const res = await fetch('https://api.pella.app/user/servers', {
                headers: { 'Authorization': `Bearer ${t}` }
            });
            return await res.json();
        }, token);

        const servers = serversRes.servers || [];
        if (servers.length === 0) throw new Error('❌ 未找到服务器');

        let renewLink = null;
        for (const server of servers) {
            const unclaimed = (server.renew_links || []).filter(l => l.claimed === false);
            if (unclaimed.length > 0) {
                renewLink = unclaimed[0].link;
                console.log(`✅ 找到续期链接: ${renewLink} (服务器 ${server.ip})`);
                break;
            }
        }

        if (!renewLink) {
            await sendTG('⚠️ 无可用续期链接，今日已续期或暂不需要续期');
            console.log('⚠️ 无可用续期链接，正常退出');
            return;
        }

        // 访问续期链接（tpi.li / fitnesstipz 关卡）
        console.log(`🌐 访问广告续期链接: ${renewLink}`);
        await page.goto(renewLink, { waitUntil: 'domcontentloaded' });
        await sleep(3000);
        console.log(`📄 当前页面: ${page.url()}`);

        // CF Turnstile 校验
        const hasTurnstile = await page.evaluate('!!document.querySelector("input[name=\'cf-turnstile-response\']")');
        if (hasTurnstile) {
            console.log('🛡️ 检测到 CF Turnstile，开始处理...');
            const cfOk = await solveTurnstile(page);
            if (!cfOk) {
                await sendTG('❌ CF Turnstile 验证失败');
                throw new Error('❌ CF Turnstile 验证失败');
            }
        }

        // 点击广告页的 Continue 按钮
        console.log('📤 点击 Continue...');
        try {
            await page.waitForSelector('#continue', { timeout: 10000 });
            await page.click('#continue');
            await sleep(3000);
            console.log(`📄 跳转后: ${page.url()}`);
        } catch (e) {
            console.log(`⚠️ #continue 未找到：${e.message}`);
        }

        // 处理中间广告跳转（fitnesstipz.com 等）
        let loopCount = 0;
        while (page.url().includes('fitnesstipz.com') && loopCount < 5) {
            loopCount++;
            console.log(`🔄 处理第 ${loopCount} 个中转页...`);
            const ok = await handleFitnesstipz(page);
            if (!ok) {
                await sendTG('❌ 中转页处理失败');
                throw new Error('❌ 中转页处理失败');
            }
            await sleep(3000);
            console.log(`📄 中转后跳转: ${page.url()}`);
        }

        // 处理 tpi.li 倒计时和最后跳转
        if (page.url().includes('tpi.li')) {
            console.log('⏳ 等待 tpi.li 倒计时...');
            for (let i = 0; i < 60; i++) {
                await sleep(1000);
                const timerText = await page.evaluate(`
                    (function(){
                        var el = document.querySelector('#timer');
                        return el ? el.textContent.trim() : '0';
                    })()
                `);
                const timerVal = parseInt(timerText) || 0;
                if (timerVal <= 0) {
                    console.log('✅ 倒计时结束');
                    break;
                }
            }

            console.log('🔍 获取最终 renew 链接...');
            const renewHref = await page.evaluate(`
                (function(){
                    var a = document.querySelector('a.btn.btn-success.btn-lg.get-link');
                    return a ? a.href : null;
                })()
            `);

            if (!renewHref || !renewHref.includes('/renew/')) {
                await page.screenshot({ path: 'no_renew_href.png' });
                await sendTG('❌ 未找到有效 renew 链接');
                throw new Error('❌ 未找到有效 renew 链接: ' + renewHref);
            }

            console.log(`✅ 找到最终跳转链接: ${renewHref}`);
            await page.click('a.btn.btn-success.btn-lg.get-link');
            await sleep(3000);
        }

        // 验证最终是否续期成功
        console.log('⏳ 等待跳转至成功页面...');
        try {
            await page.waitForURL(/pella\.app\/renew\//, { timeout: 15000 });
        } catch {
            console.log(`⚠️ 未能跳转，当前页面：${page.url()}`);
        }

        const finalUrl = page.url();
        console.log(`📄 最终地址: ${finalUrl}`);
        await page.screenshot({ path: 'final_result.png' });

        const bodyText = await page.innerText('body');
        const isSuccess = bodyText.toLowerCase().includes('renewed successfully');

        if (isSuccess || finalUrl.includes('/renew/')) {
            console.log('🎉 续期成功！页面显示了 "Server renewed successfully"');
            await sendTG('✅ 续期成功！');
        } else {
            console.log(`⚠️ 续期结果未知，内容不包含成功字样。当前内容: ${bodyText.substring(0, 100)}...`);
            await sendTG('⚠️ 续期结果未知', `🔗 最终URL: ${finalUrl}`);
        }

    } catch (e) {
        await page.screenshot({ path: 'error.png' }).catch(() => {});
        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;
    } finally {
        await browser.close();
    }
})().catch(err => {
    console.error('💥 运行时发生未捕获的严重错误：', err);
    process.exit(1);
});
