// pella_renew.js
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ── 配置参数 ────────────────────────────────────────────────
const [PELLA_EMAIL, PELLA_PASSWORD] = (process.env.PELLA_ACCOUNT || ',').split(',');
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
            `🕐 运行时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
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
    if (!PELLA_EMAIL || !PELLA_PASSWORD) {
        throw new Error('❌ 未提供注册邮箱或密码，请在 GitHub Secrets 中配置 PELLA_ACCOUNT，格式为: 邮箱,密码');
    }

    // ── 启动浏览器 ───────────────────────────────────────────
    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({
        headless: false, // 配合 xvfb 运行有头模式
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    await context.addInitScript(AD_BLOCK_SCRIPT);
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

        // ── 1. 邮箱+密码直登流程 ──
        console.log('🔑 访问 Pella 登录页...');
        await page.goto('https://www.pella.app/login', { waitUntil: 'domcontentloaded' });
        await sleep(3000);

        console.log('✏️ 填写邮箱...');
        await page.waitForSelector('input[name="identifier"], #identifier-field', { timeout: 15000 });
        await page.fill('input[name="identifier"], #identifier-field', PELLA_EMAIL);

        console.log('📤 点击“继续”按钮...');
        // 关键更正：直接定位 Clerk 表单主按钮，绝不会误触 Google 按钮
        await page.click('.cl-formButtonPrimary');
        await sleep(3000);

        console.log('✏️ 填写密码...');
        await page.waitForSelector('input[name="password"]', { timeout: 15000 });
        await page.fill('input[name="password"]', PELLA_PASSWORD);

        console.log('📤 提交登录信息...');
        await page.click('.cl-formButtonPrimary');

        console.log('⏳ 等待登录跳转...');
        await page.waitForURL(/pella\.app\/home/, { timeout: 45000 });
        console.log(`✅ 登录成功！当前页面：${page.url()}`);

        // 等待 Clerk session 加载
        console.log('⏳ 等待 Clerk session...');
        for (let i = 0; i < 20; i++) {
            if (await page.evaluate('!!(window.Clerk && window.Clerk.session)')) break;
            await sleep(500);
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
