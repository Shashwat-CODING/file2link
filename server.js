const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    const targetUrl = `https://player.videasy.net/movie/${tmdbId}?color=FF0000`;
    
    let browser;
    const forensics = { failed: [], intercepted: [], blocked: [] };

    try {
        console.log(`\n[*] Diagnostics Started for ID: ${tmdbId}`);
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
        });

        const page = await browser.newPage();

        // 1. DEACTIVATE BREAKPOINTS
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });

        // 2. NETWORK MONITORING
        await page.setRequestInterception(true);
        let foundM3u8 = null;

        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8')) {
                forensics.intercepted.push(url);
                if (!foundM3u8) foundM3u8 = url;
            }
            if (['image', 'font'].includes(request.resourceType())) request.abort();
            else request.continue();
        });

        // Track Errors (403, 404, etc)
        page.on('response', response => {
            if (response.status() >= 400) {
                forensics.failed.push({ url: response.url(), status: response.status() });
            }
        });

        // 3. NAVIGATION
        console.log("[ACTION] Navigating to player...");
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Wait for elements to settle
        await new Promise(r => setTimeout(r, 4000));

        // 4. THE FIX: REMOVE OVERLAYS & INJECT CLICK
        console.log("[ACTION] Clearing overlays and injecting click...");
        await page.evaluate(() => {
            // Find and remove the "bg-black/60" overlay that blocks clicks
            const overlays = document.querySelectorAll('.bg-black\\/60, .absolute.z-20');
            overlays.forEach(el => el.remove());

            // Target the play button specifically
            const playBtn = document.querySelector('.play-icon-main')?.parentElement;
            if (playBtn) {
                playBtn.click(); // Standard JS click
            } else {
                // Fallback: Click center if icon not found
                const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
                if (center) center.click();
            }
        });

        // 5. DATA POLLING
        let attempts = 0;
        while (!foundM3u8 && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            console.log("[SUCCESS] Caught M3U8.");
            return res.json({ success: true, url: foundM3u8 });
        }

        // --- 6. DETAILED FAIL REPORT ---
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const htmlDump = await page.content();

        res.header("Content-Type", "text/html");
        res.send(`
            <body style="background:#000; color:#eee; font-family:monospace; padding:20px;">
                <h1 style="color:#ff5252">Capture Failed</h1>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                    <div>
                        <h3>Visual State</h3>
                        <img src="data:image/png;base64,${screenshot}" style="width:100%; border:1px solid #444;" />
                    </div>
                    <div>
                        <h3 style="color:#ffab00">Error Log (HTTP 4xx/5xx)</h3>
                        <div style="background:#111; padding:10px; border:1px solid #333; max-height:400px; overflow-y:auto;">
                            ${forensics.failed.map(f => `<p><b style="color:red">[${f.status}]</b> ${f.url}</p>`).join('')}
                        </div>
                    </div>
                </div>
                <h3>DOM State</h3>
                <textarea style="width:100%; height:300px; background:#000; color:#0f0;">${htmlDump.replace(/</g, "&lt;")}</textarea>
            </body>
        `);

    } catch (err) {
        res.status(500).send(`Server Error: ${err.message}`);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`🚀 Forensic Server Active on ${PORT}`));
