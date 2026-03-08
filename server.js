const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/data', async (req, res) => {
    const tmdbId = req.query.id || "453395";
    const targetUrl = `https://player.videasy.net/movie/${tmdbId}?color=FF0000`;
    
    console.log(`\n[SYSTEM] Starting Capture Cycle for ID: ${tmdbId}`);
    
    let browser;
    try {
        console.log("[BROWSER] Initializing Headless Chrome...");
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--single-process',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        
        // --- 1. ANTI-DEBUGGING BYPASS ---
        // This session tells the browser to ignore "debugger;" statements and never pause.
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        await client.send('Debugger.setSkipAllPauses', { skip: true });
        console.log("[BROWSER] Debugger pauses deactivated (Breakpoints disabled).");

        // --- 2. NETWORK INTERCEPTION ---
        let foundM3u8 = null;
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.m3u8') && !foundM3u8) {
                console.log(`[NETWORK] Found Stream Link: ${url.substring(0, 60)}...`);
                foundM3u8 = url;
            }
            // Block images to save Render RAM
            if (request.resourceType() === 'image') request.abort();
            else request.continue();
        });

        console.log(`[ACTION] Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 35000 });
        console.log("[ACTION] Page loaded.");

        // --- 3. INJECTION & CLICKING ---
        // We wait for the specific SVG play icon from your HTML to be visible
        console.log("[ACTION] Waiting for play button...");
        try {
            await page.waitForSelector('.play-icon-main', { timeout: 5000 });
            console.log("[ACTION] Button found. Performing center-click via mouse...");
            
            // Get button center
            const rect = await page.evaluate(() => {
                const el = document.querySelector('.play-icon-main');
                const box = el.getBoundingClientRect();
                return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            });
            
            await page.mouse.click(rect.x, rect.y);
        } catch (e) {
            console.warn("[WARN] Selector .play-icon-main not found, clicking absolute center.");
            await page.mouse.click(400, 300);
        }

        // --- 4. DATA POLLING ---
        console.log("[ACTION] Waiting 10s for playback to trigger network request...");
        let attempts = 0;
        while (!foundM3u8 && attempts < 20) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (foundM3u8) {
            console.log("[SUCCESS] Returning m3u8 URL.");
            return res.json({ success: true, url: foundM3u8 });
        }

        // --- 5. FAILSTATE: RETURN HTML SOURCE FOR INSPECTION ---
        console.error("[FAIL] No link found. Dumping browser state...");
        const finalHtml = await page.content();
        const screenshot = await page.screenshot({ encoding: 'base64' });

        res.header("Content-Type", "text/html");
        res.send(`
            <body style="background:#111;color:#fff;font-family:sans-serif;">
                <h2 style="color:red">Link Capture Failed</h2>
                <p>The browser could not find an .m3u8 link within the timeout.</p>
                <hr/>
                <h3>Browser Screenshot:</h3>
                <img src="data:image/png;base64,${screenshot}" style="max-width:100%; border:1px solid #555" />
                <h3>Last Recorded HTML:</h3>
                <textarea style="width:100%;height:400px;background:#000;color:#0f0;">${finalHtml.replace(/</g, '&lt;')}</textarea>
            </body>
        `);

    } catch (err) {
        console.error(`[CRITICAL] Error: ${err.message}`);
        res.status(500).send(`Server Error: ${err.message}`);
    } finally {
        if (browser) await browser.close();
        console.log("[SYSTEM] Request Cycle Ended.");
    }
});

app.listen(PORT, () => console.log(`🚀 API Running on Port ${PORT}`));
