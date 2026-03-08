const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios'); // For easy API calls
const CryptoJS = require('crypto-js');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// VeePN Configuration
const PRIMARY_DOMAINS = ["https://antpeak.com", "https://zorvian.com"];
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * PROXY FETCHER: Replicated from your VeePN logic
 */
async function getWorkingProxy() {
    console.log("[PROXY] Hunting for a fresh VeePN proxy...");
    try {
        // 1. Find working API domain
        let apiBase = null;
        for (const domain of PRIMARY_DOMAINS) {
            try {
                const check = await axios.get(`${domain}/api/available/`, { timeout: 3000 });
                if (check.data.message === "OK") { apiBase = domain; break; }
            } catch (e) { continue; }
        }
        if (!apiBase) throw new Error("No API domains available");

        // 2. Launch session to get Token
        const launch = await axios.post(`${apiBase}/api/launch/`, {
            udid: CryptoJS.lib.WordArray.random(16).toString(),
            appVersion: "3.7.8",
            platform: "chrome",
            platformVersion: USER_AGENT
        });
        const token = launch.data.data.accessToken;

        // 3. Get free location list
        const locs = await axios.post(`${apiBase}/api/location/list/`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const freeLocs = locs.data.data.locations.filter(l => l.proxyType === 0);
        const loc = freeLocs[Math.floor(Math.random() * freeLocs.length)];

        // 4. Get specific server details
        const serverResp = await axios.post(`${apiBase}/api/server/list/`, 
            { protocol: "https", region: loc.region, type: loc.type },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const srv = serverResp.data.data[0];
        
        // Format: https://user:pass@host:port
        const proxyUrl = `https://${srv.username}:${srv.password}@${srv.addresses[0]}:${srv.port}`;
        console.log(`[PROXY] Verified Proxy found in ${loc.name}`);
        return proxyUrl;
    } catch (e) {
        console.error(`[PROXY ERROR] ${e.message}`);
        return null;
    }
}

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    const targetUrl = `https://player.videasy.net/movie/${tmdbId}?color=FF0000`;
    
    // Get a fresh proxy for this specific request
    const proxyServer = await getWorkingProxy();
    
    let browser;
    const forensics = { failed: [] };

    try {
        console.log(`[BROWSER] Launching with Proxy: ${proxyServer ? 'YES' : 'NO'}`);
        
        const launchArgs = [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--single-process'
        ];
        
        if (proxyServer) launchArgs.push(`--proxy-server=${proxyServer}`);

        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: launchArgs
        });

        const page = await browser.newPage();
        
        // Handle Proxy Authentication if necessary
        if (proxyServer && proxyServer.includes('@')) {
            const auth = proxyServer.split('//')[1].split('@')[0].split(':');
            await page.authenticate({ username: auth[0], password: auth[1] });
        }

        // --- DISABLE DEBUGGER ---
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });

        let foundM3u8 = null;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.url().includes('.m3u8')) foundM3u8 = req.url();
            if (['image', 'font'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        console.log("[ACTION] Navigating via Proxy...");
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 50000 });
        
        await new Promise(r => setTimeout(r, 4000));

        // --- THE OVERLAY & CLICK FIX ---
        await page.evaluate(() => {
            const overlays = document.querySelectorAll('.bg-black\\/60, .absolute.z-20');
            overlays.forEach(el => el.remove());
            const btn = document.querySelector('.play-icon-main');
            if (btn) btn.closest('button').click();
            else document.elementFromPoint(window.innerWidth/2, window.innerHeight/2).click();
        });

        let attempts = 0;
        while (!foundM3u8 && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            console.log("[SUCCESS] Caught link via Proxy.");
            return res.json({ success: true, url: foundM3u8, proxyUsed: !!proxyServer });
        }

        // --- FAIL STATE DUMP ---
        const screenshot = await page.screenshot({ encoding: 'base64' });
        res.header("Content-Type", "text/html");
        res.send(`<h2>Proxy Capture Failed</h2><img src="data:image/png;base64,${screenshot}" />`);

    } catch (err) {
        res.status(500).send(`Error: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Proxy API on ${PORT}`));
